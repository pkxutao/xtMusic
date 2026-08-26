'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { app, BrowserWindow } = require('electron');
const { MediaServer } = require('../src/main/media-server');
const { HlsRegistry } = require('../src/main/services/hls-registry');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const proofDir = path.resolve(__dirname, '..', 'ui-proof');
const audio = createWavBuffer(22050, 2);
let mediaServer;
let window;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  const client = createFakeClient(audio);
  mediaServer = new MediaServer({
    runtime: { requireClient: () => client },
    hlsRegistry: new HlsRegistry()
  });
  await mediaServer.start();

  const htmlPath = path.join(app.getPath('temp'), 'xtmusic-media-smoke.html');
  fs.writeFileSync(htmlPath, `<!doctype html>
    <html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; media-src http://127.0.0.1:*; connect-src http://127.0.0.1:*; script-src 'none'; style-src 'unsafe-inline'">
    </head><body><p>XT Music media smoke</p></body></html>`, 'utf8');

  window = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    backgroundColor: '#0b0d12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  await window.loadFile(htmlPath);

  const source = mediaServer.streamUrl('windows-smoke');
  const metrics = await window.webContents.executeJavaScript(`(async () => {
    const source = ${JSON.stringify(source)};
    const probe = await fetch(source, {
      headers: { Range: 'bytes=0-63', 'Cache-Control': 'no-store' },
      cache: 'no-store'
    });
    const probeBytes = (await probe.arrayBuffer()).byteLength;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    document.body.append(audio);
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('loadedmetadata timeout')), 15000);
      audio.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        resolve({
          duration: audio.duration,
          readyState: audio.readyState,
          networkState: audio.networkState
        });
      }, { once: true });
      audio.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('HTMLAudioElement error code ' + (audio.error?.code || 0)));
      }, { once: true });
    });
    audio.src = source;
    audio.load();
    return {
      probeStatus: probe.status,
      probeBytes,
      probeContentRange: probe.headers.get('content-range'),
      probeContentType: probe.headers.get('content-type'),
      ...(await loaded)
    };
  })()`);

  if (![200, 206].includes(metrics.probeStatus)) {
    throw new Error(`Unexpected probe status ${metrics.probeStatus}`);
  }
  if (metrics.probeBytes !== 64) throw new Error(`Unexpected probe length ${metrics.probeBytes}`);
  if (!Number.isFinite(metrics.duration) || metrics.duration < 1.5) {
    throw new Error(`Invalid decoded duration ${metrics.duration}`);
  }
  if (metrics.readyState < 1) throw new Error(`Invalid readyState ${metrics.readyState}`);

  fs.writeFileSync(
    path.join(proofDir, 'windows-media-smoke.json'),
    `${JSON.stringify({ verifiedAt: new Date().toISOString(), ...metrics }, null, 2)}\n`,
    'utf8'
  );
  fs.rmSync(htmlPath, { force: true });
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function shutdown(code) {
  try {
    window?.destroy();
    await mediaServer?.close();
  } finally {
    app.exit(code);
  }
}

function createFakeClient(bytes) {
  return {
    streamUrl(guid) {
      return `https://nas.invalid/music/api/v1/track/stream?guid=${encodeURIComponent(guid)}`;
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
        const range = /^bytes=(\d+)-(\d*)$/i.exec(String(options.headers?.Range || ''));
        if (!range) {
          return response(200, bytes, {
            'content-type': 'audio/wav',
            'content-length': String(bytes.length),
            'accept-ranges': 'bytes'
          }, rawUrl);
        }
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
        if (start >= bytes.length) {
          return response(416, Buffer.alloc(0), {
            'content-range': `bytes */${bytes.length}`,
            'accept-ranges': 'bytes'
          }, rawUrl);
        }
        const body = bytes.subarray(start, end + 1);
        return response(206, body, {
          'content-type': 'audio/wav',
          'content-length': String(body.length),
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          'accept-ranges': 'bytes'
        }, rawUrl);
      }
    }
  };
}

function response(statusCode, body, headers, url) {
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
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 6000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}
