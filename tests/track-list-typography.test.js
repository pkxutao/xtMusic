'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shared virtual song lists use readable typography and matching row geometry', () => {
  const css = source('src/renderer/styles.css');
  const table = source('src/renderer/virtual-table.js');

  assert.match(css, /XT_TRACK_LIST_TYPOGRAPHY_0_3_7/);
  assert.match(table, /rowHeight = options\.rowHeight \|\| 64/);
  assert.match(css, /\.track-table-head\s*\{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.track-row-title\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.track-row-subtitle,[\s\S]*?\.track-col-duration\s*\{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.track-row-cover\s*\{[^}]*width:\s*42px;[^}]*height:\s*42px/s);
});

test('queue and picker song rows do not fall back to tiny metadata text', () => {
  const css = source('src/renderer/styles.css');

  assert.match(css, /\.queue-row-title\s*\{[^}]*font-size:\s*13px/s);
  assert.match(css, /\.queue-row-artist\s*\{[^}]*font-size:\s*11px/s);
  assert.match(css, /\.selectable-row small\s*\{[^}]*font-size:\s*11px/s);
});

test('bottom-player album has an explicit click path to album detail', () => {
  const app = source('src/renderer/app.js');

  assert.match(app, /XT_BOTTOM_PLAYER_ALBUM_CLICK_0_3_7/);
  assert.match(app, /playerAlbum\.addEventListener\('click'/);
  assert.match(app, /this\.#navigate\('album', \{ guid, item \}\)/);
});
