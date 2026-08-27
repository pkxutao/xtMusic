'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('compact lyric mode is loaded after the base lyrics experience', () => {
  const html = read('src/renderer/index.html');
  const build = read('scripts/build-renderer.js');
  const baseIndex = html.indexOf('lyrics-experience.css');
  const compactIndex = html.indexOf('lyrics-line-mode.css');

  assert.ok(baseIndex >= 0, 'base lyrics stylesheet should be present');
  assert.ok(compactIndex > baseIndex, 'compact lyric mode must load after the base stylesheet');
  assert.match(build, /lyrics-line-mode\.css/);
});

test('active lyrics use one solid whole-line highlight without progressive text fill', () => {
  const css = read('src/renderer/lyrics-line-mode.css');

  assert.match(css, /font-size:\s*clamp\(18px,\s*1\.65vw,\s*28px\)/);
  assert.match(css, /\.lyric-line\.is-active/);
  assert.match(css, /color:\s*var\(--lyrics-foreground\)/);
  assert.match(css, /background-image:\s*none/);
  assert.match(css, /-webkit-text-fill-color:\s*currentColor/);
  assert.match(css, /font-weight:\s*720/);
  assert.doesNotMatch(css, /linear-gradient|--lyric-progress/);
});
