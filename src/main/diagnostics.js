'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_COPY_BYTES = 2 * 1024 * 1024;
const ROTATION_COUNT = 2;
const MAX_QUEUE_LINES = 5000;
const SENSITIVE_KEY = /(pass(word)?|token|cookie|authorization|access.?code|secret|credential|session.?key|private.?key)/i;
const SENSITIVE_QUERY = /(pass(word)?|token|cookie|authorization|access.?code|secret|auth|key)/i;

class Diagnostics {
  constructor({ app, clipboard = null, shell = null, Notification = null, logDir = null } = {}) {
    if (!app) throw new TypeError('Diagnostics requires an Electron app instance');
    this.app = app;
    this.clipboard = clipboard;
    this.shell = shell;
    this.Notification = Notification;
    this.sessionId = crypto.randomBytes(9).toString('base64url');
    this.startedAt = Date.now();
    this.logDir = logDir || path.join(app.getPath('userData'), 'logs');
    this.logPath = path.join(this.logDir, 'xtmusic-diagnostic.log');
    this.queue = [];
    this.flushTimer = null;
    this.flushing = Promise.resolve();
    this.closed = false;
    this.processHandlersInstalled = false;
    this.samplingTimers = [];
    this.instrumentedTransports = new WeakSet();

    fs.mkdirSync(this.logDir, { recursive: true });
    rotateLogs(this.logPath);
    this.#writeShareInstructions();
    this.log('main', 'diagnostics:start', {
      version: safeVersion(app),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      osRelease: os.release(),
      cpuCount: os.cpus()?.length || 0,
      totalMemoryMB: bytesToMB(os.totalmem())
    });
  }

