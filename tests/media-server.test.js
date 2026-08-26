'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { MediaServer } = require('../src/main/media-server');
const { HlsRegistry } = require('../src/main/services/hls-registry');

const AUDIO = createWavBuffer(8000, 1);
const SEGMENT = Buffer.from('fake-audio-segment');

function createClient() {
  return {
    streamUrl(guid) {
      return `https://nas.example/music/api/v1/track/stream?guid=${encodeURIComponent(guid)}`;
    },
    coverUrl(coverId, size) {
      return `https://nas.example/music/api/v1/static/cover?coverId=${encodeURIComponent(coverId)}&size=${size}`;
    },
    resourceRequestOptions(extra = {}) {
      return {
        headers: extra.headers || {},
        timeoutMs: extra.timeoutMs || 60000,
        allowHttp: false,
        allowSelfSigned: false,
        maxRedirects: 5
      };
    },
    transport: {
      async requestStream(rawUrl, options = {}) {
        const url = new URL(rawUrl);
        if (url.searchParams.get('guid') === 'forbidden') {
          const body = Buffer.from(JSON.stringify({ code: 403, msg: '没有读取权限' }));
          return makeResponse(403, body, { 'content-type': 'application/json' }, rawUrl);
        }
        if (url.pathname.endsWith('/index.m3u8')) {
          const body = Buffer.from([
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXT-X-MAP:URI="init.mp4"',
            '#EXTINF:4.0,',
            'segment-001.m4s',
            ''
          ].join('\n'));
          return makeResponse(200, body, {
            'content-type': 'application/vnd.apple.mpegurl',
            'content-length': String(body.length)
          }, rawUrl);
        }
        if (/\.(?:m4s|mp4)$/.test(url.pathname)) {
          return rangeResponse(SEGMENT, options.headers?.Range, 'video/mp4', rawUrl);
        }
        if (url.pathname.includes('/static/cover')) {
          const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
          return rangeResponse(body, options.headers?.Range, 'image/png', rawUrl);
        }
        return rangeResponse(AUDIO, options.headers?.Range, 'audio/wav', rawUrl);
      }
    }
  };
}

function makeServer() {
  const client = createClient();
  const hlsRegistry = new HlsRegistry();
  const server = new MediaServer({
    runtime: { requireClient: () => client },
    hlsRegistry
  });
  return { server, hlsRegistry };
}

test('loopback media server binds to 127.0.0.1 and preserves byte ranges', async (t) => {
  const { server } = makeServer();
  await server.start();
  t.after(() => server.close());

  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32,}$/);
  const response = await fetch(server.streamUrl('song-1'), {
    headers: { Range: 'bytes=0-31' }
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-range'), `bytes 0-31/${AUDIO.length}`);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await response.arrayBuffer()).byteLength, 32);
});

test('loopback media server rejects requests without its random path secret', async (t) => {
  const { server } = makeServer();
  await server.start();
  t.after(() => server.close());

  const response = await fetch(`${server.origin}/wrong-secret/stream/song-1`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'MEDIA_ROUTE_NOT_FOUND');
});

test('HLS manifests are rewritten entirely through the authenticated loopback proxy', async (t) => {
  const { server, hlsRegistry } = makeServer();
  await server.start();
  t.after(() => server.close());

  const key = hlsRegistry.register('song-hls', 'https://nas.example/transcode/index.m3u8');
  const response = await fetch(server.hlsUrl(key));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /mpegurl/);
  const manifest = await response.text();
  assert.match(manifest, new RegExp(`${escapeRegExp(server.baseUrl)}/hls/${key}/proxy\\?u=`));
  assert.doesNotMatch(manifest, /https:\/\/nas\.example/);
  assert.match(manifest, /#EXT-X-MAP:URI="http:\/\/127\.0\.0\.1:/);
});

test('upstream authorization errors become useful local playback errors', async (t) => {
  const { server } = makeServer();
  await server.start();
  t.after(() => server.close());

  const response = await fetch(server.streamUrl('forbidden'), {
    headers: { Range: 'bytes=0-1' }
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.message, '没有读取权限');
  assert.equal(server.diagnostics().recentErrors.at(-1).status, 403);
});

function rangeResponse(source, range, contentType, url) {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(range || ''));
  if (!match) {
    return makeResponse(200, source, {
      'content-type': contentType,
      'content-length': String(source.length),
      'accept-ranges': 'bytes'
    }, url);
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : source.length - 1;
  if (start >= source.length) {
    return makeResponse(416, Buffer.alloc(0), {
      'content-range': `bytes */${source.length}`,
      'accept-ranges': 'bytes'
    }, url);
  }
  const end = Math.min(requestedEnd, source.length - 1);
  const body = source.subarray(start, end + 1);
  return makeResponse(206, body, {
    'content-type': contentType,
    'content-length': String(body.length),
    'content-range': `bytes ${start}-${end}/${source.length}`,
    'accept-ranges': 'bytes'
  }, url);
}

function makeResponse(statusCode, body, headers, url) {
  return {
    statusCode,
    statusMessage: '',
    headers,
    stream: Readable.from(body),
    url
  };
}

function createWavBuffer(sampleRate, seconds) {
  const sampleCount = sampleRate * seconds;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 8000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
