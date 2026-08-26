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
let becameUnresponsive = false;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  const media = await startMediaServer(createWavBuffer(22050, 30));
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
  window.on('unresponsive', () => { becameUnresponsive = true; });

  await window.loadFile(path.join(rendererDir, 'index.html'));
  await waitFor(() => execute("Boolean(document.querySelector('.home-page'))"), 5000, 'home page');
  await execute("document.querySelector('[data-route=\"tracks\"]')?.click()");
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page [data-action=\"play-all\"]'))"), 5000, 'tracks page');
  await execute("document.querySelector('.tracks-page [data-action=\"play-all\"]')?.click()");
  await waitFor(() => execute("document.querySelector('#player-title')?.textContent === '曲目 1'"), 5000, 'active track');
  await waitFor(() => execute("document.querySelector('#player-cover')?.classList.contains('is-playing')"), 5000, 'playing visual state');
  await waitFor(() => execute("document.querySelectorAll('.now-playing-equalizer i').length === 3"), 3000, 'playing indicator');

  const entry = await execute(`(() => ({
    coverRole: document.querySelector('#player-cover')?.getAttribute('role'),
    coverTabIndex: document.querySelector('#player-cover')?.tabIndex,
    coverClickable: document.querySelector('#player-cover')?.classList.contains('is-clickable'),
    coverPlaying: document.querySelector('#player-cover')?.classList.contains('is-playing'),
    lyricsLabel: document.querySelector('#player-lyrics')?.innerText?.trim() || '',
    titleAction: document.querySelector('#player-title')?.dataset.action || null
  }))()`);
  if (entry.coverRole !== 'button' || entry.coverTabIndex !== 0 || !entry.coverClickable) {
    throw new Error(`Cover is not an accessible now-playing entry: ${JSON.stringify(entry)}`);
  }
  if (!entry.coverPlaying) throw new Error('Cover has no playing visual state');
  if (!entry.lyricsLabel.includes('歌词')) throw new Error(`Lyrics entry is not visible: ${entry.lyricsLabel}`);
  if (entry.titleAction) throw new Error(`Title still has delegated duplicate action: ${entry.titleAction}`);

  await execute("document.querySelector('#player-cover')?.click()");
  const coverResult = await waitForLyricsPage('cover');
  await execute("document.querySelector('#history-back')?.click()");
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page'))"), 3000, 'return from cover lyrics');

  await execute("document.querySelector('#player-title')?.click()");
  const titleResult = await waitForLyricsPage('title');
  await execute("document.querySelector('#history-back')?.click()");
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page'))"), 3000, 'return from title lyrics');

  await execute("document.querySelector('#player-lyrics')?.click()");
  const buttonResult = await waitForLyricsPage('button');

  if (becameUnresponsive) throw new Error('Renderer emitted unresponsive while opening lyrics');

  const proof = {
    verifiedAt: new Date().toISOString(),
    entry,
    coverResult,
    titleResult,
    buttonResult,
    becameUnresponsive
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-now-playing-smoke.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function waitForLyricsPage(source) {
  await waitFor(() => execute("document.querySelectorAll('.lyrics-page .lyric-line').length >= 3"), 4000, `${source} lyrics page`);
  await delay(1200);
  const metrics = await executeWithTimeout(`new Promise((resolve) => {
    const started = performance.now();
    requestAnimationFrame(() => setTimeout(() => resolve({
      lagMs: performance.now() - started,
      pageClass: document.querySelector('#content-root > .page')?.className || '',
      lines: document.querySelectorAll('.lyrics-page .lyric-line').length,
      enhanced: document.querySelector('.lyrics-page')?.dataset.lyricsEnhanced || '',
      equalizerBars: document.querySelectorAll('.now-playing-equalizer i').length
    }), 0));
  })`, 1800, `${source} responsiveness probe`);
  if (!metrics.pageClass.includes('lyrics-page') || metrics.lines < 3) {
    throw new Error(`${source} did not render lyrics: ${JSON.stringify(metrics)}`);
  }
  if (metrics.lagMs > 400) {
    throw new Error(`${source} lyrics event-loop lag is too high: ${metrics.lagMs}ms`);
  }
  return metrics;
}

function execute(script) {
  return executeWithTimeout(script, 2500, 'renderer command');
}

function executeWithTimeout(script, timeoutMs, label) {
  return Promise.race([
    window.webContents.executeJavaScript(script),
    new Promise((_resolve, reject) => setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      timeoutMs
    ))
  ]);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Retry until the deadline so the final error names the awaited state.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startMediaServer(bytes) {
  const secret = 'nowPlayingSmokeSecret_0123456789abcdef';
  const localServer = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges');
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
      response.end(request.method === 'HEAD' ? undefined : bytes);
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
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', resolve);
  });
  const address = localServer.address();
  return { server: localServer, baseUrl: `http://127.0.0.1:${address.port}/${secret}` };
}

function createWavBuffer(sampleRate, durationSeconds) {
  const sampleCount = sampleRate * durationSeconds;
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
