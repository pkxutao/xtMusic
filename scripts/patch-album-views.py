#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def text(path): return (ROOT / path).read_text(encoding='utf-8')
def save(path, value): (ROOT / path).write_text(value, encoding='utf-8')
def once(value, old, new, label):
    count = value.count(old)
    if count != 1: raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)

path = 'src/renderer/index.html'
value = text(path)
if 'id="player-album"' not in value:
    value = once(value, '''        <div class="now-playing-copy">
          <button id="player-title" class="now-playing-title" type="button" title="打开正在播放和歌词">选择一首歌曲</button>
          <span id="player-artist">XT Music</span>
        </div>
''', '''        <div class="now-playing-copy">
          <button id="player-title" class="now-playing-title" type="button" title="打开正在播放和歌词">选择一首歌曲</button>
          <div class="now-playing-meta">
            <span id="player-artist">XT Music</span>
            <span class="now-playing-separator" aria-hidden="true">·</span>
            <button id="player-album" class="now-playing-album" type="button" disabled title="">未知专辑</button>
          </div>
        </div>
''', 'bottom player album')
    save(path, value)

path = 'src/renderer/views.js'
value = text(path)
if 'export function artistAlbumsView' not in value:
    marker = 'export function trackPageView({\n'
    artist_view = '''export function artistAlbumsView({ item, albums, pagination = null }) {
  const title = item?.name || item?.title || '未知歌手';
  const total = Number(pagination?.total || albums?.length || item?.albumCount || 0);
  const coverId = item?.coverId || albums?.find((album) => album?.coverId)?.coverId;
  const trackCount = Number(item?.trackCount || 0);
  return `
    <div class="page detail-page artist-albums-page">
      <section class="detail-hero artist-albums-hero">
        <div class="detail-backdrop" style="${coverId ? `background-image:url('${attr(coverUrl(coverId, 800))}')` : ''}"></div>
        <div class="detail-hero-content">
          ${imageHtml(item?.coverId, title, 'detail-cover round', 900)}
          <div class="detail-copy">
            <p class="eyebrow">歌手</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="detail-meta">${total} 张专辑${trackCount ? ` · ${trackCount} 首歌曲` : ''}</p>
            <div class="detail-actions">
              <button class="secondary-button" data-action="refresh">${icon('refresh', 16)}刷新专辑</button>
            </div>
          </div>
        </div>
      </section>
      <section class="artist-albums-section">
        <div class="section-title-row">
          <div><h2>专辑</h2><span>${total} 张</span></div>
        </div>
        <div class="media-grid artist-album-grid">
          ${(albums || []).map((album) => mediaCard(album, 'album')).join('') || emptyState('album', '这个歌手暂时没有可浏览的专辑')}
        </div>
        ${paginationView(pagination)}
      </section>
    </div>
  `;
}

'''
    value = once(value, marker, artist_view + marker, 'artist album view')

old = '''          <div class="lyrics-track-copy">
            <h1>${escapeHtml(track.title)}</h1>
            <p>${escapeHtml(artistsText(track))}</p>
            <span>${escapeHtml(track.album?.name || '未知专辑')}</span>
          </div>
'''
new = '''          <div class="lyrics-track-copy">
            <h1>${escapeHtml(track.title)}</h1>
            <p>${escapeHtml(artistsText(track))}</p>
            ${track.album?.guid ? `
              <button class="lyrics-album-link entity-link"
                      type="button"
                      data-open-kind="album"
                      data-open-id="${attr(track.album.guid)}"
                      data-open-name="${attr(track.album.name || '未知专辑')}"
                      data-open-cover-id="${attr(track.album.coverId || track.coverId || '')}">
                ${icon('album', 14)}<span>${escapeHtml(track.album.name || '未知专辑')}</span>
              </button>
            ` : `<span class="lyrics-album-fallback">${escapeHtml(track.album?.name || '未知专辑')}</span>`}
          </div>
'''
if old in value: value = once(value, old, new, 'lyrics album link')
elif 'lyrics-album-link' not in value: raise RuntimeError('lyrics album link anchor missing')

old = '''    <article class="media-card ${kind}-card" data-open-kind="${kind}" data-open-id="${attr(item.guid)}">
      <div class="media-card-art">
        ${imageHtml(item.coverId, name, coverClass, 480)}
        <button class="card-play" data-open-kind="${kind}" data-open-id="${attr(item.guid)}" data-autoplay="true" aria-label="打开并播放">${icon('play', 20)}</button>
'''
new = '''    <article class="media-card ${kind}-card"
             data-open-kind="${kind}"
             data-open-id="${attr(item.guid)}"
             data-open-name="${attr(name)}"
             data-open-cover-id="${attr(item.coverId || '')}">
      <div class="media-card-art">
        ${imageHtml(item.coverId, name, coverClass, 480)}
        <button class="card-play"
                data-open-kind="${kind}"
                data-open-id="${attr(item.guid)}"
                data-open-name="${attr(name)}"
                data-open-cover-id="${attr(item.coverId || '')}"
                data-autoplay="true"
                aria-label="打开并播放">${icon('play', 20)}</button>
'''
if old in value: value = once(value, old, new, 'card entity metadata')
elif 'data-open-name="${attr(name)}"' not in value: raise RuntimeError('card entity metadata anchor missing')
save(path, value)

path = 'src/renderer/virtual-table.js'
value = text(path)
if 'track-album-link' not in value:
    value = once(value, '  albumText,\n  artistsText,\n', '  albumText,\n  artistsText,\n  attr,\n', 'attr import')
    value = once(value, '''    this.viewport.addEventListener('dblclick', (event) => {
      const row = event.target.closest('[data-track-index]');
''', '''    this.viewport.addEventListener('dblclick', (event) => {
      if (event.target.closest('[data-open-kind][data-open-id]')) return;
      const row = event.target.closest('[data-track-index]');
''', 'album dblclick guard')
    value = once(value, '''  #handleClick(event) {
    const row = event.target.closest('[data-track-index]');
''', '''  #handleClick(event) {
    if (event.target.closest('[data-open-kind][data-open-id]')) return;
    const row = event.target.closest('[data-track-index]');
''', 'album click guard')
    value = once(value, '''    const coverId = track.coverId || track.album?.coverId;
    const artists = artistsText(track);
    return `
''', '''    const coverId = track.coverId || track.album?.coverId;
    const artists = artistsText(track);
    const album = track.album || {};
    const albumName = albumText(track);
    const albumGuid = String(album.guid || track.albumGUID || track.albumGuid || '').trim();
    const albumMarkup = albumGuid
      ? `<button class="entity-link track-album-link"
                 type="button"
                 data-open-kind="album"
                 data-open-id="${attr(albumGuid)}"
                 data-open-name="${attr(albumName)}"
                 data-open-cover-id="${attr(album.coverId || coverId || '')}"
                 title="打开专辑 ${attr(albumName)}">${escapeHtml(albumName)}</button>`
      : `<span>${escapeHtml(albumName)}</span>`;
    return `
''', 'track album data')
    value = once(value, '''        <div class="track-col-album" title="${escapeHtml(albumText(track))}">${escapeHtml(albumText(track))}</div>
''', '''        <div class="track-col-album" title="${escapeHtml(albumName)}">${albumMarkup}</div>
''', 'track album markup')
    save(path, value)

print('Applied renderer view/table album navigation patch')
