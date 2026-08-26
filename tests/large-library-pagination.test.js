'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const viewsSource = fs.readFileSync(path.join(root, 'src/renderer/views.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');

test('large top-level libraries fetch only the requested bounded page', () => {
  assert.match(appSource, /GRID_PAGE_SIZE = 72/);
  assert.match(appSource, /TRACK_PAGE_SIZE = 400/);
  assert.match(appSource, /getAlbums', \{ page, size: GRID_PAGE_SIZE \}/);
  assert.match(appSource, /getTracks', \{ page, size: TRACK_PAGE_SIZE \}/);
  assert.doesNotMatch(appSource, /case 'albums':[\s\S]{0,180}#fetchAll/);
  assert.doesNotMatch(appSource, /case 'tracks':[\s\S]{0,180}#fetchAll/);
});

test('route pagination and hidden-library disposal are wired', () => {
  assert.match(appSource, /case 'library-page'/);
  assert.match(appSource, /#changeLibraryPage/);
  assert.match(appSource, /this\.els\.content\.replaceChildren\(\)/);
  assert.match(viewsSource, /function paginationView/);
  assert.match(viewsSource, /data-action="library-page"/);
  assert.match(stylesSource, /\.library-pagination/);
});
