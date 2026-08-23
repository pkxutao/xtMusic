'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('renderer never receives or persists the NAS token', () => {
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  const renderer = walk(path.join(root, 'src/renderer'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

  assert.ok(!preload.includes('getToken'));
  assert.ok(!preload.includes('music-token'));
  assert.ok(!renderer.includes('music-token'));
  assert.ok(!/localStorage\.setItem\([^)]*password/i.test(renderer));
});

test('BrowserWindow uses isolation and disables Node integration', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
});

test('source contains no analytics or remote reporting SDK', () => {
  const source = walk(path.join(root, 'src'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  for (const marker of ['firebase', 'mixpanel', 'appsflyer', 'sentry.io', 'segment.io']) {
    assert.ok(!source.toLowerCase().includes(marker));
  }
});

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}
