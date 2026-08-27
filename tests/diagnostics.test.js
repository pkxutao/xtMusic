'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  Diagnostics,
  sanitizeDetails,
  sanitizeUrl
} = require('../src/main/diagnostics');

test('diagnostic log redacts credentials and can be copied safely', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xtmusic-diagnostics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let clipboardText = '';
  const app = {
    getPath(name) {
      assert.equal(name, 'userData');
      return root;
    },
    getVersion() {
      return '0.3.4';
    },
    getAppMetrics() {
      return [];
    },
    on() {}
  };
  const diagnostics = new Diagnostics({
    app,
    clipboard: { writeText(value) { clipboardText = value; } },
    shell: { async openPath() { return ''; } },
    Notification: null
  });

  diagnostics.log('test', 'secret-check', {
    password: 'super-secret-password',
    token: 'super-secret-token',
    accessCode: 'super-secret-access-code',
    headers: {
      Cookie: 'music-token=super-secret-cookie',
      Authorization: 'Bearer super-secret-bearer'
    },
    url: 'http://127.0.0.1:43210/abcdefghijklmnopqrstuvwxyz012345/stream/track?token=abc&guid=12345'
  });
  await diagnostics.flush();

  const raw = fs.readFileSync(diagnostics.logPath, 'utf8');
  for (const secret of [
    'super-secret-password',
    'super-secret-token',
    'super-secret-access-code',
    'super-secret-cookie',
    'super-secret-bearer',
    'abcdefghijklmnopqrstuvwxyz012345'
  ]) {
    assert.equal(raw.includes(secret), false, `log leaked ${secret}`);
  }
  assert.match(raw, /<redacted>/);
  assert.match(raw, /%3Clocal-secret%3E/);

  const copied = await diagnostics.copyToClipboard();
  assert.equal(copied.copied, true);
  assert.match(clipboardText, /XT Music 诊断日志/);
  assert.equal(clipboardText.includes('super-secret-password'), false);
  await diagnostics.close();
});

test('sanitizers bound nested values and hide URL credentials', () => {
  const sanitized = sanitizeDetails({
    Password: 'abc',
    nested: {
      cookie: 'music-token=xyz',
      harmless: 'ok'
    }
  });
  assert.equal(sanitized.Password, '<redacted>');
  assert.equal(sanitized.nested.cookie, '<redacted>');
  assert.equal(sanitized.nested.harmless, 'ok');

  const url = sanitizeUrl(
    'https://example.test/music/api?token=secret&query=hello-world&password=secret2'
  );
  assert.equal(url.includes('secret'), false);
  assert.equal(url.includes('hello-world'), false);
  assert.match(url, /%3Credacted%3E/);
  assert.match(url, /%3Clen%3A11%3E/);
});

test('diagnostic renderer and main bridge are wired into the packaged application', () => {
  const root = path.resolve(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build-renderer.js'), 'utf8');
  const rendererDiagnostics = fs.readFileSync(
    path.join(root, 'src/renderer/diagnostics.js'),
    'utf8'
  );

  assert.match(index, /new Diagnostics\(\{ app, clipboard, shell, Notification \}\)/);
  assert.match(index, /CommandOrControl\+Shift\+L/);
  assert.match(index, /复制诊断日志/);
  assert.match(ipc, /diagnostics:renderer-log/);
  assert.match(ipc, /diagnostics:copy/);
  assert.match(preload, /diagnostics:renderer-log/);
  assert.match(preload, /diagnostics:open-folder/);
  assert.match(html, /\.\/diagnostics\.js/);
  assert.match(build, /'diagnostics\.js'/);
  assert.match(rendererDiagnostics, /PerformanceObserver/);
  assert.match(rendererDiagnostics, /event-loop-lag/);
  assert.match(rendererDiagnostics, /dom-sample/);
});
