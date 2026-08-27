'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const now = () => globalThis.performance?.now?.() ?? Date.now();

async function invoke(channel, payload) {
  const started = now();
  const details = safeIpcDetails(channel, payload);
  if (!channel.startsWith('diagnostics:')) {
    sendDiagnostic(`${channel}:invoke-start`, details, 'debug');
  }
  try {
    const result = await ipcRenderer.invoke(channel, payload);
    const durationMs = round(now() - started);
    if (!channel.startsWith('diagnostics:')) {
      sendDiagnostic(
        `${channel}:${result?.ok ? 'invoke-success' : 'invoke-error'}`,
        {
          ...details,
          durationMs,
          result: summarizeResult(channel, result?.data),
          error: result?.ok ? null : {
            code: result?.error?.code,
            message: result?.error?.message
          }
        },
        result?.ok ? 'debug' : 'error'
      );
    }
    if (result?.ok) return result.data;
    const error = new Error(result?.error?.message || '操作失败');
    error.code = result?.error?.code || 'UNKNOWN';
    error.details = result?.error?.details || null;
    throw error;
  } catch (error) {
    if (!channel.startsWith('diagnostics:')) {
      sendDiagnostic(`${channel}:invoke-rejected`, {
        ...details,
        durationMs: round(now() - started),
        error: {
          name: error?.name,
          code: error?.code,
          message: error?.message
        }
      }, 'error');
    }
    throw error;
  }
}

function sendDiagnostic(event, details = {}, level = 'info') {
  try {
    ipcRenderer.send('diagnostics:renderer-log', {
      event: String(event || 'preload:event').slice(0, 160),
      level: String(level || 'info').slice(0, 20),
      details: details && typeof details === 'object' ? details : { value: String(details) }
    });
  } catch {
    // Diagnostics must never break the renderer/preload bridge.
  }
}

const sessionType = String(process.env.XDG_SESSION_TYPE || '').toLowerCase();
const environment = Object.freeze({
  platform: process.platform,
  isLinux: process.platform === 'linux',
  isWayland: process.platform === 'linux' && (
    sessionType === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)
  ),
  sessionType,
  diagnosticsEnabled: true,
  mediaBaseUrl: /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32,}$/.test(
    String(process.env.XT_MUSIC_MEDIA_BASE_URL || '')
  ) ? String(process.env.XT_MUSIC_MEDIA_BASE_URL) : null
});

contextBridge.exposeInMainWorld('xtMusic', Object.freeze({
  environment,
  bootstrap: () => invoke('app:bootstrap'),
  auth: Object.freeze({
    connect: (payload) => invoke('auth:connect', payload),
    switchAccount: (id) => invoke('auth:switch', id),
    logout: (options) => invoke('auth:logout', options),
    removeAccount: (id) => invoke('auth:remove', id),
    listAccounts: () => invoke('auth:list')
  }),
  music: Object.freeze({
    call: (method, args = {}) => invoke('music:call', { method, args })
  }),
  settings: Object.freeze({
    get: () => invoke('settings:get'),
    set: (key, value) => invoke('settings:set', { key, value })
  }),
  cache: Object.freeze({
    clear: () => invoke('cache:clear')
  }),
  window: Object.freeze({
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized')
  }),
  player: Object.freeze({
    publishState: (state) => ipcRenderer.send('player:state', state),
    diagnostics: () => invoke('player:diagnostics')
  }),
  diagnostics: Object.freeze({
    log: (event, details = {}, level = 'info') => sendDiagnostic(event, details, level),
    info: () => invoke('diagnostics:info'),
    snapshot: (reason = 'renderer-request') => invoke('diagnostics:snapshot', reason),
    copy: () => invoke('diagnostics:copy'),
    openFolder: () => invoke('diagnostics:open-folder')
  }),
  events: Object.freeze({
    onAuthProgress: (listener) => subscribe('auth:progress', listener),
    onPlayerCommand: (listener) => subscribe('player:command', listener),
    onWindowMaximized: (listener) => subscribe('window:maximized', listener),
    onSystemTheme: (listener) => subscribe('theme:system', listener)
  })
}));

sendDiagnostic('preload:ready', {
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  hasMediaBaseUrl: Boolean(environment.mediaBaseUrl)
});

function subscribe(channel, listener) {
  if (typeof listener !== 'function') return () => {};
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function safeIpcDetails(channel, payload) {
  if (channel === 'auth:connect') {
    return {
      serverKind: /^https?:\/\//i.test(String(payload?.serverInput || '')) ? 'url' : 'fnid',
      serverInputLength: String(payload?.serverInput || '').length,
      usernameLength: String(payload?.username || '').length,
      hasAccessCode: Boolean(payload?.accessCode),
      allowHttp: Boolean(payload?.allowHttp),
      allowSelfSigned: Boolean(payload?.allowSelfSigned),
      rememberSession: Boolean(payload?.rememberSession)
    };
  }
  if (channel === 'music:call') {
    const args = payload?.args || {};
    return {
      method: String(payload?.method || ''),
      page: finiteNumber(args.page),
      size: finiteNumber(args.size),
      queryLength: String(args.query || '').length,
      guidCount: Array.isArray(args.trackGUIDs) ? args.trackGUIDs.length : undefined,
      hasGuid: Boolean(args.guid || args.trackGUID || args.albumGUID || args.artistGUID || args.genreGUID || args.playlistGUID)
    };
  }
  if (channel === 'settings:set') return { key: String(payload?.key || '').slice(0, 100) };
  if (channel.startsWith('diagnostics:')) return {};
  return payload == null ? {} : { payloadType: Array.isArray(payload) ? 'array' : typeof payload };
}

function summarizeResult(channel, data) {
  if (channel === 'app:bootstrap') {
    return {
      hasSession: Boolean(data?.session),
      accountCount: Array.isArray(data?.accounts) ? data.accounts.length : 0,
      hasMediaBaseUrl: Boolean(data?.mediaBaseUrl),
      version: data?.version
    };
  }
  if (channel.startsWith('auth:')) {
    return {
      hasSession: Boolean(data?.session),
      accountCount: Array.isArray(data?.accounts) ? data.accounts.length : undefined,
      hasConnection: Boolean(data?.connection)
    };
  }
  if (Array.isArray(data)) return { type: 'array', length: data.length };
  if (!data || typeof data !== 'object') return { type: typeof data };
  const result = { type: 'object' };
  if (Array.isArray(data.list)) result.listLength = data.list.length;
  if (Number.isFinite(Number(data.total))) result.total = Number(data.total);
  for (const key of ['history', 'favorites', 'albums', 'artists', 'playlists', 'tracks']) {
    if (Array.isArray(data[key]?.list)) result[`${key}Length`] = data[key].list.length;
    if (Number.isFinite(Number(data[key]?.total))) result[`${key}Total`] = Number(data[key].total);
  }
  if (data.text != null) result.textLength = String(data.text).length;
  if (data.url != null) result.hasUrl = true;
  return result;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
