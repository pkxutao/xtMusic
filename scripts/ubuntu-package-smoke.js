'use strict';

// Exercise the actual packaged application with its normal sandbox and an
// isolated empty profile. Run this script under xvfb-run on a disposable runner.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const [binary, label, version] = process.argv.slice(2);
  if (!binary || !label || !version) {
    throw new Error('Usage: node ubuntu-package-smoke.js <binary> <label> <version>');
  }
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid proof label');
  fs.accessSync(binary, fs.constants.X_OK);
  const proofDir = path.resolve('ui-proof');
  fs.mkdirSync(proofDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xtmusic-ubuntu-smoke-'));
  const port = await freePort();
  const output = fs.createWriteStream(path.join(proofDir, `${label}.log`));
  const trace = (event, details = {}) => {
    const message = JSON.stringify({ at: new Date().toISOString(), event, ...details });
    output.write(`${message}\n`);
    console.log(message);
  };
  const child = spawn(binary, [
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--ozone-platform=x11'
  ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  let spawnError;
  child.on('error', (error) => { spawnError = error; });
  let socket;
  let counter = 0;
  const pending = new Map();
  const timers = new Set();
  let received = 0;
  try {
    let page;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Application exited before startup: ${child.exitCode ?? child.signalCode}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const pages = await response.json();
          // Do not evaluate against Chromium's initial blank page while the
          // renderer is being replaced by Electron's loadFile navigation.
          page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl &&
            item.url?.startsWith('file:') && item.url.includes('/dist/renderer/index.html') &&
            item.title?.includes('XT Music'));
          if (page) break;
        }
      } catch {}
      await delay(250);
    }
    if (!page) throw new Error('No loaded application page appeared within 45 seconds');
    trace('target-ready', { title: page.title, url: page.url });
    socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.addEventListener('message', (event) => {
      received += 1;
      const message = JSON.parse(event.data);
      const handler = pending.get(message.id);
      if (!handler) return;
      trace('cdp-response', { id: message.id, error: message.error || null });
      pending.delete(message.id);
      clearTimeout(handler.timer);
      timers.delete(handler.timer);
      if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
      else handler.resolve(message.result);
    });
    socket.addEventListener('close', (event) => trace('cdp-close', { code: event.code, reason: event.reason }));
    socket.addEventListener('error', () => trace('cdp-error'));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    function cdp(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => {
          pending.delete(id);
          timers.delete(timer);
          reject(new Error(`CDP timeout: ${method}; socket=${socket.readyState}, received=${received}`));
        }, 20000);
        timers.add(timer);
        pending.set(id, { resolve, reject, timer });
        trace('cdp-request', { id, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    let state;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const result = await cdp('Runtime.evaluate', {
        expression: `JSON.stringify({ title: document.title, url: location.href,
          ready: document.readyState, text: document.body?.innerText?.slice(0, 1800) || '',
          inputs: document.querySelectorAll('input').length,
          preloadAvailable: typeof window.xtMusic === 'object',
          nodeIntegrationDisabled: typeof window.require === 'undefined' })`,
        returnByValue: true
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      state = JSON.parse(result.result.value);
      if (state.ready === 'complete' && state.inputs > 0 && state.preloadAvailable) break;
      await delay(250);
    }
    // The HTML title is static; DEB and ASAR metadata independently verify the version.
    if (!state || !state.title.includes('XT Music') || state.inputs < 1 ||
        !state.preloadAvailable || !state.nodeIntegrationDisabled ||
        !/XT Music|登录|服务器|飞牛/.test(state.text)) {
      throw new Error(`Packaged login screen validation failed: ${JSON.stringify(state)}`);
    }
    await delay(1000);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(proofDir, `${label}.png`), Buffer.from(screenshot.data, 'base64'));
    const proof = { verifiedAt: new Date().toISOString(), platform: process.platform,
      arch: process.arch, version, binary, sandboxDisabled: false, state,
      scope: 'Packaged application startup and login rendering only; no live FNOS credentials or physical audio device used.' };
    fs.writeFileSync(path.join(proofDir, `${label}.json`), `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    socket?.close();
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await delay(1500);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    const diagnostic = path.join(profile, 'logs', 'xtmusic-diagnostic.log');
    if (fs.existsSync(diagnostic)) {
      fs.copyFileSync(diagnostic, path.join(proofDir, `${label}-application.log`));
    }
    await new Promise((resolve) => output.end(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
