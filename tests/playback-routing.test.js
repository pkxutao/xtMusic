'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const index = read('src/main/index.js');
const ipc = read('src/main/ipc.js');
const preload = read('src/preload.js');
const html = read('src/renderer/index.html');
const utils = read('src/renderer/utils.js');
const player = read('src/renderer/player.js');
const app = read('src/renderer/app.js');

test('desktop runtime starts a secure loopback media server and exposes only its random base URL', () => {
  assert.match(index, /new MediaServer\(\{ runtime, hlsRegistry \}\)/);
  assert.match(index, /await mediaServer\.start\(\)/);
  assert.match(ipc, /mediaBaseUrl: mediaServer\?\.baseUrl \|\| null/);
  assert.match(preload, /diagnostics: \(\) => invoke\('player:diagnostics'\)/);
  assert.doesNotMatch(ipc, /music-token/);
});

test('renderer permits only loopback HTTP media and configures it before rendering a session', () => {
  assert.match(html, /media-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /img-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(utils, /parsed\.hostname !== '127\.0\.0\.1'/);
  assert.match(utils, /mediaResourceUrl\('stream', guid\)/);
  assert.match(app, /configureMediaBaseUrl,/);
  assert.match(app, /configureMediaBaseUrl\(bootstrap\.mediaBaseUrl\)/);
});

test('player probes the stream before playback and reports upstream failures precisely', () => {
  assert.match(player, /await probeMediaSource\(url\)/);
  assert.match(player, /Range: 'bytes=0-1'/);
  assert.match(player, /responseErrorMessage/);
  assert.match(player, /this\.diagnostics\?\.\(\)/);
  assert.match(index, /autoplay-policy/);
});
