#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MARKER = "XT_ARTIST_NAVIGATION_TABS_20260901"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, value):
    (ROOT / path).write_text(value, encoding="utf-8")


def once(value, old, new, label):
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return value.replace(old, new, 1)


def regex_once(value, pattern, replacement, label):
    next_value, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex anchor, found {count}")
    return next_value


# Shared artist-link markup. Every rendered link carries the stable artist GUID.
path = "src/renderer/utils.js"
value = read(path)
if MARKER not in value:
    anchor = """export function albumText(track) {
  return track?.album?.name || '未知专辑';
}
"""
    addition = """// XT_ARTIST_NAVIGATION_TABS_20260901: render safe, delegated artist links.
export function artistLinksHtml(track, {
  className = 'artist-links',
  fallback = '未知歌手',
  separator = '、'
} = {}) {
  const artists = (Array.isArray(track?.artists) ? track.artists : [])
    .map((item) => ({
      guid: String(item?.guid || item?.artistGUID || item?.artistGuid || '').trim(),
      name: String(item?.name || '').trim(),
      coverId: item?.coverId || null
    }))
    .filter((item) => item.name);

  if (!artists.length) {
    return `<span class="${attr(className)} artist-link-fallback">${escapeHtml(fallback)}</span>`;
  }

  const separatorMarkup = `<span class="artist-link-separator">${escapeHtml(separator)}</span>`;
  const links = artists.map((artist) => {
    if (!artist.guid) return `<span class="artist-link-fallback">${escapeHtml(artist.name)}</span>`;
    return `<button class="entity-link artist-link"
                    type="button"
                    data-open-kind="artist"
                    data-open-id="${attr(artist.guid)}"
                    data-open-name="${attr(artist.name)}"
                    data-open-cover-id="${attr(artist.coverId || '')}"
                    title="打开歌手 ${attr(artist.name)}">${escapeHtml(artist.name)}</button>`;
  });

  return `<span class="${attr(className)}">${links.join(separatorMarkup)}</span>`;
}

""" + anchor
    value = once(value, anchor, addition, "utils artist links")
    write(path, value)


# Song-table artist labels become independent entity links without breaking row playback.
path = "src/renderer/virtual-table.js"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """  albumText,
  artistsText,
  attr,
""",
        """  albumText,
  artistLinksHtml,
  artistsText,
  attr,
""",
        "virtual table import"
    )
    value = once(
        value,
        """            <div class="track-row-subtitle" title="${escapeHtml(artists)}">${escapeHtml(artists)}</div>
""",
        """            <div class="track-row-subtitle" title="${escapeHtml(artists)}">${artistLinksHtml(track, { className: 'track-artist-links' })}</div>
""",
        "virtual table artist markup"
    )
    value += "\n// XT_ARTIST_NAVIGATION_TABS_20260901\n"
    write(path, value)


