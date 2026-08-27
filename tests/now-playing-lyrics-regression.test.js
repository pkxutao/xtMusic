'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const lyrics = fs.readFileSync(path.join(root, 'src/renderer/lyrics-experience.js'), 'utf8');

 test('now-playing cover, title and visible lyrics button share one entry path', () => {
  assert.match(appSource, /playerCover\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /playerTitle\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /playerLyrics\.addEventListener\('click', openNowPlaying\)/);
  assert.match(appSource, /now-playing-equalizer/);
  assert.match(appSource, /<span>歌词<\/span>/);
  assert.doesNotMatch(html, /id="player-title"[^>]*data-action=/);
  assert.match(html, /id="player-cover"[^>]*role="button"/);
});

 test('lyrics observers cannot recursively react to toolbar text updates', () => {
  assert.match(lyrics, /observer\.observe\(contentRoot, \{ childList: true \}\)/);
  assert.doesNotMatch(lyrics, /observer\.observe\(contentRoot, \{ childList: true, subtree: true \}\)/);
  assert.match(lyrics, /if \(page === activePage\) return;/);
  assert.match(lyrics, /lineObserver\.observe\(scroll \|\| page/);
  assert.match(lyrics, /attributeOldValue: true/);
  assert.match(lyrics, /if \(counter\.textContent !== nextText\)/);
  assert.match(lyrics, /if \(time\.textContent !== nextText\)/);
});
