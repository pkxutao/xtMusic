'use strict';

const { Readable } = require('node:stream');
const { XtMusicError } = require('./protocol/errors');

function registerMediaProtocol({ protocol, runtime, hlsRegistry }) {
  protocol.handle('xtmusic', async (request) => {
    try {
      const client = runtime.requireClient();
      const url = new URL(request.url);
      switch (url.hostname) {
        case 'cover':
          return proxyResource(
            client,
            client.coverUrl(decodePathId(url.pathname), url.searchParams.get('size') || 800),
            request
          );
        case 'stream':
          return proxyResource(
            client,
            client.streamUrl(decodePathId(url.pathname)),
            request,
            { cache: false }
          );
        case 'hls':
          return proxyHls(client, hlsRegistry, url, request);
        default:
          return textResponse(404, 'Unknown XT Music resource');
      }
    } catch (error) {
      const status = error.code === 'NOT_AUTHENTICATED' ? 401 : 502;
      return textResponse(status, error.message || 'Media proxy failed');
    }
  });
}

async function proxyResource(client, upstreamUrl, request, options = {}) {
  const extraHeaders = {};
  const range = request.headers.get('range');
  if (range) extraHeaders.Range = range;
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) extraHeaders['If-None-Match'] = ifNoneMatch;
  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifModifiedSince) extraHeaders['If-Modified-Since'] = ifModifiedSince;

  const response = await client.transport.requestStream(upstreamUrl, {
    ...client.resourceRequestOptions({ headers: extraHeaders, timeoutMs: 60000 }),
    method: request.method === 'HEAD' ? 'HEAD' : 'GET'
  });
  return nodeStreamResponse(response, request.method === 'HEAD', options);
}

async function proxyHls(client, registry, url, request) {
  const parts = url.pathname.split('/').filter(Boolean);
  const key = parts[0];
  const entry = registry.get(key);
  if (!entry) return textResponse(404, 'Transcode session expired');

  let upstreamUrl = entry.sourceUrl;
  if (url.searchParams.has('u')) {
    upstreamUrl = decodeBase64Url(url.searchParams.get('u'));
  }

  const response = await client.transport.requestStream(upstreamUrl, {
    ...client.resourceRequestOptions({ timeoutMs: 60000 }),
    headers: {
      ...client.resourceHeaders(),
      ...(request.headers.get('range') ? { Range: request.headers.get('range') } : {})
    }
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const isPlaylist = contentType.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(upstreamUrl);
  if (!isPlaylist) return nodeStreamResponse(response, false, { cache: false });

  const chunks = [];
  for await (const chunk of response.stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const rewritten = rewriteM3u8(text, upstreamUrl, key);
  return new Response(rewritten, {
    status: normalizeStatus(response.statusCode),
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function rewriteM3u8(text, baseUrl, key) {
  const encode = (value) => {
    const absolute = new URL(value, baseUrl).toString();
    return `xtmusic://hls/${encodeURIComponent(key)}/proxy?u=${encodeBase64Url(absolute)}`;
  };

  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (!line.startsWith('#')) return encode(line.trim());
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${encode(uri)}"`);
    })
    .join('\n');
}

function nodeStreamResponse(response, headOnly = false, options = {}) {
  const headers = new Headers();
  const pass = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
    'content-disposition'
  ];
  for (const name of pass) {
    const value = response.headers[name];
    if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (options.cache === false) headers.set('Cache-Control', 'no-store');
  if (!headers.has('Accept-Ranges')) headers.set('Accept-Ranges', 'bytes');

  const status = normalizeStatus(response.statusCode);
  const body = headOnly || status === 204 || status === 304
    ? null
    : Readable.toWeb(response.stream);
  return new Response(body, { status, headers });
}

function normalizeStatus(status) {
  const number = Number(status);
  return number >= 200 && number <= 599 ? number : 502;
}

function decodePathId(pathname) {
  const id = decodeURIComponent(String(pathname || '').replace(/^\/+/, ''));
  if (!id || id.length > 500 || /[\r\n]/.test(id)) {
    throw new XtMusicError('INVALID_MEDIA_ID', '媒体资源 ID 不正确');
  }
  return id;
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

function textResponse(status, text) {
  return new Response(String(text), {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

module.exports = {
  registerMediaProtocol,
  rewriteM3u8,
  encodeBase64Url,
  decodeBase64Url,
  decodePathId
};