# Artist detail gets songs/albums tabs, and all visible artist labels use shared links.
path = "src/renderer/views.js"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """  artistsText,
  attr,
""",
        """  artistLinksHtml,
  artistsText,
  attr,
""",
        "views artist link import"
    )

    artist_view = r'''export function artistAlbumsView({
  item,
  tracks = [],
  albums = [],
  pagination = null,
  activeTab = 'tracks'
}) {
  const title = item?.name || item?.title || '未知歌手';
  const albumTotal = Number(pagination?.total || albums?.length || item?.albumCount || 0);
  const trackTotal = Math.max(Number(item?.trackCount || 0), tracks.length);
  const representativeTrack = tracks.find((track) => track?.coverId || track?.album?.coverId);
  const coverId = item?.coverId || representativeTrack?.coverId ||
    representativeTrack?.album?.coverId || albums.find((album) => album?.coverId)?.coverId;
  const selected = activeTab === 'albums' ? 'albums' : 'tracks';

  return `
    <div class="page detail-page artist-albums-page" data-artist-active-tab="${selected}">
      <section class="detail-hero artist-albums-hero">
        <div class="detail-backdrop" style="${coverId ? `background-image:url('${attr(coverUrl(coverId, 800))}')` : ''}"></div>
        <div class="detail-hero-content">
          ${imageHtml(coverId, title, 'detail-cover round', 900)}
          <div class="detail-copy">
            <p class="eyebrow">歌手</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="detail-meta">${albumTotal} 张专辑 · ${trackTotal} 首歌曲</p>
            <div class="detail-actions">
              ${tracks.length ? `
                <button class="primary-button" data-action="play-all">${icon('play', 17)}播放全部歌曲</button>
                <button class="secondary-button" data-action="shuffle-all">${icon('shuffle', 17)}随机播放</button>
              ` : ''}
              <button class="secondary-button" data-action="refresh">${icon('refresh', 16)}刷新</button>
            </div>
          </div>
        </div>
      </section>

      <nav class="artist-detail-tabs" role="tablist" aria-label="歌手内容">
        <button class="artist-detail-tab ${selected === 'tracks' ? 'is-active' : ''}"
                type="button"
                role="tab"
                aria-selected="${selected === 'tracks'}"
                data-action="artist-tab"
                data-artist-tab="tracks">
          ${icon('music', 16)}<span>歌曲</span><small>${trackTotal}</small>
        </button>
        <button class="artist-detail-tab ${selected === 'albums' ? 'is-active' : ''}"
                type="button"
                role="tab"
                aria-selected="${selected === 'albums'}"
                data-action="artist-tab"
                data-artist-tab="albums">
          ${icon('album', 16)}<span>专辑</span><small>${albumTotal}</small>
        </button>
      </nav>

      ${selected === 'tracks' ? `
        <section class="artist-tracks-section" role="tabpanel">
          <div class="section-title-row artist-tab-heading">
            <div><h2>歌曲</h2><span>${trackTotal} 首</span></div>
            ${tracks.length ? `<button class="primary-button compact" data-action="play-all">${icon('play', 16)}播放列表歌曲</button>` : ''}
          </div>
          ${tracks.length
            ? '<div id="track-table-host" class="track-table-host detail-table artist-track-table"></div>'
            : emptyState('music', '这个歌手暂时没有可播放的歌曲')}
        </section>
      ` : `
        <section class="artist-albums-section" role="tabpanel">
          <div class="section-title-row">
            <div><h2>专辑</h2><span>${albumTotal} 张</span></div>
          </div>
          <div class="media-grid artist-album-grid">
            ${(albums || []).map((album) => mediaCard(album, 'album')).join('') || emptyState('album', '这个歌手暂时没有可浏览的专辑')}
          </div>
          ${paginationView(pagination)}
        </section>
      `}
    </div>
  `;
}'''
    value = regex_once(
        value,
        r"export function artistAlbumsView\(\{ item, albums, pagination = null \}\) \{.*?\n\}\n\nexport function trackPageView",
        artist_view + "\n\nexport function trackPageView",
        "artist detail tabs view"
    )

    value = once(
        value,
        """  const meta = detailMeta(kind, item, tracks);
  return `
""",
        """  const meta = detailMeta(kind, item, tracks);
  const artistMarkup = kind === 'album' && tracks?.[0]
    ? artistLinksHtml(tracks[0], { className: 'detail-artist-links' })
    : '';
  return `
""",
        "detail artist markup variable"
    )
    value = once(
        value,
        """            <h1>${escapeHtml(title)}</h1>
            <p class="detail-meta">${escapeHtml(meta)}</p>
""",
        """            <h1>${escapeHtml(title)}</h1>
            ${artistMarkup ? `<div class="detail-artist-row">${artistMarkup}</div>` : ''}
            <p class="detail-meta">${escapeHtml(meta)}</p>
""",
        "detail artist row"
    )
    value = once(
        value,
        """            <p>${escapeHtml(artistsText(track))}</p>
""",
        """            <div class="lyrics-artist-row">${artistLinksHtml(track, { className: 'lyrics-artist-links' })}</div>
""",
        "lyrics artist links"
    )
    value = once(
        value,
        """        <span title="${attr(artistsText(item))}">${escapeHtml(artistsText(item))}</span>
""",
        """        <div class="media-card-artist" title="${attr(artistsText(item))}">${artistLinksHtml(item, { className: 'card-artist-links' })}</div>
""",
        "home card artist links"
    )
    value = once(
        value,
        """  if (kind === 'album') {
    const artists = tracks[0] ? artistsText(tracks[0]) : '';
    return `${artists}${artists ? ' · ' : ''}${tracks.length} 首歌曲`;
  }
""",
        """  if (kind === 'album') return `${tracks.length} 首歌曲`;
""",
        "album detail plain artist removal"
    )
    value += "\n// XT_ARTIST_NAVIGATION_TABS_20260901\n"
    write(path, value)


