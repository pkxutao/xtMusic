'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('lyrics enhancement keeps the scroll patch scoped to lyric lines', () => {
  const source = read('src/renderer/lyrics-experience.js');
  assert.match(source, /\.lyrics-scroll \.lyric-line/);
  assert.match(source, /lyricsManualScroll/);
  assert.match(source, /nativeScrollIntoView\.call\(this, options\)/);
  assert.doesNotMatch(source, /music-token|accessCode|password/i);
});

test('lyrics visual system includes Feishin-style focus, masking and reduced motion', () => {
  const css = read('src/renderer/lyrics-experience.css');
  assert.match(css, /mask-image:\s*linear-gradient/);
  assert.match(css, /--lyric-progress/);
  assert.match(css, /\.lyric-line\.is-active/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /lyrics-follow-button/);
});

test('renderer build and HTML load the enhancement before the application bundle', () => {
  const build = read('scripts/build-renderer.js');
  const html = read('src/renderer/index.html');
  assert.match(build, /lyrics-experience\.js/);
  assert.match(build, /lyrics-experience\.css/);
  assert.ok(html.indexOf('lyrics-experience.js') < html.indexOf('app.js'));
  assert.match(html, /lyrics-experience\.css/);
});
