'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const app = read('src/renderer/app.js');
const views = read('src/renderer/views.js');
const utils = read('src/renderer/utils.js');
const player = read('src/renderer/player.js');

test('post-login route is rendered before secondary playlist loading', () => {
  const start = app.indexOf('async #enterSession');
  const end = app.indexOf('async #loadInitialPlaylists', start);
  assert.ok(start >= 0 && end > start);
  const body = app.slice(start, end);
  assert.ok(body.indexOf('await this.#loadRoute') >= 0);
  assert.ok(body.indexOf('void this.#loadInitialPlaylists') > body.indexOf('await this.#loadRoute'));
  assert.doesNotMatch(body, /await this\.#fetchAll\('getPlaylists'/);
});

test('closed and long queues cannot create an unbounded hidden DOM', () => {
  assert.match(app, /if \(!this\.store\.get\(\)\.queueOpen\)/);
  assert.match(app, /queueRenderWindow\(state\.queue, state\.index, MAX_QUEUE_ROWS\)/);
  assert.match(app, /const MAX_QUEUE_ROWS = 160/);
  assert.match(player, /const MAX_PERSISTED_QUEUE = 500/);
  assert.match(player, /persistentQueueSnapshot/);
});

test('frequent progress events update only progress controls', () => {
  assert.match(app, /addEventListener\('progress', \(\) => this\.#renderPlayerProgress\(\)\)/);
  assert.doesNotMatch(app, /\['state', 'track', 'queue', 'progress'\]/);
});

test('sidebar and picker cap synchronous playlist markup', () => {
  assert.match(views, /const MAX_SIDEBAR_PLAYLISTS = 120/);
  assert.match(views, /visiblePlaylists = playlists\.slice\(0, MAX_SIDEBAR_PLAYLISTS\)/);
  assert.match(views, /const MAX_PLAYLIST_PICKER_ITEMS = 500/);
});

test('cover URLs remain stable while audio keeps the loopback proxy', () => {
  assert.match(utils, /xtmusic:\/\/cover\//);
  assert.match(utils, /return mediaResourceUrl\('stream', guid\)/);
});
