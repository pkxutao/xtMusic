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
  const media = await startMediaServer(createWavBuffer(22050, 10));
  server = media.server;
  process.env.XT_MUSIC_ARTIST_TABS_MEDIA_BASE_URL = media.baseUrl;

  window = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(root, 'scripts', 'windows-artist-navigation-tabs-preload.js'),
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

  // Song-table artist names must be independent entity links.
  await click('[data-route="tracks"]');
  await waitFor(
    () => execute("Boolean(document.querySelector('.track-artist-links .artist-link[data-open-id=\"artist-1\"]'))"),
    6000,
    'track artist link'
  );
  const trackLink = await execute(`(() => {
    const link = document.querySelector('.track-artist-links .artist-link[data-open-id="artist-1"]');
    return { text: link?.textContent?.trim() || '', kind: link?.dataset.openKind || '', id: link?.dataset.openId || '' };
  })()`);
  if (trackLink.kind !== 'artist' || trackLink.id !== 'artist-1') {
    throw new Error(`Track artist is not navigable: ${JSON.stringify(trackLink)}`);
  }
  await click('.track-artist-links .artist-link[data-open-id="artist-1"]');
  await waitForArtistTab('tracks');

  const songsTab = await artistSnapshot();
  if (songsTab.activeTab !== 'tracks' || songsTab.trackRows < 1 || songsTab.albumCards !== 0) {
    throw new Error(`Artist songs tab is invalid: ${JSON.stringify(songsTab)}`);
  }
  await capture('windows-artist-songs-tab.png');

  // The list-level play button must enqueue and start the artist songs.
  await click('.artist-tab-heading [data-action="play-all"]');
  await waitFor(
    () => execute("document.querySelector('#player-title')?.textContent?.trim() === '晨光 · 曲目 1'"),
    6000,
    'artist list playback'
  );
  const playerArtist = await execute(`(() => {
    const button = document.querySelector('#player-artist');
    return {
      text: button?.textContent?.trim() || '',
      kind: button?.dataset.openKind || '',
      id: button?.dataset.openId || '',
      disabled: Boolean(button?.disabled)
    };
  })()`);
  if (playerArtist.kind !== 'artist' || playerArtist.id !== 'artist-1' || playerArtist.disabled) {
    throw new Error(`Bottom-player artist is not navigable: ${JSON.stringify(playerArtist)}`);
  }

  // Album tab preserves the existing album-card grid and album navigation.
  await click('[data-action="artist-tab"][data-artist-tab="albums"]');
  await waitForArtistTab('albums');
  await waitFor(
    () => execute("document.querySelectorAll('.artist-albums-page .album-card').length === 3"),
    3000,
    'artist album grid'
  );
  const albumsTab = await artistSnapshot();
  if (albumsTab.activeTab !== 'albums' || albumsTab.albumCards !== 3 || albumsTab.trackHost) {
    throw new Error(`Artist albums tab is invalid: ${JSON.stringify(albumsTab)}`);
  }
  await capture('windows-artist-albums-tab.png');
  await click('.artist-albums-page .album-card[data-open-id="album-b"] strong');
  await waitFor(
    () => execute("document.querySelector('.detail-page:not(.artist-albums-page) h1')?.textContent?.trim() === '远山'"),
    5000,
    'album detail from artist'
  );

  // Bottom-player artist, lyrics artist, and queue artist links must all route back.
  await click('#player-artist');
  await waitForArtistTab('tracks');

  await click('#player-cover');
  await waitFor(
    () => execute("Boolean(document.querySelector('.lyrics-artist-links .artist-link[data-open-id=\"artist-1\"]'))"),
    5000,
    'lyrics artist link'
  );
  await click('.lyrics-artist-links .artist-link[data-open-id="artist-1"]');
  await waitForArtistTab('tracks');

  await click('#player-queue');
  await waitFor(
    () => execute("Boolean(document.querySelector('.queue-artist-links .artist-link[data-open-id=\"artist-1\"]'))"),
    4000,
    'queue artist link'
  );
  await click('.queue-artist-links .artist-link[data-open-id="artist-1"]');
  await waitForArtistTab('tracks');

  const calls = await execute('window.xtMusic.test.getCalls()');
  const artistTrackCalls = calls.filter((entry) => entry.method === 'getArtistTracks');
  if (!artistTrackCalls.length) throw new Error(`Artist page did not load artist tracks: ${JSON.stringify(calls)}`);
  if (calls.some((entry) => entry.method === 'getArtistAlbums')) {
    throw new Error(`Artist detail made a duplicate album request: ${JSON.stringify(calls)}`);
  }

  const responsiveness = await settledLag();
  if (responsiveness > 250) throw new Error(`Renderer did not remain responsive: ${responsiveness}ms`);
  if (becameUnresponsive) throw new Error('Renderer emitted unresponsive during artist navigation');

  const proof = {
    verifiedAt: new Date().toISOString(),
    trackLink,
    songsTab,
    albumsTab,
    playerArtist,
    artistTrackCallCount: artistTrackCalls.length,
    settledLagMs: responsiveness,
    becameUnresponsive
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-artist-navigation-tabs.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  try {
    if (window && !window.isDestroyed()) {
      const debug = await artistSnapshot().catch(() => null);
      console.error('Artist navigation debug:', debug);
    }
  } finally {
    await shutdown(1);
  }
});

async function waitForArtistTab(tab) {
  await waitFor(
    () => execute(`document.querySelector('.artist-albums-page')?.dataset.artistActiveTab === ${JSON.stringify(tab)}`),
    6000,
    `artist ${tab} tab`
  );
  if (tab === 'tracks') {
    await waitFor(
      () => execute("document.querySelectorAll('.artist-albums-page .track-table-row').length >= 1"),
      4000,
      'artist track rows'
    );
  }
}

async function artistSnapshot() {
  return execute(`(() => ({
    pageClass: document.querySelector('#content-root > .page')?.className || '',
    activeTab: document.querySelector('.artist-albums-page')?.dataset.artistActiveTab || '',
    heading: document.querySelector('.artist-albums-page h1')?.textContent?.trim() || '',
    trackHost: Boolean(document.querySelector('.artist-albums-page #track-table-host')),
    trackRows: document.querySelectorAll('.artist-albums-page .track-table-row').length,
    albumCards: document.querySelectorAll('.artist-albums-page .album-card').length,
    playListButtons: [...document.querySelectorAll('.artist-albums-page [data-action="play-all"]')]
      .map((node) => node.textContent?.trim() || ''),
    tabs: [...document.querySelectorAll('.artist-detail-tab')].map((node) => ({
      tab: node.dataset.artistTab || '',
      selected: node.getAttribute('aria-selected'),
      text: node.textContent?.trim() || ''
    }))
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
  return executeWithTimeout(script, 3500, 'renderer command');
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
  const secret = 'artistNavigationTabsSmokeSecret_0123456789';
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