# The bottom-player artist label is a real button, matching the existing album control.
path = "src/renderer/index.html"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """            <span id="player-artist">XT Music</span>
""",
        """            <button id="player-artist" class="now-playing-artist entity-link" type="button" disabled title="">XT Music</button>
""",
        "player artist button"
    )
    value += "\n<!-- XT_ARTIST_NAVIGATION_TABS_20260901 -->\n"
    write(path, value)


# Wire route loading, tabs, player metadata, queue links, and one-pass album derivation.
path = "src/renderer/app.js"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """  artistsText,
  attr,
""",
        """  artistLinksHtml,
  artistsText,
  attr,
""",
        "app artist links import"
    )
    value = once(
        value,
        """    this.currentDetail = null;
    this.currentTable = null;
""",
        """    this.currentDetail = null;
    this.currentArtistData = null;
    this.currentTable = null;
""",
        "artist data state"
    )

    value = once(
        value,
        """      const target = event.target.closest?.('.lyrics-album-link[data-open-id]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const guid = String(target.dataset.openId || '').trim();
      if (!guid) return;
      const item = {
        guid,
        name: target.dataset.openName || target.textContent?.trim() || '未知专辑',
        coverId: target.dataset.openCoverId || null
      };
      this.#navigate('album', { guid, item });
""",
        """      const target = event.target.closest?.(
        '.lyrics-album-link[data-open-id], .lyrics-artist-links [data-open-kind="artist"][data-open-id]'
      );
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const guid = String(target.dataset.openId || '').trim();
      if (!guid) return;
      const kind = target.dataset.openKind === 'artist' ? 'artist' : 'album';
      const item = {
        guid,
        name: target.dataset.openName || target.textContent?.trim() || detailFallback(kind),
        coverId: target.dataset.openCoverId || null
      };
      this.#navigate(kind, { guid, item });
""",
        "lyrics entity capture"
    )

    album_listener_anchor = """    // XT_BOTTOM_PLAYER_ALBUM_CLICK_0_3_7: keep this control independent from the now-playing title action.
    this.els.playerAlbum.addEventListener('click', (event) => {
"""
    artist_listener = """    // XT_ARTIST_NAVIGATION_TABS_20260901: bottom-player artist navigation.
    this.els.playerArtist.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const guid = String(this.els.playerArtist.dataset.openId || '').trim();
      if (!guid) return;
      const item = {
        guid,
        name: this.els.playerArtist.dataset.openName || this.els.playerArtist.textContent || '未知歌手',
        coverId: this.els.playerArtist.dataset.openCoverId || null
      };
      this.#navigate('artist', { guid, item });
    });
""" + album_listener_anchor
    value = once(value, album_listener_anchor, artist_listener, "player artist listener")

    value = once(
        value,
        """    this.currentItems = [];
    this.currentDetail = null;

    if (route.name === 'lyrics') {
""",
        """    this.currentItems = [];
    this.currentDetail = null;
    this.currentArtistData = null;

    if (route.name === 'lyrics') {
""",
        "artist data reset"
    )

    artist_data = r'''  async #artistAlbumsData(params, page = 1) {
    const item = params.item || this.#findKnownItem('artist', params.guid) || {
      guid: params.guid,
      name: params.name || detailFallback('artist')
    };
    const tracks = await this.#fetchAll(
      'getArtistTracks',
      { artistGUID: params.guid },
      DETAIL_TRACK_PAGE_SIZE,
      12000
    );
    const allAlbums = artistAlbumsFromTracks(tracks);
    const paged = paginateItems(allAlbums, page, GRID_PAGE_SIZE);
    return {
      item,
      tracks,
      albums: paged.list,
      pagination: paged.pagination
    };
  }'''
    value = regex_once(
        value,
        r"  async #artistAlbumsData\(params, page = 1\) \{.*?\n  \}\n\n  async #fetchAll",
        artist_data + "\n\n  async #fetchAll",
        "artist data loading"
    )

    value = once(
        value,
        """      case 'artist':
        this.currentDetail = { kind: 'artist', item: data.item };
        this.currentItems = data.albums;
        this.els.content.innerHTML = artistAlbumsView({
          item: data.item,
          albums: data.albums,
          pagination: data.pagination
        });
        break;
""",
        """      case 'artist':
        this.#renderArtistDetail(data, route.params?.tab || 'tracks');
        break;
""",
        "artist apply route"
    )

    value = once(
        value,
        """  #renderTrackRoute(title, subtitle, tracks, pagination = null, actionLabel = null) {
""",
        """  #renderArtistDetail(data, activeTab = 'tracks') {
    const selected = activeTab === 'albums' ? 'albums' : 'tracks';
    this.currentDetail = { kind: 'artist', item: data.item };
    this.currentArtistData = data;
    this.currentTracks = data.tracks || [];
    this.currentItems = data.albums || [];
    this.els.content.innerHTML = artistAlbumsView({
      item: data.item,
      tracks: this.currentTracks,
      albums: this.currentItems,
      pagination: data.pagination,
      activeTab: selected
    });
    if (selected === 'tracks') this.#mountTrackTable(this.currentTracks);
    this.els.content.scrollTop = 0;
  }

  #renderTrackRoute(title, subtitle, tracks, pagination = null, actionLabel = null) {
""",
        "artist render helper"
    )

    value = once(
        value,
        """      case 'play-all':
        if (this.currentTracks.length) await this.player.setQueue(this.currentTracks, 0);
        break;
""",
        """      case 'artist-tab': {
        const selected = target.dataset.artistTab === 'albums' ? 'albums' : 'tracks';
        const current = this.store.get().route;
        if (current.name !== 'artist' || !this.currentArtistData) break;
        this.store.navigate('artist', { ...current.params, tab: selected }, { replace: true });
        this.#renderChrome();
        this.currentTable?.destroy();
        this.currentTable = null;
        this.#renderArtistDetail(this.currentArtistData, selected);
        break;
      }
      case 'play-all':
        if (this.currentTracks.length) await this.player.setQueue(this.currentTracks, 0);
        break;
""",
        "artist tab action"
    )

    value = once(
        value,
        """    this.els.playerArtist.textContent = track ? artistsText(track) : 'XT Music';
    const playerAlbum = track?.album || null;
""",
        """    const playerArtist = (Array.isArray(track?.artists) ? track.artists : [])
      .find((item) => String(item?.guid || item?.artistGUID || item?.artistGuid || '').trim() && String(item?.name || '').trim());
    const playerArtistGuid = String(playerArtist?.guid || playerArtist?.artistGUID || playerArtist?.artistGuid || '').trim();
    const playerArtistName = track ? artistsText(track) : 'XT Music';
    this.els.playerArtist.textContent = playerArtistName;
    this.els.playerArtist.disabled = !playerArtistGuid;
    this.els.playerArtist.classList.toggle('is-clickable', Boolean(playerArtistGuid));
    this.els.playerArtist.title = playerArtistGuid ? `打开歌手 ${playerArtist?.name || playerArtistName}` : '';
    if (playerArtistGuid) {
      this.els.playerArtist.dataset.openKind = 'artist';
      this.els.playerArtist.dataset.openId = playerArtistGuid;
      this.els.playerArtist.dataset.openName = playerArtist?.name || playerArtistName;
      this.els.playerArtist.dataset.openCoverId = playerArtist?.coverId || '';
    } else {
      delete this.els.playerArtist.dataset.openKind;
      delete this.els.playerArtist.dataset.openId;
      delete this.els.playerArtist.dataset.openName;
      delete this.els.playerArtist.dataset.openCoverId;
    }
    const playerAlbum = track?.album || null;
""",
        "player artist state"
    )

    value = once(
        value,
        """                  <div class="queue-row-artist">${escapeHtml(artistsText(track))}</div>
""",
        """                  <div class="queue-row-artist">${artistLinksHtml(track, { className: 'queue-artist-links' })}</div>
""",
        "queue artist links"
    )

    value = once(
        value,
        """    if (key === 'item') continue;
""",
        """    if (key === 'item' || key === 'tab') continue;
""",
        "cache ignores artist tab"
    )

    value = once(
        value,
        """    artist: '正在加载歌手专辑…',
""",
        """    artist: '正在加载歌手歌曲与专辑…',
""",
        "artist loading label"
    )

    helper_anchor = """function pageSummary(pagination, unit) {
"""
    helpers = r'''function artistAlbumsFromTracks(tracks) {
  const albums = new Map();
  for (const track of tracks || []) {
    const source = track?.album || {};
    const guid = String(source.guid || track?.albumGUID || track?.albumGuid || '').trim();
    if (!guid) continue;
    let album = albums.get(guid);
    if (!album) {
      album = {
        guid,
        name: String(source.name || track?.albumName || '未知专辑'),
        coverId: source.coverId || track?.coverId || null,
        releaseDate: source.releaseDate ?? null,
        createdAt: source.createdAt ?? null,
        trackCount: 0
      };
      albums.set(guid, album);
    }
    album.trackCount += 1;
    const serverCount = Number(source.trackCount || 0);
    if (Number.isFinite(serverCount) && serverCount > album.trackCount) album.trackCount = serverCount;
    if (!album.coverId && (source.coverId || track?.coverId)) album.coverId = source.coverId || track.coverId;
    if ((!album.name || album.name === '未知专辑') && source.name) album.name = source.name;
    if (album.releaseDate == null && source.releaseDate != null) album.releaseDate = source.releaseDate;
    if (album.createdAt == null && source.createdAt != null) album.createdAt = source.createdAt;
  }
  return [...albums.values()].sort((left, right) => {
    const leftDate = Number(left.releaseDate || left.createdAt || 0);
    const rightDate = Number(right.releaseDate || right.createdAt || 0);
    if (leftDate !== rightDate) return rightDate - leftDate;
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

function paginateItems(items, requestedPage, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePage(requestedPage), pages);
  const startIndex = (page - 1) * pageSize;
  const pageItems = list.slice(startIndex, startIndex + pageSize);
  return {
    list: pageItems,
    pagination: {
      page,
      pageSize,
      total,
      pages,
      start: total ? startIndex + 1 : 0,
      end: total ? startIndex + pageItems.length : 0
    }
  };
}

''' + helper_anchor
    value = once(value, helper_anchor, helpers, "artist album derivation helpers")
    value += "\n// XT_ARTIST_NAVIGATION_TABS_20260901\n"
    write(path, value)


