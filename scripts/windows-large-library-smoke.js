'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
let window;

app.whenReady().then(async () => {
  fs.mkdirSync(proofDir, { recursive: true });
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(root, 'scripts', 'windows-large-library-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  await window.loadFile(path.join(rendererDir, 'index.html'));
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-page'))"), 5000, 'home page');

  await evaluate("document.querySelector('[data-route=\"albums\"]')?.click()");
  await waitFor(() => evaluate("document.querySelectorAll('.library-page .media-card').length === 72"), 5000, 'bounded album page');

  const albumPageOne = await pageMetrics();
  assert(albumPageOne.cards === 72, `Expected 72 album cards, got ${albumPageOne.cards}`);
  assert(albumPageOne.nodes < 1800, `Album DOM is too large: ${albumPageOne.nodes}`);
  assert(albumPageOne.images <= 72, `Album image count is too large: ${albumPageOne.images}`);
  assert(albumPageOne.pager.includes('1 / 23'), `Unexpected album pager: ${albumPageOne.pager}`);

  let calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getAlbums', [1]);

  await evaluate("document.querySelector('[data-action=\"library-page\"][data-page=\"2\"]')?.click()");
  await waitFor(() => evaluate("document.querySelector('.library-pagination-actions strong')?.textContent.includes('2 / 23')"), 5000, 'second album page');
  const albumPageTwo = await pageMetrics();
  assert(albumPageTwo.cards === 72, `Expected 72 cards on page 2, got ${albumPageTwo.cards}`);
  assert(albumPageTwo.nodes < 1800, `Second album page DOM is too large: ${albumPageTwo.nodes}`);
  calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getAlbums', [1, 2]);

  await evaluate("document.querySelector('[data-route=\"tracks\"]')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await evaluate("document.querySelector('[data-route=\"home\"]')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.home-page'))"), 5000, 'home after stale track request');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert(await evaluate("Boolean(document.querySelector('.home-page'))"), 'Stale track response replaced the current route');

  calls = await evaluate('window.xtMusicTest.calls()');
  assertCalls(calls, 'getTracks', [1]);

  await evaluate("document.querySelector('[data-route=\"albums\"]')?.click()");
  await waitFor(() => evaluate("document.querySelectorAll('.library-page .media-card').length === 72"), 5000, 'cached bounded album page');
  await evaluate("document.querySelector('.account-summary')?.click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('[data-action=\"add-account\"]'))"), 3000, 'account modal');
  await evaluate("document.querySelector('[data-action=\"add-account\"]')?.click()");
  await waitFor(() => evaluate("!document.querySelector('#login-root')?.classList.contains('is-hidden')"), 3000, 'add account login');

  const disposed = await evaluate(`(() => ({
    nodes: document.querySelectorAll('*').length,
    contentChildren: document.querySelector('#content-root')?.childElementCount || 0,
    sidebarChildren: document.querySelector('#sidebar-root')?.childElementCount || 0,
    queueChildren: document.querySelector('#queue-panel')?.childElementCount || 0,
    images: document.images.length
  }))()`);
  assert(disposed.contentChildren === 0, `Hidden content was retained: ${disposed.contentChildren}`);
  assert(disposed.sidebarChildren === 0, `Hidden sidebar was retained: ${disposed.sidebarChildren}`);
  assert(disposed.queueChildren === 0, `Hidden queue was retained: ${disposed.queueChildren}`);
  assert(disposed.nodes < 500, `Login retained the large library DOM: ${disposed.nodes}`);

  const eventLoopLagMs = await evaluate(`new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => resolve(performance.now() - start), 0);
  })`);
  assert(eventLoopLagMs < 250, `Renderer event-loop lag is too high: ${eventLoopLagMs}ms`);

  const proof = {
    verifiedAt: new Date().toISOString(),
    totals: { tracks: 4219, albums: 1595, artists: 1005 },
    albumPageOne,
    albumPageTwo,
    disposed,
    getAlbumPages: calls.filter((item) => item.method === 'getAlbums').map((item) => item.page),
    getTrackPages: calls.filter((item) => item.method === 'getTracks').map((item) => item.page),
    eventLoopLagMs
  };
  fs.writeFileSync(
    path.join(proofDir, 'windows-large-library-smoke.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8'
  );
  await shutdown(0);
}).catch(async (error) => {
  console.error(error);
  await shutdown(1);
});

async function pageMetrics() {
  return evaluate(`(() => ({
    cards: document.querySelectorAll('.library-page .media-card').length,
    nodes: document.querySelectorAll('*').length,
    images: document.images.length,
    pager: document.querySelector('.library-pagination-actions strong')?.textContent.trim() || ''
  }))()`);
}

function assertCalls(calls, method, expectedPages) {
  const pages = calls.filter((item) => item.method === method).map((item) => item.page);
  assert(
    JSON.stringify(pages) === JSON.stringify(expectedPages),
    `${method} pages were ${JSON.stringify(pages)}, expected ${JSON.stringify(expectedPages)}`
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(source) {
  return window.webContents.executeJavaScript(source);
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function shutdown(code) {
  try {
    if (window && !window.isDestroyed()) window.destroy();
    await app.whenReady();
  } finally {
    app.exit(code);
  }
}
