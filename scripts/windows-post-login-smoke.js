'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
let window;
let server;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  const audio = createWavBuffer(22050, 2);
  const media = await startMediaServer(audio);
  server = media.server;
  process.env.XT_MUSIC_POST_LOGIN_MEDIA_BASE_URL = media.baseUrl;

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(root, 'scripts', 'windows-post-login-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  const started = Date.now();
  await window.loadFile(path.join(rendererDir, 'index.html'));
  await waitFor(() => window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.home-page'))"
  ), 5000, 'home page');
  const homeReadyMs = Date.now() - started;
  if (homeReadyMs >= 2500) {
    throw new Error(`Home waited for secondary playlists: ${homeReadyMs}ms`);
  }

  await waitFor(() => window.webContents.executeJavaScript(
    "document.querySelectorAll('.nav-playlist').length > 0"
  ), 7000, 'background playlists');
  const sidebarPlaylistRows = await window.webContents.executeJavaScript(
    "document.querySelectorAll('.nav-playlist').length"
  );
  if (sidebarPlaylistRows > 120) {
    throw new Error(`Sidebar rendered ${sidebarPlaylistRows} playlist rows`);
  }

  await window.webContents.executeJavaScript(
    "document.querySelector('[data-route=\"tracks\"]')?.click()"
  );
  await waitFor(() => window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.tracks-page [data-action=\"play-all\"]'))"
  ), 5000, 'tracks page');
  await window.webContents.executeJavaScript(
    "document.querySelector('.tracks-page [data-action=\"play-all\"]')?.click()"
  );
  await waitFor(() => window.webContents.executeJavaScript(
    "document.querySelector('#player-title')?.textContent === '曲目 1'"
  ), 5000, 'large queue activation');

  const queueClosedRows = await window.webContents.executeJavaScript(
    "document.querySelectorAll('#queue-panel .queue-row').length"
  );
  if (queueClosedRows !== 0) {
    throw new Error(`Closed queue rendered ${queueClosedRows} hidden rows`);
  }

  await window.webContents.executeJavaScript(
    "document.querySelector('#player-queue')?.click()"
  );
  await waitFor(() => window.webContents.executeJavaScript(
    "document.querySelectorAll('#queue-panel .queue-row').length > 0"
  ), 3000, 'windowed queue');
  const queueMetrics = await window.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('#queue-panel .queue-row').length,
    header: document.querySelector('#queue-panel .queue-header')?.innerText || '',
    overflowNote: document.querySelector('#queue-panel .queue-window-note')?.innerText || ''
  }))()`);
  if (queueMetrics.rows > 160) {
    throw new Error(`Open queue rendered ${queueMetrics.rows} rows`);
  }
  if (!queueMetrics.header.includes('2000')) {
    throw new Error(`Queue header lost the total: ${queueMetrics.header}`);
  }

  const eventLoopLagMs = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
  })`);
  if (eventLoopLagMs > 250) {
    throw new Error(`Renderer event-loop lag is too high: ${eventLoopLagMs}ms`);
  }

  await window.webContents.executeJavaScript(
    "document.querySelector('[data-route=\"home\"]')?.click()"
  );
  await waitFor(() => window.webContents.executeJavaScript(
    "Boolean(document.querySelector('.home-page'))"
  ), 3000, 'responsive navigation after queue stress');

  const proof = {
    verifiedAt: new Date().toISOString(),
    homeReadyMs,
    delayedPlaylistEndpointMs: 3000,
    sidebarPlaylistRows,
    queueClosedRows,
    queueOpenRows: queueMetrics.rows,
    queueHeader: queueMetrics.header,
    queueOverflowNote: queueMetrics.overflowNote,
    eventLoopLagMs
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-post-login-smoke.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function startMediaServer(bytes) {
  const secret = 'postLoginStressSecret_0123456789abcdef';
  const server = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Type, Content-Length, Content-Range, Accept-Ranges'
    );
    if (!String(request.url || '').startsWith(`/${secret}/stream/`)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/i.exec(String(request.headers.range || ''));
    if (!range) {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'audio/wav');
      response.setHeader('Content-Length', String(bytes.length));
      response.setHeader('Accept-Ranges', 'bytes');
      if (request.method === 'HEAD') response.end();
      else response.end(bytes);
      return;
    }
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
    if (start >= bytes.length || end < start) {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${bytes.length}`);
      response.end();
      return;
    }
    const body = bytes.subarray(start, end + 1);
    response.statusCode = 206;
    response.setHeader('Content-Type', 'audio/wav');
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    response.setHeader('Accept-Ranges', 'bytes');
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}/${secret}` };
}

function createWavBuffer(sampleRate, durationSeconds) {
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.15 * 32767);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}

async function shutdown(code) {
  try {
    window?.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
  } finally {
    app.exit(code);
  }
}
