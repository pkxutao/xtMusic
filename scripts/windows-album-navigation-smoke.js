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
  const media = await startMediaServer(createWavBuffer(22050, 8));
  server = media.server;
  process.env.XT_MUSIC_ALBUM_NAV_MEDIA_BASE_URL = media.baseUrl;

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(root, 'scripts', 'windows-album-navigation-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true
    }
  });
  window.on('unresponsive', () => { becameUnresponsive = true; });

  await window.loadFile(path.join(rendererDir, 'index.html'));
  await waitFor(() => execute("Boolean(document.querySelector('.home-page'))"), 6000, 'home page');

  await click('[data-route="artists"]');
  await waitFor(() => execute("Boolean(document.querySelector('.artist-card'))"), 5000, 'artist list');
  await click('.artist-card strong');
  await waitFor(() => execute("Boolean(document.querySelector('.artist-albums-page'))"), 5000, 'artist album page');
  await waitFor(() => execute("document.querySelectorAll('.artist-albums-page .album-card').length === 3"), 3000, 'artist album cards');

  const artistPage = await snapshot();
  if (artistPage.albumCards !== 3 || artistPage.trackHost || artistPage.trackRows) {
    throw new Error(`Artist detail is not album-first: ${JSON.stringify(artistPage)}`);
  }
  await capture('windows-artist-albums.png');

  await click('.artist-albums-page .album-card[data-open-id="album-b"] strong');
  await waitForAlbumDetail('远山', 'artist-card');
  const fromArtist = await albumDetailMetrics();

  await click('[data-route="tracks"]');
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page .track-album-link[data-open-id=\"album-b\"]'))"), 5000, 'track album link');
  await click('.track-album-link[data-open-id="album-b"]');
  await waitForAlbumDetail('远山', 'track-table');
  const fromTrackTable = await albumDetailMetrics();

  await click('[data-route="tracks"]');
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page [data-track-action=\"play\"]'))"), 5000, 'playable track row');
  await click('.tracks-page [data-track-action="play"]');
  await waitFor(() => execute("document.querySelector('#player-album')?.textContent?.trim() === '晨光'"), 5000, 'bottom player album');
  const playerAlbum = await execute(`(() => {
    const button = document.querySelector('#player-album');
    return {
      text: button?.textContent?.trim() || '',
      openKind: button?.dataset.openKind || '',
      openId: button?.dataset.openId || '',
      disabled: Boolean(button?.disabled)
    };
  })()`);
  if (playerAlbum.openKind !== 'album' || playerAlbum.openId !== 'album-a' || playerAlbum.disabled) {
    throw new Error(`Bottom player album is not navigable: ${JSON.stringify(playerAlbum)}`);
  }
  await click('#player-album');
  await waitForAlbumDetail('晨光', 'bottom-player');
  const fromBottomPlayer = await albumDetailMetrics();

  await click('[data-route="tracks"]');
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page [data-track-action=\"play\"]'))"), 5000, 'tracks page after album');
  await click('.tracks-page [data-track-action="play"]');
  await waitFor(() => execute("document.querySelector('#player-title')?.textContent?.includes('晨光')"), 5000, 'active morning track');
  await click('#player-cover');
  await waitFor(() => execute("Boolean(document.querySelector('.lyrics-page .lyrics-album-link[data-open-id=\"album-a\"]'))"), 5000, 'now-playing album link');
  const nowPlaying = await execute(`(() => ({
    albumText: document.querySelector('.lyrics-album-link')?.textContent?.trim() || '',
    albumId: document.querySelector('.lyrics-album-link')?.dataset.openId || '',
    lyricLines: document.querySelectorAll('.lyrics-page .lyric-line').length,
    activeLines: document.querySelectorAll('.lyrics-page .lyric-line.is-active').length
  }))()`);
  if (nowPlaying.albumText !== '晨光' || nowPlaying.albumId !== 'album-a') {
    throw new Error(`Now-playing album is missing or not navigable: ${JSON.stringify(nowPlaying)}`);
  }
  await capture('windows-now-playing-album.png');
  await click('.lyrics-album-link span');
  await waitForAlbumDetail('晨光', 'now-playing');
  const fromNowPlaying = await albumDetailMetrics();

  const calls = await execute("window.xtMusic.test.getCalls()");
  const methods = calls.map((entry) => entry.method);
  if (!methods.includes('getArtistAlbums')) {
    throw new Error(`Artist page did not request albums: ${JSON.stringify(methods)}`);
  }
  if (methods.includes('getArtistTracks')) {
    throw new Error(`Renderer regressed to artist track detail: ${JSON.stringify(methods)}`);
  }

  const responsiveness = await settledLag();
  if (responsiveness > 250) throw new Error(`Renderer did not remain responsive: ${responsiveness}ms`);
  if (becameUnresponsive) throw new Error('Renderer emitted unresponsive during album navigation');

  const proof = {
    verifiedAt: new Date().toISOString(),
    artistPage,
    fromArtist,
    fromTrackTable,
    playerAlbum,
    fromBottomPlayer,
    nowPlaying,
    fromNowPlaying,
    calls: methods,
    settledLagMs: responsiveness,
    becameUnresponsive
  };
  fs.writeFileSync(path.join(proofDir, 'windows-album-navigation.json'), `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function waitForAlbumDetail(title, source) {
  try {
    await waitFor(
      () => execute(`document.querySelector('.detail-page:not(.artist-albums-page) h1')?.textContent?.trim() === ${JSON.stringify(title)}`),
      5000,
      `album detail ${title}`
    );
  } catch (error) {
    const debug = await snapshot();
    throw new Error(`${error.message}; source=${source}; debug=${JSON.stringify(debug)}`);
  }
  await waitFor(
    () => execute("document.querySelectorAll('.detail-page:not(.artist-albums-page) .track-table-row').length >= 1"),
    4000,
    `album tracks ${title}`
  );
}

async function snapshot() {
  return execute(`(() => ({
    pageClass: document.querySelector('#content-root > .page')?.className || '',
    headings: [...document.querySelectorAll('#content-root h1')].map((node) => node.textContent?.trim() || ''),
    contentText: document.querySelector('#content-root')?.innerText?.slice(0, 800) || '',
    albumCards: document.querySelectorAll('.artist-albums-page .album-card').length,
    trackHost: Boolean(document.querySelector('.artist-albums-page #track-table-host')),
    trackRows: document.querySelectorAll('.artist-albums-page .track-table-row').length,
    cardData: [...document.querySelectorAll('.artist-albums-page .album-card')].map((node) => ({
      id: node.dataset.openId || '',
      name: node.dataset.openName || ''
    })),
    calls: window.xtMusic.test.getCalls()
  }))()`);
}

async function albumDetailMetrics() {
  return execute(`(() => ({
    title: document.querySelector('.detail-page:not(.artist-albums-page) h1')?.textContent?.trim() || '',
    rows: document.querySelectorAll('.detail-page:not(.artist-albums-page) .track-table-row').length,
    albumLinks: document.querySelectorAll('.detail-page:not(.artist-albums-page) .track-album-link').length
  }))()`);
}

async function click(selector) {
  const found = await execute(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    }));
    return true;
  })()`);
  if (!found) throw new Error(`Cannot click missing selector: ${selector}`);
}

async function settledLag() {
  let final = Infinity;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    final = Number(await executeWithTimeout(`new Promise((resolve) => {
      const started = performance.now();
      setTimeout(() => resolve(performance.now() - started), 0);
    })`, 1800, 'event-loop probe'));
    await delay(100);
  }
  return final;
}

async function capture(name) {
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(proofDir, name), image.toPNG());
}

function execute(script) {
  return executeWithTimeout(script, 3000, 'renderer command');
}

function executeWithTimeout(script, timeoutMs, label) {
  return Promise.race([
    window.webContents.executeJavaScript(script),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs))
  ]);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function startMediaServer(bytes) {
  const secret = 'albumNavigationSmokeSecret_0123456789abcdef';
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
      if (request.method === 'HEAD') response.end(); else response.end(bytes);
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
    if (request.method === 'HEAD') response.end(); else response.end(body);
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
