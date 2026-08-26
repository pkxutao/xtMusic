'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { pipeline } = require('node:stream');
const { XtMusicError } = require('./protocol/errors');

const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const PUBLIC_HEADER_NAMES = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'content-disposition'
];

class MediaServer {
  constructor({ runtime, hlsRegistry }) {
    this.runtime = runtime;
    this.hlsRegistry = hlsRegistry;
    this.server = null;
    this.origin = '';
    this.baseUrl = '';
    this.secret = '';
    this.lastErrors = [];
  }

  async start() {
    if (this.server) return this.baseUrl;

    this.secret = crypto.randomBytes(32).toString('base64url');
    const server = http.createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        this.#recordError('server', error);
        if (!response.headersSent) {
          this.#writeError(response, error);
        } else if (!response.writableEnded) {
          response.destroy(error);
        }
      });
    });
    server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('无法确定本机媒体代理端口');
    }

    this.server = server;
    this.origin = `http://127.0.0.1:${address.port}`;
    this.baseUrl = `${this.origin}/${this.secret}`;
    return this.baseUrl;
  }

  async close() {
    const server = this.server;
    this.server = null;
    this.origin = '';
    this.baseUrl = '';
    this.secret = '';
    if (!server) return;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  streamUrl(guid) {
    return this.#resourceUrl('stream', guid);
  }

  coverUrl(coverId, size = 800) {
    const url = new URL(this.#resourceUrl('cover', coverId));
    url.searchParams.set('size', String(Math.max(48, Math.min(1600, Number(size) || 800))));
    return url.toString();
  }

  hlsUrl(key) {
    this.#requireStarted();
    return `${this.baseUrl}/hls/${encodeURIComponent(String(key))}/index.m3u8`;
  }

  diagnostics() {
    return {
      running: Boolean(this.server),
      origin: this.origin,
      recentErrors: this.lastErrors.slice(-12)
    };
  }

  #resourceUrl(kind, id) {
    this.#requireStarted();
    const value = String(id || '').trim();
    if (!value || value.length > 500 || /[\r\n]/.test(value)) {
      throw new XtMusicError('INVALID_MEDIA_ID', '媒体资源 ID 不正确');
    }
    return `${this.baseUrl}/${kind}/${encodeURIComponent(value)}`;
  }

  #hlsProxyUrl(key, upstreamUrl) {
    return `${this.baseUrl}/hls/${encodeURIComponent(String(key))}/proxy?u=${encodeBase64Url(upstreamUrl)}`;
  }

  #requireStarted() {
    if (!this.server || !this.baseUrl) {
      throw new XtMusicError('MEDIA_SERVER_NOT_READY', '本机媒体代理尚未启动');
    }
  }

  async #handle(request, response) {
    this.#setCors(response);

    let url;
    try {
      url = new URL(request.url || '/', this.origin || 'http://127.0.0.1');
    } catch {
      this.#writeJson(response, 400, {
        error: { code: 'INVALID_MEDIA_URL', message: '媒体代理地址不正确' }
      });
      return;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || !safeSecretEquals(parts[0], this.secret)) {
      this.#writeJson(response, 404, {
        error: { code: 'MEDIA_ROUTE_NOT_FOUND', message: '媒体资源不存在' }
      });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      response.setHeader('Allow', 'GET, HEAD, OPTIONS');
      this.#writeJson(response, 405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: '媒体代理只允许读取请求' }
      });
      return;
    }

    const client = this.runtime.requireClient();
    const kind = parts[1];
    if (kind === 'stream') {
      const guid = decodePathPart(parts[2]);
      await this.#proxyResource(client, client.streamUrl(guid), request, response, {
        route: `stream:${guid}`,
        cache: false,
        expectedKind: 'audio',
        fallbackContentType: 'application/octet-stream'
      });
      return;
    }
    if (kind === 'cover') {
      const coverId = decodePathPart(parts[2]);
      await this.#proxyResource(
        client,
        client.coverUrl(coverId, url.searchParams.get('size') || 800),
        request,
        response,
        {
          route: `cover:${coverId}`,
          expectedKind: 'image',
          fallbackContentType: 'image/jpeg'
        }
      );
      return;
    }
    if (kind === 'hls') {
      await this.#proxyHls(client, parts, url, request, response);
      return;
    }

    this.#writeJson(response, 404, {
      error: { code: 'MEDIA_ROUTE_NOT_FOUND', message: '媒体资源不存在' }
    });
  }

  async #proxyResource(client, upstreamUrl, request, response, options = {}) {
    const headers = forwardRequestHeaders(request);
    const upstream = await client.transport.requestStream(upstreamUrl, {
      ...client.resourceRequestOptions({ headers, timeoutMs: 60000 }),
      method: request.method === 'HEAD' ? 'HEAD' : 'GET'
    });

    if (!isSuccessfulMediaStatus(upstream.statusCode)) {
      await this.#handleUpstreamError(upstream, response, options.route || 'resource');
      return;
    }

    if (hasUnexpectedMediaContentType(upstream.headers, options.expectedKind)) {
      await this.#handleUpstreamError(
        upstream,
        response,
        options.route || 'resource',
        502
      );
      return;
    }

    this.#sendUpstreamStream(upstream, request, response, options);
  }

  async #proxyHls(client, parts, url, request, response) {
    const key = decodePathPart(parts[2]);
    const entry = this.hlsRegistry.get(key);
    if (!entry) {
      this.#writeJson(response, 404, {
        error: { code: 'TRANSCODE_SESSION_EXPIRED', message: '转码会话已失效，请重新播放' }
      });
      return;
    }

    let upstreamUrl = entry.sourceUrl;
    if (url.searchParams.has('u')) upstreamUrl = decodeBase64Url(url.searchParams.get('u'));

    const headers = forwardRequestHeaders(request);
    const upstream = await client.transport.requestStream(upstreamUrl, {
      ...client.resourceRequestOptions({ headers, timeoutMs: 60000 }),
      method: request.method === 'HEAD' ? 'HEAD' : 'GET'
    });

    if (!isSuccessfulMediaStatus(upstream.statusCode)) {
      await this.#handleUpstreamError(upstream, response, `hls:${key}`);
      return;
    }

    const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
    const isPlaylist =
      contentType.includes('mpegurl') ||
      /\.m3u8(?:$|\?)/i.test(upstreamUrl);

    if (!isPlaylist || request.method === 'HEAD') {
      this.#sendUpstreamStream(upstream, request, response, {
        route: `hls:${key}`,
        cache: false,
        fallbackContentType: isPlaylist
          ? 'application/vnd.apple.mpegurl'
          : 'application/octet-stream'
      });
      return;
    }

    const body = await readLimited(upstream.stream, MAX_PLAYLIST_BYTES);
    const rewritten = rewriteM3u8(
      body.toString('utf8').replace(/^\uFEFF/, ''),
      upstreamUrl,
      (absolute) => this.#hlsProxyUrl(key, absolute)
    );
    const bytes = Buffer.from(rewritten, 'utf8');
    response.statusCode = normalizeStatus(upstream.statusCode);
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Cache-Control', 'no-store');
    response.end(bytes);
  }

  #sendUpstreamStream(upstream, request, response, options = {}) {
    response.statusCode = normalizeStatus(upstream.statusCode);
    for (const name of PUBLIC_HEADER_NAMES) {
      const value = upstream.headers[name];
      if (value == null) continue;
      response.setHeader(name, Array.isArray(value) ? value.join(', ') : String(value));
    }
    if (!response.hasHeader('Content-Type') && options.fallbackContentType) {
      response.setHeader('Content-Type', options.fallbackContentType);
    }
    if (options.cache === false) response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'HEAD' || [204, 304].includes(response.statusCode)) {
      upstream.stream.resume();
      response.end();
      return;
    }

    const abort = () => {
      if (!upstream.stream.destroyed) upstream.stream.destroy();
    };
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    pipeline(upstream.stream, response, (error) => {
      if (error && !response.destroyed) response.destroy(error);
    });
  }

  async #handleUpstreamError(upstream, response, route, preferredStatus = null) {
    let preview = '';
    try {
      preview = (await readLimited(upstream.stream, MAX_ERROR_BYTES)).toString('utf8').trim();
    } catch {
      preview = '';
    }
    const parsed = parseUpstreamError(preview);
    const upstreamStatus = normalizeStatus(upstream.statusCode);
    const status = preferredStatus || upstreamStatus;
    const error = new XtMusicError(
      parsed.code || `MEDIA_HTTP_${upstreamStatus}`,
      parsed.message || mediaStatusMessage(upstreamStatus),
      { status: upstreamStatus, route }
    );
    this.#recordError(route, error);
    this.#writeError(response, error, status);
  }

  #recordError(route, error) {
    this.lastErrors.push({
      at: new Date().toISOString(),
      route: String(route || 'media').slice(0, 600),
      code: String(error?.code || 'MEDIA_PROXY_ERROR').slice(0, 100),
      message: String(error?.message || error || '媒体代理错误').slice(0, 600),
      status: Number(error?.details?.status || 0) || null
    });
    if (this.lastErrors.length > 30) this.lastErrors.splice(0, this.lastErrors.length - 30);
  }

  #setCors(response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Range, If-None-Match, If-Modified-Since, Cache-Control'
    );
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified'
    );
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-XTMusic-Media-Proxy', 'loopback');
  }

  #writeError(response, error, preferredStatus = null) {
    const status = preferredStatus || statusForError(error);
    this.#writeJson(response, status, {
      error: {
        code: String(error?.code || 'MEDIA_PROXY_ERROR'),
        message: String(error?.message || '媒体代理请求失败'),
        status
      }
    });
  }

  #writeJson(response, status, value) {
    if (response.writableEnded) return;
    const bytes = Buffer.from(JSON.stringify(value), 'utf8');
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Cache-Control', 'no-store');
    response.end(bytes);
  }
}

