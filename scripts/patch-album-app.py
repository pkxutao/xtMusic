#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'XT_ALBUM_NAVIGATION_0_3_7'

def text(path): return (ROOT / path).read_text(encoding='utf-8')
def save(path, value): (ROOT / path).write_text(value, encoding='utf-8')
def once(value, old, new, label):
    count = value.count(old)
    if count != 1: raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)

path = 'src/renderer/app.js'
value = text(path)
if '#artistAlbumsData' not in value:
    value = once(value, '  accountModal,\n  detailView,\n', '  accountModal,\n  artistAlbumsView,\n  detailView,\n', 'artist view import')
    value = once(value, "      playerArtist: document.querySelector('#player-artist'),\n", "      playerArtist: document.querySelector('#player-artist'),\n      playerAlbum: document.querySelector('#player-album'),\n", 'player album element')
    value = once(value, """      case 'artist':
        return this.#detailData('artist', route.params, page);
""", """      case 'artist':
        return this.#artistAlbumsData(route.params, page);
""", 'artist route fetch')
    value = once(value, """    const method = {
      album: 'getAlbumTracks',
      artist: 'getArtistTracks',
      genre: 'getGenreTracks',
      playlist: 'getPlaylistTracks'
    }[kind];
    const key = {
      album: 'albumGUID',
      artist: 'artistGUID',
      genre: 'genreGUID',
      playlist: 'playlistGUID'
    }[kind];
""", """    const method = {
      album: 'getAlbumTracks',
      genre: 'getGenreTracks',
      playlist: 'getPlaylistTracks'
    }[kind];
    const key = {
      album: 'albumGUID',
      genre: 'genreGUID',
      playlist: 'playlistGUID'
    }[kind];
""", 'remove artist track detail mapping')
    anchor = '  async #fetchAll(method, args = {}, pageSize = 500, hardLimit = 30000) {\n'
    method = """  async #artistAlbumsData(params, page = 1) {
    const item = params.item || this.#findKnownItem('artist', params.guid) || {
      guid: params.guid,
      name: params.name || detailFallback('artist')
    };
    const result = await api.music('getArtistAlbums', {
      artistGUID: params.guid,
      page,
      size: GRID_PAGE_SIZE
    });
    const paged = normalizePageResult(result, page, GRID_PAGE_SIZE);
    return { item, albums: paged.list, pagination: paged.pagination };
  }

"""
    value = once(value, anchor, method + anchor, 'artist album data method')
    value = once(value, """      case 'album':
      case 'artist':
      case 'genre':
      case 'playlist':
        this.currentDetail = { kind: route.name, item: data.item };
        this.currentTracks = data.tracks;
        this.els.content.innerHTML = detailView({
          kind: route.name,
          item: data.item,
          tracks: data.tracks,
          pagination: data.pagination
        });
        this.#mountTrackTable(data.tracks);
        break;
""", """      case 'artist':
        this.currentDetail = { kind: 'artist', item: data.item };
        this.currentItems = data.albums;
        this.els.content.innerHTML = artistAlbumsView({
          item: data.item,
          albums: data.albums,
          pagination: data.pagination
        });
        break;
      case 'album':
      case 'genre':
      case 'playlist':
        this.currentDetail = { kind: route.name, item: data.item };
        this.currentTracks = data.tracks;
        this.els.content.innerHTML = detailView({
          kind: route.name,
          item: data.item,
          tracks: data.tracks,
          pagination: data.pagination
        });
        this.#mountTrackTable(data.tracks);
        break;
""", 'artist album render')
    value = once(value, """    if (target.dataset.openKind && target.dataset.openId) {
      const kind = target.dataset.openKind;
      const item = this.#findKnownItem(kind, target.dataset.openId);
      this.#navigate(kind, { guid: target.dataset.openId, item });
      return;
    }
""", """    if (target.dataset.openKind && target.dataset.openId) {
      const kind = target.dataset.openKind;
      const guid = target.dataset.openId;
      const known = this.#findKnownItem(kind, guid);
      const item = known || {
        guid,
        name: target.dataset.openName || detailFallback(kind),
        coverId: target.dataset.openCoverId || null
      };
      this.#navigate(kind, { guid, item });
      return;
    }
""", 'entity metadata navigation')
    player = "    this.els.playerArtist.textContent = track ? artistsText(track) : 'XT Music';\n"
    value = once(value, player, player + """    const playerAlbum = track?.album || null;
    const playerAlbumGuid = String(playerAlbum?.guid || track?.albumGUID || track?.albumGuid || '').trim();
    const playerAlbumName = track ? (playerAlbum?.name || '未知专辑') : '未知专辑';
    this.els.playerAlbum.textContent = playerAlbumName;
    this.els.playerAlbum.disabled = !playerAlbumGuid;
    this.els.playerAlbum.classList.toggle('is-clickable', Boolean(playerAlbumGuid));
    this.els.playerAlbum.title = playerAlbumGuid ? `打开专辑 ${playerAlbumName}` : '';
    if (playerAlbumGuid) {
      this.els.playerAlbum.dataset.openKind = 'album';
      this.els.playerAlbum.dataset.openId = playerAlbumGuid;
      this.els.playerAlbum.dataset.openName = playerAlbumName;
      this.els.playerAlbum.dataset.openCoverId = playerAlbum?.coverId || coverId || '';
    } else {
      delete this.els.playerAlbum.dataset.openKind;
      delete this.els.playerAlbum.dataset.openId;
      delete this.els.playerAlbum.dataset.openName;
      delete this.els.playerAlbum.dataset.openCoverId;
    }
""", 'bottom player album render')
    value = once(value, """      const lists = [
        value?.list,
        value?.albums?.list,
        value?.artists?.list,
        value?.playlists?.list
      ];
""", """      const lists = [
        value?.list,
        value?.albums,
        value?.albums?.list,
        value?.artists?.list,
        value?.playlists?.list
      ];
""", 'artist album cache lookup')
    value = once(value, "    artist: '正在打开歌手…',\n", "    artist: '正在加载歌手专辑…',\n", 'artist loading label')
    save(path, value)

