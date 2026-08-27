'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
const userDataDir = path.join(root, '.tmp-track-list-typography');
app.setPath('userData', userDataDir);

let window;
let becameUnresponsive = false;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });

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
  await click('[data-route="tracks"]');
  await waitFor(() => execute("Boolean(document.querySelector('.tracks-page .track-table-row'))"), 6000, 'song list rows');

  const metrics = await execute(`(() => {
    const px = (selector) => {
      const node = document.querySelector(selector);
      return node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0;
    };
    const row = document.querySelector('.tracks-page .track-table-row');
    return {
      rowHeight: row?.getBoundingClientRect().height || 0,
      header: px('.tracks-page .track-table-head'),
      index: px('.tracks-page .track-col-index'),
      title: px('.tracks-page .track-row-title'),
      artist: px('.tracks-page .track-row-subtitle'),
      album: px('.tracks-page .track-album-link'),
      date: px('.tracks-page .track-col-date'),
      duration: px('.tracks-page .track-col-duration'),
      renderedRows: document.querySelectorAll('.tracks-page .track-table-row').length,
      albumLinkId: document.querySelector('.tracks-page .track-album-link')?.dataset.openId || ''
    };
  })()`);

  const minimums = {
    rowHeight: 64,
    header: 12,
    index: 12,
    title: 14,
    artist: 12,
    album: 12,
    date: 12,
    duration: 12
  };
  for (const [name, minimum] of Object.entries(minimums)) {
    if (metrics[name] + 0.01 < minimum) {
      throw new Error(`Song-list ${name} is too small: ${metrics[name]} < ${minimum}`);
    }
  }
  if (metrics.renderedRows < 1) throw new Error('No virtual song rows were rendered');
  if (!metrics.albumLinkId) throw new Error('Album link disappeared from the enlarged song list');

  await capture('windows-track-list-larger-text.png');

  const settledLagMs = await settledLag();
  if (settledLagMs > 250) throw new Error(`Renderer responsiveness regressed: ${settledLagMs}ms`);
  if (becameUnresponsive) throw new Error('Renderer emitted unresponsive while rendering larger song-list text');

  const proof = {
    verifiedAt: new Date().toISOString(),
    metrics,
    minimums,
    settledLagMs,
    becameUnresponsive
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-track-list-typography.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function click(selector) {
  const found = await execute(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!found) throw new Error(`Cannot click missing selector: ${selector}`);
}

async function capture(name) {
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(proofDir, name), image.toPNG());
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

function execute(script) {
  return executeWithTimeout(script, 3000, 'renderer command');
}

function executeWithTimeout(script, timeoutMs, label) {
  return Promise.race([
    window.webContents.executeJavaScript(script),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    })
  ]);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(code) {
  try {
    window?.destroy();
  } finally {
    app.exit(code);
  }
}
