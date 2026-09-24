'use strict';

// End-to-end test against a loopback-only mock NAS. The actual application,
// preload, IPC, HTTP client, audio proxy and IndexedDB storage are unmodified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const proofDir = path.join(root, 'ui-proof');
const label = `full-library-${process.platform}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xtmusic-library-e2e-'));
let child, socket, server, log;
let id = 0;
const waiting = new Map();
const requests = [];
const streams = [];
const proof = { platform: process.platform, arch: process.arch, checks: [], mockNAS: true,
  sandboxDisabled: process.env.XT_LOCAL_CONTAINER_NO_SANDBOX === '1' };
let mode = 'normal';
let origin;

async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const p = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return p;
}

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const request = ++id;
    const timer = setTimeout(() => { waiting.delete(request); reject(Error(`CDP timed out: ${method}`)); }, 15000);
    waiting.set(request, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: request, method, params }));
  });
}

async function execute(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await execute(expression);
    if (result) return result;
    await delay(100);
  }
  throw Error(`Timed out: ${description}; page=${await execute('document.body.innerText.slice(-2000)')}`);
}
const click = (selector) => execute(`document.querySelector(${JSON.stringify(selector)})?.click()`);
const title = () => execute("document.querySelector('#player-title')?.textContent");
async function snapshot(username = 'alice') {
  const scope = JSON.stringify([origin, username]);
  return execute(`new Promise((resolve, reject) => {
    const request = indexedDB.open('xtmusic.playback.v2', 1);
    request.onerror = () => reject(request.error.message);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['queues', 'states'], 'readonly');
      const queue = tx.objectStore('queues').get(${JSON.stringify(scope)});
      const state = tx.objectStore('states').get(${JSON.stringify(scope)});
      tx.oncomplete = () => { resolve({ count: queue.result?.tracks.length,
        source: queue.result?.source, generation: queue.result?.generation, state: state.result }); db.close(); };
    };
  })`);
}

async function launch() {
  const p = await port();
  const binary = process.argv[2] || require('electron');
  const appPath = process.argv[3] || (process.argv[2] ? null : root);
  const args = [...(appPath ? [appPath] : []), `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${p}`, '--disable-gpu'];
  if (process.platform === 'linux') args.push('--ozone-platform=x11');
  // Only the isolated local development container may opt out. Release CI does not.
  if (proof.sandboxDisabled) args.push('--no-sandbox');
  child = spawn(binary, args, { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let page;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw Error(`Application exited: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${p}/json/list`, { signal: AbortSignal.timeout(1000) });
      page = (await response.json()).find((item) => item.type === 'page' && item.url.includes('/dist/renderer/index.html'));
      if (page) break;
    } catch {}
    await delay(250);
  }
  if (!page) throw Error('Packaged application did not open a page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error(JSON.stringify(message.error))); else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP websocket connection failed')), 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  await cdp('Runtime.enable');
  await waitFor("Boolean(document.querySelector('#login-form') || document.querySelector('.home-page'))", 'login form');
}

async function stop() {
  socket?.close(); socket = null;
  for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(Error('Test application stopped')); }
  waiting.clear();
  if (child?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    await delay(1500);
    if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }
  child = null;
}

async function login(username) {
  await waitFor("Boolean(document.querySelector('#login-form'))", 'login ready');
  await execute(`(() => {
    const form = document.querySelector('#login-form');
    form.elements.serverInput.value = ${JSON.stringify(origin)};
    form.elements.username.value = ${JSON.stringify(username)};
    form.elements.password.value = 'loopback-test-only';
    form.elements.allowHttp.checked = true;
    form.elements.rememberSession.checked = false;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await waitFor("!document.querySelector('#app-shell').classList.contains('is-hidden')", 'authenticated shell');
  await click('[data-route="tracks"]');
  await waitFor("Boolean(document.querySelector('.tracks-page [data-action=\"shuffle-all\"]'))", 'tracks view');
}

function track(index) {
  return { guid: `track-${index + 1}`, title: `Mock track ${index + 1}`, duration: 60,
    artists: [{ guid: 'artist-one', name: 'Local test artist' }],
    album: { guid: 'album-one', name: 'Local test album' }, audioSpec: { format: 'wav', duration: 60 } };
}
function wav() {
  const size = 22050 * 2 * 60;
  const buffer = Buffer.alloc(44 + size);
  buffer.write('RIFF'); buffer.writeUInt32LE(size + 36, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(22050, 24); buffer.writeUInt32LE(44100, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(size, 40);
  return buffer;
}

async function main() {
  fs.mkdirSync(proofDir, { recursive: true });
  log = fs.createWriteStream(path.join(proofDir, `${label}.log`));
  const audio = wav();
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 0, data })); };
    if (url.pathname.endsWith('/user/password-login')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const { username } = JSON.parse(body);
      return json({ userToken: `test-${username}`, user: { name: username, guid: username } });
    }
    if (url.pathname.endsWith('/track/list')) {
      const page = Number(url.searchParams.get('page') || 1);
      const size = Math.min(Number(url.searchParams.get('size') || 200), mode === 'unknown' ? 200 : 400);
      const total = mode === 'unknown' ? 1001 : 12345;
      requests.push({ page, size, mode });
      if (mode === 'slow' && page > 1) await delay(1500);
      if (mode === 'failure' && page === 3) { res.statusCode = 500; return res.end('Mock network failure'); }
      const start = (page - 1) * size;
      const list = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => track(start + i));
      return json({ list, ...(mode === 'unknown' ? {} : { total }) });
    }
    if (url.pathname.endsWith('/track/stream')) {
      streams.push(url.searchParams.get('guid'));
      const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
      res.statusCode = match ? 206 : 200;
      res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      if (match) res.setHeader('Content-Range', `bytes ${start}-${end}/${audio.length}`);
      return res.end(audio.subarray(start, end + 1));
    }
    if (url.pathname.endsWith('/lyric/list')) return json({ list: [{ guid: 'lyric', content: '[00:00.00]Mock lyric\n[00:05.00]Second line' }] });
    return json({ list: [], total: 0 });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  await launch();
  await login('alice');
  assert.ok((await execute("document.querySelector('.track-page-heading p:last-child').textContent")).includes('12345'));
  assert.ok((await execute("document.querySelectorAll('[data-track-index]').length")) < 80);
  await click('[data-action="shuffle-all"]');
  await waitFor("document.querySelector('#library-playback-status').textContent.includes('12,345 首')", 'complete full-library queue', 25000);
  await waitFor("document.querySelector('#player-cover').classList.contains('is-playing')", 'real audio proxy playback');
  await delay(400);
  const initial = await snapshot();
  assert.equal(initial.count, 12345);
  assert.equal(initial.source.kind, 'tracks');
  assert.equal(initial.state.order.shuffle, true);
  assert.equal(new Set(initial.state.order.order).size, 12345);
  assert.ok(requests.some((r) => r.page === 31));
  proof.checks.push('12345-track full library, bounded listing, real mock-NAS audio playback');

  const beforePage = await title();
  await click('[data-action="library-page"][data-page="2"]');
  await waitFor("document.querySelector('.track-page-heading').textContent.includes('401–800')", 'page 2');
  assert.equal(await title(), beforePage);
  assert.equal((await snapshot()).generation, initial.generation);
  await click('#player-queue');
  await delay(300);
  assert.ok(await execute("document.querySelectorAll('.queue-row').length > 0 && document.querySelectorAll('.queue-row').length <= 160"));
  assert.ok(await execute("document.querySelector('#queue-panel').getBoundingClientRect().width > 250"));
  assert.ok((await execute("document.querySelector('.queue-source').textContent")).includes('全部歌曲'));
  const screen = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(proofDir, `${label}.png`), Buffer.from(screen.data, 'base64'));
  proof.checks.push('page 2 does not replace full-library queue; queue rendering capped at 160 rows');

  const history = [await title()];
  for (let i = 0; i < 4; i += 1) {
    await click('#player-next');
    await waitFor(`document.querySelector('#player-title').textContent !== ${JSON.stringify(history.at(-1))}`, 'next track');
    history.push(await title());
  }
  assert.equal(new Set(history).size, history.length);
  await execute("document.querySelector('#player-progress').value = 0; document.querySelector('#player-progress').dispatchEvent(new Event('input'))");
  await click('#player-previous');
  await waitFor(`document.querySelector('#player-title').textContent === ${JSON.stringify(history.at(-2))}`, 'actual previous song');
  await click('#player-next');
  await waitFor(`document.querySelector('#player-title').textContent === ${JSON.stringify(history.at(-1))}`, 'actual history forward');
  await click('#player-lyrics');
  await waitFor("Boolean(document.querySelector('.lyrics-page'))", 'lyrics page');
  await click('[data-route="tracks"]');
  await waitFor("Boolean(document.querySelector('#library-playback-status'))", 'back to library');
  await execute("document.querySelector('#player-progress').value = 250; document.querySelector('#player-progress').dispatchEvent(new Event('input'))");
  await click('#player-toggle'); // pause, and flush progress before complete restart
  await delay(500);
  const saved = await snapshot();
  const previousTitle = await title();
  const visited = new Set(saved.state.order.visited);
  const nextIndex = saved.state.order.order.slice(saved.state.order.cursor).find((index) => !visited.has(index));
  await stop();
  await launch();
  await login('alice');
  await waitFor(`document.querySelector('#player-title').textContent === ${JSON.stringify(previousTitle)}`, 'restored current track');
  assert.equal((await snapshot()).count, 12345);
  assert.equal(await execute("document.querySelector('#player-cover').classList.contains('is-playing')"), false);
  await click('#player-toggle');
  await waitFor("document.querySelector('#player-current-time').textContent.startsWith('0:15') || document.querySelector('#player-current-time').textContent.startsWith('0:16')", 'restored playback position');
  await click('#player-next');
  await waitFor(`document.querySelector('#player-title').textContent === 'Mock track ${nextIndex + 1}'`, 'restored exact next shuffled track');
  proof.checks.push('actual previous/next history, lyrics navigation, full process restart and exact shuffle continuation');

  mode = 'slow';
  const preserved = await title();
  const generation = (await snapshot()).generation;
  await click('[data-action="refresh-library-shuffle"]');
  await waitFor("Boolean(document.querySelector('[data-action=\"cancel-library-shuffle\"]'))", 'preparing cancellation');
  await click('[data-action="cancel-library-shuffle"]');
  await delay(1800);
  assert.equal(await title(), preserved);
  assert.equal((await snapshot()).generation, generation);
  mode = 'failure';
  await click('[data-action="refresh-library-shuffle"]');
  await waitFor("document.querySelector('#toast-root').textContent.includes('未启动')", 'partial indexing error');
  assert.equal((await snapshot()).generation, generation);
  assert.equal((await snapshot()).count, 12345);
  proof.checks.push('cancel and page-3 failure preserve the old queue; no partial index is advertised as complete');

  mode = 'unknown';
  await click('[data-action="accounts"]');
  await waitFor("Boolean(document.querySelector('[data-action=\"add-account\"]'))", 'accounts dialog');
  await click('[data-action="add-account"]');
  await login('bob');
  await waitFor("document.querySelector('.track-page-heading').textContent.includes('未返回总数')", 'unknown total displayed honestly');
  assert.equal((await snapshot('alice')).count, 12345);
  assert.notEqual((await snapshot('bob')).count, 12345);
  await click('[data-action="shuffle-all"]');
  await waitFor("document.querySelector('#library-playback-status').textContent.includes('1,001 首')", 'unknown-total full library', 20000);
  await delay(300);
  assert.equal((await snapshot('bob')).count, 1001);
  assert.equal((await snapshot('alice')).count, 12345);
  assert.ok(requests.some((r) => r.mode === 'unknown' && r.page === 7));
  proof.checks.push('missing totals + server cap 200: all 1001 tracks found; separate account libraries/queues');
  mode = 'normal';
  const aliceId = await execute("window.xtMusic.auth.listAccounts().then((accounts) => accounts.filter((account) => account.username === 'alice' && account.hasSession).at(-1).id)");
  await click('[data-action="accounts"]');
  await waitFor("Boolean(document.querySelector('[data-action=\"switch-account\"]'))", 'switch account dialog');
  await click(`[data-action="switch-account"][data-id="${aliceId}"]`);
  await click('[data-route="tracks"]');
  await waitFor("document.querySelector('#library-playback-status')?.textContent.includes('12,345 首')", 'account switch restores Alice full queue');
  assert.equal((await snapshot('bob')).count, 1001);
  proof.checks.push('switching back restores the original account queue without truncation or cross-account contamination');
  proof.passed = true;
  proof.verifiedAt = new Date().toISOString();
  proof.requestCount = requests.length;
  proof.streamRequests = streams.length;
  fs.writeFileSync(path.join(proofDir, `${label}.json`), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket) {
    try {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(proofDir, `${label}-last.png`), Buffer.from(shot.data, 'base64'));
    } catch {}
  }
  await stop();
  server?.closeAllConnections(); server?.close();
  log?.end();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