path = 'src/renderer/styles.css'
value = text(path)
if MARKER not in value:
    value = value.rstrip() + f'''

/* {MARKER}: album-first artist pages and universal album links */
.entity-link {{ min-width: 0; padding: 0; color: inherit; text-align: inherit; background: transparent; border: 0; }}
.entity-link:not(:disabled):hover {{ color: var(--text); text-decoration: underline; }}
.now-playing-meta {{ display: flex; align-items: center; min-width: 0; gap: 5px; color: var(--text-muted); font-size: 10px; }}
.now-playing-meta > * {{ min-width: 0; }}
#player-artist, .now-playing-album {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
#player-artist {{ flex: 0 1 auto; }}
.now-playing-separator {{ flex: 0 0 auto; opacity: 0.55; }}
.now-playing-album {{ flex: 1 1 auto; padding: 0; color: var(--text-muted); text-align: left; background: transparent; border: 0; font-size: 10px; }}
.now-playing-album:disabled {{ cursor: default; opacity: 0.7; }}
.now-playing-album.is-clickable:hover {{ color: var(--text-secondary); text-decoration: underline; }}
.track-album-link {{ display: block; width: 100%; overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }}
.track-album-link:hover {{ color: var(--text); }}
.lyrics-album-link, .lyrics-album-fallback {{ display: inline-flex; gap: 6px; align-items: center; max-width: 100%; margin-top: 6px; color: color-mix(in srgb, var(--lyrics-foreground) 48%, transparent); font-size: 11px; font-weight: 560; }}
.lyrics-album-link span {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
.lyrics-album-link:hover {{ color: color-mix(in srgb, var(--lyrics-foreground) 78%, transparent); }}
.artist-albums-page .detail-hero {{ min-height: 300px; }}
.artist-albums-section {{ padding: 30px clamp(28px, 4vw, 58px) 54px; }}
.artist-albums-section .section-title-row {{ margin-bottom: 18px; }}
.artist-albums-section .section-title-row > div {{ display: flex; gap: 10px; align-items: baseline; }}
.artist-albums-section .section-title-row h2 {{ margin: 0; font-size: 21px; letter-spacing: -0.025em; }}
.artist-albums-section .section-title-row span {{ color: var(--text-muted); font-size: 11px; }}
.artist-album-grid {{ align-items: start; }}
@media (max-width: 860px) {{ .artist-albums-section {{ padding-right: 18px; padding-left: 18px; }} }}
'''
    save(path, value + '\n')

print('Applied application and album navigation styles patch')
