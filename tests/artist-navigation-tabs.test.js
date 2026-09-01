"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("desktop artist labels navigate by stable artist GUID", () => {
  const utils = source("src/renderer/utils.js");
  const table = source("src/renderer/virtual-table.js");
  const views = source("src/renderer/views.js");
  const app = source("src/renderer/app.js");
  const html = source("src/renderer/index.html");

  assert.match(utils, /data-open-kind="artist"/);
  assert.match(utils, /data-open-id="\$\{attr\(artist\.guid\)\}"/);
  assert.match(table, /artistLinksHtml\(track/);
  assert.match(views, /lyrics-artist-links/);
  assert.match(views, /card-artist-links/);
  assert.match(app, /playerArtist\.dataset\.openKind = 'artist'/);
  assert.match(app, /queue-artist-links/);
  assert.match(html, /id="player-artist"[^>]*type="button"/);
});

test("artist detail exposes songs and albums tabs and can play the song list", () => {
  const views = source("src/renderer/views.js");
  const app = source("src/renderer/app.js");
  const styles = source("src/renderer/styles.css");

  assert.match(views, /data-artist-tab="tracks"/);
  assert.match(views, /data-artist-tab="albums"/);
  assert.match(views, /播放列表歌曲/);
  assert.match(views, /id="track-table-host"/);
  assert.match(views, /artist-album-grid/);
  assert.match(app, /case 'artist-tab'/);
  assert.match(app, /getArtistTracks/);
  assert.match(app, /artistAlbumsFromTracks/);
  assert.match(styles, /XT_ARTIST_NAVIGATION_TABS_20260901/);
});
