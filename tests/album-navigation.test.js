'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FeiNiuClient } = require('../src/main/protocol/feiniu-client');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('artist albums are derived once from bounded artist tracks and paginated from cache', async () => {
  const client = new FeiNiuClient({ serverUrl: 'https://nas.invalid', token: 'token' });
  let calls = 0;
  client.getArtistTracks = async ({ page }) => {
    calls += 1;
    const list = page === 1
      ? [
          { guid: 't1', album: { guid: 'a1', name: 'Alpha', coverId: 'c1', trackCount: 2 } },
          { guid: 't2', album: { guid: 'a1', name: 'Alpha', coverId: 'c1', trackCount: 2 } },
          { guid: 't3', album: { guid: 'a2', name: 'Beta', coverId: 'c2' } }
        ]
      : [{ guid: 't4', album: { guid: 'a3', name: 'Gamma', coverId: 'c3' } }];
    return { list, total: 401 };
  };

  const first = await client.getArtistAlbums({ artistGUID: 'artist-1', page: 1, size: 2 });
  const second = await client.getArtistAlbums({ artistGUID: 'artist-1', page: 2, size: 2 });

  assert.equal(first.total, 3);
  assert.equal(first.list.length, 2);
  assert.equal(second.list.length, 1);
  assert.equal(calls, 2, 'artist track pages should be fetched once and then reused');
  assert.deepEqual(new Set([...first.list, ...second.list].map((album) => album.guid)), new Set(['a1', 'a2', 'a3']));
});

test('renderer routes artist details through albums and exposes album links everywhere', () => {
  const app = source('src/renderer/app.js');
  const views = source('src/renderer/views.js');
  const table = source('src/renderer/virtual-table.js');
  const html = source('src/renderer/index.html');
  const ipc = source('src/main/ipc.js');

  assert.match(app, /return this\.#artistAlbumsData\(route\.params, page\)/);
  assert.match(app, /artistAlbumsView\(/);
  assert.match(app, /playerAlbum\.dataset\.openKind = 'album'/);
  assert.match(views, /export function artistAlbumsView/);
  assert.match(views, /class="lyrics-album-link entity-link"/);
  assert.match(table, /class="entity-link track-album-link"/);
  assert.match(table, /closest\('\[data-open-kind\]\[data-open-id\]'\)/);
  assert.match(html, /id="player-album"/);
  assert.match(ipc, /'getArtistAlbums'/);
});

test('artist album derivation never scans the global album library', () => {
  const client = source('src/main/protocol/feiniu-client.js');
  const start = client.indexOf('async getArtistAlbums');
  const end = client.indexOf('getGenreTracks', start);
  const block = client.slice(start, end);
  assert.match(block, /getArtistTracks/);
  assert.doesNotMatch(block, /this\.getAlbums|\/album\/list/);
});
