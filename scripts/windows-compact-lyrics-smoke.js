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
  const media = await startMediaServer(createWavBuffer(22050, 4));
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
  await waitFor(
    () => execute("Boolean(document.querySelector('.tracks-page [data-action=\"play-all\"]'))"),
    5000,
    'tracks page'
  );
  await execute("document.querySelector('.tracks-page [data-action=\"play-all\"]')?.click()");
  await waitFor(
    () => execute("document.querySelector('#player-title')?.textContent === '曲目 1'"),
    5000,
    'active track'
  );
  await execute("document.querySelector('#player-cover')?.click()");
  await waitFor(
    () => execute("document.querySelectorAll('.lyrics-page .lyric-line').length >= 3"),
    5000,
    'lyrics page'
  );
  await waitFor(
    () => execute("document.querySelectorAll('.lyrics-page .lyric-line.is-active').length === 1"),
    3000,
    'single active lyric line'
  );
  await delay(700);

  const metrics = await execute(`(() => {
    const active = document.querySelector('.lyrics-page .lyric-line.is-active');
    const inactive = document.querySelector('.lyrics-page .lyric-line:not(.is-active)');
    const activeStyle = active ? getComputedStyle(active) : null;
    const inactiveStyle = inactive ? getComputedStyle(inactive) : null;
    const sheets = [...document.styleSheets]
      .map((sheet) => String(sheet.href || ''))
      .filter(Boolean);
    return {
      activeCount: document.querySelectorAll('.lyrics-page .lyric-line.is-active').length,
      activeText: active?.textContent?.trim() || '',
      activeFontSizePx: activeStyle ? Number.parseFloat(activeStyle.fontSize) : null,
      inactiveFontSizePx: inactiveStyle ? Number.parseFloat(inactiveStyle.fontSize) : null,
      activeColor: activeStyle?.color || '',
      activeTextFillColor: activeStyle?.webkitTextFillColor || '',
      activeBackgroundImage: activeStyle?.backgroundImage || '',
      activeBackgroundColor: activeStyle?.backgroundColor || '',
      baseSheetIndex: sheets.findIndex((href) => href.endsWith('/lyrics-experience.css')),
      compactSheetIndex: sheets.findIndex((href) => href.endsWith('/lyrics-line-mode.css')),
      enhanced: document.querySelector('.lyrics-page')?.dataset.lyricsEnhanced || ''
    };
  })()`);

  if (metrics.activeCount !== 1) {
    throw new Error(`Expected exactly one active lyric line: ${JSON.stringify(metrics)}`);
  }
  if (metrics.enhanced !== 'true') {
    throw new Error(`Lyrics enhancement is not active: ${JSON.stringify(metrics)}`);
  }
  if (!Number.isFinite(metrics.activeFontSizePx) || metrics.activeFontSizePx > 28) {
    throw new Error(`Active lyric font is not compact: ${JSON.stringify(metrics)}`);
  }
  if (!Number.isFinite(metrics.inactiveFontSizePx) || metrics.inactiveFontSizePx > 28) {
    throw new Error(`Inactive lyric font is not compact: ${JSON.stringify(metrics)}`);
  }
  if (metrics.activeBackgroundImage !== 'none') {
    throw new Error(`Active lyric still uses progressive image fill: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.activeColor || metrics.activeColor === 'rgba(0, 0, 0, 0)') {
    throw new Error(`Active lyric text is transparent: ${JSON.stringify(metrics)}`);
  }
  if (metrics.compactSheetIndex <= metrics.baseSheetIndex || metrics.baseSheetIndex < 0) {
    throw new Error(`Compact lyric stylesheet order is wrong: ${JSON.stringify(metrics)}`);
  }
  if (becameUnresponsive) {
    throw new Error('Renderer emitted unresponsive while validating compact lyrics');
  }

  await window.webContents.capturePage().then((image) => {
    fs.writeFileSync(path.join(proofDir, 'windows-compact-lyrics.png'), image.toPNG());
  });
  fs.writeFileSync(
    path.join(proofDir, 'windows-compact-lyrics.json'),
    `${JSON.stringify({ verifiedAt: new Date().toISOString(), becameUnresponsive, ...metrics }, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

function execute(script) {
  return window.webContents.executeJavaScript(script);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Retry until the deadline so the final message identifies the awaited state.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startMediaServer(bytes) {
  const secret = 'compactLyricsSmokeSecret_0123456789abcdef';
  const localServer = http.createServer((request, response) => {
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
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', resolve);
  });
  const address = localServer.address();
  return { server: localServer, baseUrl: `http://127.0.0.1:${address.port}/${secret}` };
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
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.12 * 32767);
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