function forwardRequestHeaders(request) {
  const headers = {
    Accept: request.headers.accept || 'audio/*, application/vnd.apple.mpegurl, */*;q=0.8'
  };
  for (const [incoming, outgoing] of [
    ['range', 'Range'],
    ['if-none-match', 'If-None-Match'],
    ['if-modified-since', 'If-Modified-Since'],
    ['cache-control', 'Cache-Control']
  ]) {
    const value = request.headers[incoming];
    if (value) headers[outgoing] = String(value);
  }
  return headers;
}

function hasUnexpectedMediaContentType(headers, expectedKind) {
  if (!expectedKind) return false;
  const raw = headers?.['content-type'];
  const value = String(Array.isArray(raw) ? raw[0] : raw || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!value) return false;
  if (['application/json', 'text/html', 'application/xhtml+xml'].includes(value)) return true;
  if (expectedKind === 'audio') {
    return value.startsWith('text/') && !value.includes('mpegurl');
  }
  if (expectedKind === 'image') {
    return !value.startsWith('image/') && value !== 'application/octet-stream';
  }
  return false;
}

function isSuccessfulMediaStatus(status) {
  const value = Number(status);
  return (value >= 200 && value < 300) || value === 304 || value === 416;
}

function normalizeStatus(status) {
  const value = Number(status);
  return value >= 100 && value <= 599 ? value : 502;
}