  installProcessHandlers() {
    if (this.processHandlersInstalled) return;
    this.processHandlersInstalled = true;

    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.log('main', 'process:uncaught-exception', {
        origin,
        error: serializeError(error)
      }, 'fatal');
      this.flushSync();
    });
    process.on('unhandledRejection', (reason) => {
      this.log('main', 'process:unhandled-rejection', {
        error: serializeError(reason)
      }, 'error');
      void this.flush();
    });
    process.on('warning', (warning) => {
      this.log('main', 'process:warning', {
        name: warning?.name,
        message: warning?.message,
        stack: warning?.stack
      }, 'warning');
    });
    process.on('exit', (code) => {
      this.log('main', 'process:exit', { code }, 'info');
      this.flushSync();
    });

    this.app.on('child-process-gone', (_event, details) => {
      this.log('main', 'app:child-process-gone', details, 'error');
      void this.flush();
    });
  }

  log(source, event, details = {}, level = 'info') {
    if (this.closed) return;
    const entry = {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      sessionId: this.sessionId,
      level: normalizeLevel(level),
      source: String(source || 'unknown').slice(0, 80),
      event: String(event || 'event').slice(0, 160),
      pid: process.pid,
      details: sanitizeDetails(details)
    };
    this.queue.push(`${JSON.stringify(entry)}\n`);
    if (this.queue.length > MAX_QUEUE_LINES) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE_LINES);
    }
    this.#scheduleFlush(this.queue.length >= 100 ? 0 : 120);
  }

  rendererLog(payload, senderId = null) {
    if (!payload || typeof payload !== 'object') return;
    this.log(
      'renderer',
      payload.event || 'renderer:event',
      {
        senderId,
        ...(payload.details && typeof payload.details === 'object' ? payload.details : {})
      },
      payload.level || 'info'
    );
  }

  attachWindow(win) {
    if (!win || win.isDestroyed?.()) return;
    const windowId = win.id;
    const windowDetails = () => safeWindowDetails(win);

    this.log('window', 'window:created', { windowId, ...windowDetails() });
    for (const event of ['ready-to-show', 'show', 'hide', 'focus', 'blur', 'maximize', 'unmaximize', 'minimize', 'restore']) {
      win.on(event, () => this.log('window', `window:${event}`, { windowId, ...windowDetails() }, 'debug'));
    }
    win.on('unresponsive', () => {
      this.log('window', 'window:unresponsive', { windowId, ...windowDetails() }, 'error');
      void this.snapshot({ window: win, reason: 'window-unresponsive' });
      void this.flush();
    });
    win.on('responsive', () => {
      this.log('window', 'window:responsive', { windowId, ...windowDetails() }, 'warning');
    });
    win.on('closed', () => this.log('window', 'window:closed', { windowId }));

    const contents = win.webContents;
    if (!contents) return;
    contents.on('did-start-loading', () => this.log('renderer-host', 'webcontents:did-start-loading', {
      windowId,
      url: sanitizeUrl(contents.getURL())
    }, 'debug'));
    contents.on('dom-ready', () => this.log('renderer-host', 'webcontents:dom-ready', {
      windowId,
      url: sanitizeUrl(contents.getURL())
    }));
    contents.on('did-finish-load', () => this.log('renderer-host', 'webcontents:did-finish-load', {
      windowId,
      url: sanitizeUrl(contents.getURL()),
      processId: contents.getOSProcessId?.() || null
    }));
    contents.on('did-stop-loading', () => this.log('renderer-host', 'webcontents:did-stop-loading', {
      windowId,
      url: sanitizeUrl(contents.getURL())
    }, 'debug'));
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.log('renderer-host', 'webcontents:did-fail-load', {
        windowId,
        errorCode,
        errorDescription,
        url: sanitizeUrl(validatedURL),
        isMainFrame
      }, 'error');
    });
    contents.on('preload-error', (_event, preloadPath, error) => {
      this.log('renderer-host', 'webcontents:preload-error', {
        windowId,
        preloadFile: path.basename(preloadPath || ''),
        error: serializeError(error)
      }, 'fatal');
      void this.flush();
    });
    contents.on('render-process-gone', (_event, details) => {
      this.log('renderer-host', 'webcontents:render-process-gone', {
        windowId,
        ...details
      }, 'fatal');
      void this.flush();
    });
    contents.on('console-message', (_event, level, message, line, sourceId) => {
      const text = String(message || '');
      if (Number(level) < 2 && !text.startsWith('[XT-DIAG]')) return;
      this.log('renderer-console', 'console-message', {
        level,
        message: text,
        line,
        source: sourceId ? path.basename(String(sourceId)) : ''
      }, Number(level) >= 3 ? 'error' : 'warning');
    });
  }

  startSampling(contextProvider = null) {
    if (this.samplingTimers.length) return;
    let expected = performance.now() + 1000;
    const eventLoopTimer = setInterval(() => {
      const now = performance.now();
      const lagMs = Math.max(0, now - expected);
      expected = now + 1000;
      if (lagMs >= 150) {
        this.log('main', 'event-loop:lag', { lagMs: round(lagMs) }, lagMs >= 1000 ? 'error' : 'warning');
      }
    }, 1000);
    eventLoopTimer.unref?.();

    const sampleTimer = setInterval(() => {
      void this.snapshot(typeof contextProvider === 'function' ? contextProvider() : {}, {
        event: 'runtime:sample',
        level: 'debug',
        includeLogInfo: false
      });
    }, 5000);
    sampleTimer.unref?.();
    this.samplingTimers.push(eventLoopTimer, sampleTimer);
  }

  stopSampling() {
    for (const timer of this.samplingTimers) clearInterval(timer);
    this.samplingTimers = [];
  }

  instrumentTransport(transport) {
    if (!transport || this.instrumentedTransports.has(transport)) return transport;
    if (typeof transport.requestStream !== 'function') return transport;
    this.instrumentedTransports.add(transport);

    const originalRequestStream = transport.requestStream.bind(transport);
    transport.requestStream = (rawUrl, options = {}, redirectDepth = 0) => {
      const requestId = crypto.randomBytes(5).toString('hex');
      const started = performance.now();
      const requestMeta = {
        requestId,
        method: String(options.method || 'GET').toUpperCase(),
        url: sanitizeUrl(rawUrl),
        timeoutMs: Number(options.timeoutMs || 15000),
        redirectDepth,
        allowHttp: Boolean(options.allowHttp),
        allowSelfSigned: Boolean(options.allowSelfSigned),
        hasRange: hasHeader(options.headers, 'range')
      };
      this.log('http', 'request:start', requestMeta, 'debug');
      return originalRequestStream(rawUrl, options, redirectDepth).then(
        (response) => {
          this.log('http', 'response:headers', {
            ...requestMeta,
            durationMs: round(performance.now() - started),
            statusCode: response?.statusCode,
            contentType: firstHeader(response?.headers?.['content-type']),
            contentLength: firstHeader(response?.headers?.['content-length']),
            contentRange: firstHeader(response?.headers?.['content-range']),
            finalUrl: sanitizeUrl(response?.url)
          }, response?.statusCode >= 400 ? 'warning' : 'debug');
          return response;
        },
        (error) => {
          this.log('http', 'request:error', {
            ...requestMeta,
            durationMs: round(performance.now() - started),
            error: serializeError(error)
          }, 'error');
          throw error;
        }
      );
    };
    return transport;
  }

  async snapshot(context = {}, options = {}) {
    const event = options.event || 'diagnostics:snapshot';
    const level = options.level || 'info';
    const win = context?.window || context?.runtime?.mainWindow || null;
    const mainMemory = await safeAsync(() => process.getProcessMemoryInfo?.(), null);
    const appMetrics = safeAppMetrics(this.app);
    const details = {
      reason: context?.reason || options.reason || null,
      uptimeSeconds: round(process.uptime()),
      mainCpu: process.getCPUUsage?.() || null,
      mainMemory,
      systemFreeMemoryMB: bytesToMB(os.freemem()),
      window: safeWindowDetails(win),
      rendererProcessId: win?.webContents?.getOSProcessId?.() || null,
      appMetrics,
      runtime: safeRuntimeDetails(context?.runtime),
      mediaServer: safeMediaDetails(context?.mediaServer || context?.runtime?.mediaServer)
    };
    if (options.includeLogInfo !== false) details.log = this.info();
    this.log('main', event, details, level);
    await this.flush();
    return details;
  }

  info() {
    return {
      version: safeVersion(this.app),
      sessionId: this.sessionId,
      logPath: this.logPath,
      logDir: this.logDir,
      shortcut: 'Ctrl+Shift+L',
      maxCopiedBytes: MAX_COPY_BYTES
    };
  }

  async copyToClipboard() {
    if (!this.clipboard?.writeText) {
      throw new Error('当前环境无法访问系统剪贴板');
    }
    this.log('main', 'diagnostics:copy-requested');
    await this.flush();
    const tail = readTail(this.logPath, MAX_COPY_BYTES);
    const header = [
      'XT Music 诊断日志',
      `版本: ${safeVersion(this.app)}`,
      `会话: ${this.sessionId}`,
      `路径: ${this.logPath}`,
      `复制时间: ${new Date().toISOString()}`,
      '说明: 日志已自动隐藏密码、Token、Cookie 和访问安全码。',
      '---'
    ].join('\n');
    const text = `${header}\n${tail}`;
    this.clipboard.writeText(text);
    this.log('main', 'diagnostics:copied', { bytes: Buffer.byteLength(text) });
    await this.flush();
    this.notify('XT Music 诊断日志', '日志已复制到剪贴板，可直接粘贴到对话中。');
    return {
      copied: true,
      bytes: Buffer.byteLength(text),
      logPath: this.logPath,
      sessionId: this.sessionId
    };
  }

  async openFolder() {
    if (!this.shell?.openPath) throw new Error('当前环境无法打开日志目录');
    await this.flush();
    const result = await this.shell.openPath(this.logDir);
    if (result) throw new Error(result);
    this.log('main', 'diagnostics:folder-opened', { logDir: this.logDir });
    return { opened: true, logDir: this.logDir, logPath: this.logPath };
  }

  notify(title, body) {
    try {
      if (!this.Notification?.isSupported?.()) return false;
      new this.Notification({ title, body, silent: true }).show();
      return true;
    } catch {
      return false;
    }
  }

  async flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.queue.length) return this.flushing;
    const batch = this.queue.splice(0, this.queue.length).join('');
    this.flushing = this.flushing
      .then(() => fs.promises.appendFile(this.logPath, batch, 'utf8'))
      .catch((error) => {
        try {
          fs.appendFileSync(this.logPath, `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            source: 'diagnostics',
            event: 'flush:error',
            details: { message: String(error?.message || error) }
          })}\n`, 'utf8');
        } catch {
          // No further recovery is possible if the log file itself cannot be written.
        }
      });
    return this.flushing;
  }

  flushSync() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, this.queue.length).join('');
    try {
      fs.appendFileSync(this.logPath, batch, 'utf8');
    } catch {
      // Exit-time logging is best-effort.
    }
  }

  async close() {
    if (this.closed) return;
    this.stopSampling();
    this.log('main', 'diagnostics:close');
    await this.flush();
    this.closed = true;
  }

  #scheduleFlush(delayMs) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
    this.flushTimer.unref?.();
  }

  #writeShareInstructions() {
    const instructionsPath = path.join(this.logDir, 'HOW-TO-SHARE.txt');
    const content = [
      'XT Music 诊断日志',
      '',
      '1. 复现卡顿或卡死。',
      '2. 按 Ctrl+Shift+L，诊断日志会复制到剪贴板。',
      '3. 直接粘贴到对话中。',
      '',
      '也可以从系统托盘菜单选择“复制诊断日志”或“打开诊断日志目录”。',
      '日志会自动隐藏密码、Token、Cookie、访问安全码与 Authorization。',
      '',
      `当前日志文件: ${this.logPath}`,
      ''
    ].join('\r\n');
    try {
      fs.writeFileSync(instructionsPath, content, 'utf8');
    } catch {
      // Instructions are optional; the main JSONL log remains authoritative.
    }
  }
}