# Visual treatment for links and responsive tab panels.
path = "src/renderer/styles.css"
value = read(path)
if MARKER not in value:
    value += r'''

/* XT_ARTIST_NAVIGATION_TABS_20260901: clickable artists and songs/albums artist tabs */
.artist-links {
  display: inline-flex;
  align-items: baseline;
  min-width: 0;
  max-width: 100%;
}
.artist-link,
.artist-link-fallback,
.artist-link-separator {
  flex: 0 1 auto;
  min-width: 0;
}
.artist-link {
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist-link-separator {
  flex: 0 0 auto;
  opacity: 0.72;
}
.track-artist-links,
.queue-artist-links,
.card-artist-links,
.lyrics-artist-links,
.detail-artist-links {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-artist-links .artist-link,
.queue-artist-links .artist-link {
  color: inherit;
}
.media-card-artist {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-artist-links {
  width: 100%;
}
.detail-artist-row {
  display: flex;
  max-width: 850px;
  margin-top: 9px;
  color: var(--text-secondary);
  font-size: 14px;
}
.detail-artist-links .artist-link:hover {
  color: var(--accent-strong);
}
.lyrics-artist-row {
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
}
.lyrics-artist-links {
  width: 100%;
}
.lyrics-artist-links .artist-link:hover {
  color: var(--text);
}
.now-playing-artist {
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.now-playing-artist:disabled {
  cursor: default;
  opacity: 0.8;
}
.now-playing-artist.is-clickable:hover {
  color: var(--text-secondary);
  text-decoration: underline;
}
.artist-detail-tabs {
  display: flex;
  gap: 8px;
  padding: 22px clamp(28px, 4vw, 58px) 0;
  border-bottom: 1px solid var(--border);
}
.artist-detail-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 126px;
  min-height: 44px;
  padding: 0 16px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 11px 11px 0 0;
}
.artist-detail-tab:hover {
  color: var(--text-secondary);
  background: var(--bg-hover);
}
.artist-detail-tab.is-active {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-soft));
}
.artist-detail-tab.is-active::after {
  content: "";
  position: absolute;
  right: 12px;
  bottom: -1px;
  left: 12px;
  height: 2px;
  background: var(--accent);
  border-radius: 999px;
}
.artist-detail-tab small {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
}
.artist-detail-tab.is-active .icon {
  color: var(--accent-strong);
}
.artist-tracks-section {
  padding: 30px clamp(28px, 4vw, 58px) 54px;
}
.artist-tab-heading {
  min-height: 36px;
}
.artist-track-table {
  height: min(680px, calc(100vh - var(--player-height) - 215px));
}
@media (max-width: 860px) {
  .artist-detail-tabs,
  .artist-tracks-section {
    padding-right: 18px;
    padding-left: 18px;
  }
  .artist-detail-tab {
    min-width: 112px;
    padding: 0 12px;
  }
}
'''
    write(path, value)


# Static regression tests run inside the normal npm build.
test_path = ROOT / "tests/artist-navigation-tabs.test.js"
test_path.write_text(r'''"use strict";

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
''', encoding="utf-8")

print("Applied desktop artist navigation, tabs, and list playback patch")