function mediaStatusMessage(status) {
  if (status === 401) return '音频鉴权失败，登录状态可能已失效';
  if (status === 403) return '服务器拒绝读取这首歌曲，请检查音乐账号权限或访问安全码';
  if (status === 404) return '服务器找不到这首歌曲的音频文件';
  if (status === 416) return '服务器拒绝了音频分段请求，请重新播放';
  if (status >= 500) return `飞牛音乐服务返回错误（HTTP ${status}）`;
  return `音频请求失败（HTTP ${status}）`;
}

function parseUpstreamError(text) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    const message = value?.error?.message || value?.msg || value?.message;
    const code = value?.error?.code || value?.code;
    return {
      code: code == null ? null : String(code),
      message: message == null ? null : String(message)
    };
  } catch {
    const compact = String(text).replace(/\s+/g, ' ').trim();
    if (!compact || compact.startsWith('<!DOCTYPE') || compact.startsWith('<html')) return {};
    return { message: compact.slice(0, 500) };
  }
}

function statusForError(error) {
  if (error?.code === 'NOT_AUTHENTICATED' || error?.code === 'SESSION_EXPIRED') return 401;
  if (error?.code === 'INVALID_MEDIA_ID' || error?.code === 'INVALID_HLS_URL') return 400;
  if (error?.code === 'MEDIA_ROUTE_NOT_FOUND') return 404;
  return 502;
}

function decodePathPart(value) {
  try {
    const decoded = decodeURIComponent(String(value || ''));
    if (!decoded || decoded.length > 500 || /[\r\n]/.test(decoded)) throw new Error('bad id');
    return decoded;
  } catch {
    throw new XtMusicError('INVALID_MEDIA_ID', '媒体资源 ID 不正确');
  }
}

function safeSecretEquals(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(String(received));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readLimited(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new XtMusicError('MEDIA_RESPONSE_TOO_LARGE', '媒体服务响应过大');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function rewriteM3u8(text, baseUrl, toProxyUrl) {
  const encode = (value) => toProxyUrl(new URL(value, baseUrl).toString());
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (!line.startsWith('#')) return encode(line.trim());
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${encode(uri)}"`);
    })
    .join('\n');
}

function encodeBase64Url(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function decodeBase64Url(value) {
  try {
    const decoded = Buffer.from(String(value || ''), 'base64url').toString('utf8');
    const url = new URL(decoded);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url.toString();
  } catch {
    throw new XtMusicError('INVALID_HLS_URL', 'HLS 资源地址不正确');
  }
}

module.exports = {
  MediaServer,
  rewriteM3u8,
  encodeBase64Url,
  decodeBase64Url,
  _internals: {
    forwardRequestHeaders,
    isSuccessfulMediaStatus,
    mediaStatusMessage,
    parseUpstreamError,
    hasUnexpectedMediaContentType,
    safeSecretEquals
  }
};