function sanitizeDetails(value, depth = 0, seen = new WeakSet(), keyName = '') {
  if (SENSITIVE_KEY.test(String(keyName || ''))) return '<redacted>';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return sanitizeDetails(serializeError(value), depth, seen, keyName);
  if (depth >= 6) return '<max-depth>';
  if (typeof value !== 'object') return redactString(String(value));
  if (seen.has(value)) return '<circular>';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.slice(0, 60).map((item) => sanitizeDetails(item, depth + 1, seen));
    if (value.length > 60) result.push(`<${value.length - 60} more>`);
    return result;
  }

  const result = {};
  const entries = Object.entries(value).slice(0, 120);
  for (const [key, item] of entries) {
    result[key] = sanitizeDetails(item, depth + 1, seen, key);
  }
  if (Object.keys(value).length > entries.length) {
    result.__truncatedKeys = Object.keys(value).length - entries.length;
  }
  return result;
}

function redactString(value) {
  let text = String(value || '');
  if (/^https?:\/\//i.test(text)) text = sanitizeUrl(text);
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer <redacted>')
    .replace(/\b(music-token|password|passwd|access[_-]?code|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>');
  if (text.length > 3000) return `${text.slice(0, 3000)}…<truncated>`;
  return text;
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const url = new URL(String(rawUrl));
    const pairs = [];
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments[0] && segments[0].length >= 24) {
        segments[0] = '<local-secret>';
        url.pathname = `/${segments.join('/')}`;
      }
    }
    for (const [key, value] of url.searchParams.entries()) {
      const rendered = SENSITIVE_QUERY.test(key)
        ? '<redacted>'
        : `<len:${String(value).length}>`;
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(rendered)}`);
    }
    url.search = pairs.length ? `?${pairs.join('&')}` : '';
    url.hash = '';
    return url.toString();
  } catch {
    return redactStringNonUrl(String(rawUrl));
  }
}

function redactStringNonUrl(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer <redacted>')
    .replace(/\b(music-token|password|passwd|access[_-]?code|authorization|cookie|token)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .slice(0, 3000);
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: String(error.name || 'Error'),
    code: error.code == null ? null : String(error.code),
    message: String(error.message || error),
    stack: error.stack ? String(error.stack).split('\n').slice(0, 20).join('\n') : null,
    details: error.details || null
  };
}

function safeWindowDetails(win) {
  if (!win || win.isDestroyed?.()) return null;
  let bounds = null;
  try {
    bounds = win.getBounds();
  } catch {
    bounds = null;
  }
  return {
    id: win.id,
    visible: safeCall(() => win.isVisible(), false),
    focused: safeCall(() => win.isFocused(), false),
    minimized: safeCall(() => win.isMinimized(), false),
    maximized: safeCall(() => win.isMaximized(), false),
    bounds,
    url: sanitizeUrl(safeCall(() => win.webContents?.getURL(), '')),
    rendererProcessId: safeCall(() => win.webContents?.getOSProcessId(), null)
  };
}

function safeRuntimeDetails(runtime) {
  if (!runtime) return null;
  return {
    hasClient: Boolean(runtime.client),
    hasWindow: Boolean(runtime.mainWindow && !runtime.mainWindow.isDestroyed?.()),
    hasTray: Boolean(runtime.tray),
    queueTitlePresent: Boolean(runtime.playerState?.title),
    playerPlaying: Boolean(runtime.playerState?.playing)
  };
}

function safeMediaDetails(mediaServer) {
  if (!mediaServer) return { running: false };
  const diagnostics = safeCall(() => mediaServer.diagnostics?.(), null);
  return diagnostics || {
    running: Boolean(mediaServer.server),
    origin: mediaServer.origin || null
  };
}

function safeAppMetrics(app) {
  const metrics = safeCall(() => app.getAppMetrics?.(), []);
  return metrics.map((item) => ({
    pid: item.pid,
    type: item.type,
    name: item.name,
    cpuPercent: round(item.cpu?.percentCPUUsage || 0),
    idleWakeupsPerSecond: round(item.cpu?.idleWakeupsPerSecond || 0),
    workingSetMB: bytesToMB((item.memory?.workingSetSize || 0) * 1024),
    peakWorkingSetMB: bytesToMB((item.memory?.peakWorkingSetSize || 0) * 1024),
    privateBytesMB: bytesToMB((item.memory?.privateBytes || 0) * 1024),
    sandboxed: item.sandboxed,
    integrityLevel: item.integrityLevel
  }));
}

function rotateLogs(logPath) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size < MAX_LOG_BYTES) return;
    for (let index = ROTATION_COUNT; index >= 1; index -= 1) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
      const target = `${logPath}.${index}`;
      if (!fs.existsSync(source)) continue;
      fs.rmSync(target, { force: true });
      fs.renameSync(source, target);
    }
  } catch {
    // Rotation failure must never prevent application startup.
  }
}

function readTail(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
    fs.closeSync(fd);
    let text = buffer.toString('utf8');
    if (stat.size > size) {
      const newline = text.indexOf('\n');
      if (newline >= 0) text = text.slice(newline + 1);
      text = `<earlier log entries omitted>\n${text}`;
    }
    return text;
  } catch (error) {
    return `无法读取日志文件：${error?.message || error}`;
  }
}

function safeVersion(app) {
  return safeCall(() => app.getVersion(), 'unknown');
}

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

async function safeAsync(fn, fallback) {
  try {
    const value = await fn();
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function normalizeLevel(level) {
  const value = String(level || 'info').toLowerCase();
  return ['debug', 'info', 'warning', 'error', 'fatal'].includes(value) ? value : 'info';
}

function bytesToMB(value) {
  return round(Number(value || 0) / 1024 / 1024);
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] == null ? null : String(value[0]);
  return value == null ? null : String(value);
}

function hasHeader(headers, name) {
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === String(name).toLowerCase());
}

module.exports = {
  Diagnostics,
  sanitizeDetails,
  sanitizeUrl,
  redactString,
  readTail,
  serializeError,
  _constants: {
    MAX_LOG_BYTES,
    MAX_COPY_BYTES,
    ROTATION_COUNT
  }
};
