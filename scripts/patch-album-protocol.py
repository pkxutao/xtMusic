#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'XT_ALBUM_NAVIGATION_0_3_7'

def text(path): return (ROOT / path).read_text(encoding='utf-8')
def save(path, value): (ROOT / path).write_text(value, encoding='utf-8')
def once(value, old, new, label):
    count = value.count(old)
    if count != 1: raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)

for name in ('package.json', 'package-lock.json'):
    path = ROOT / name
    data = json.loads(path.read_text(encoding='utf-8'))
    data['version'] = '0.3.7'
    if name == 'package.json':
        data['description'] = 'Responsive large-library build with album-first artist pages and universal album navigation.'
    elif isinstance(data.get('packages', {}).get(''), dict):
        data['packages']['']['version'] = '0.3.7'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

path = 'src/main/ipc.js'
value = text(path)
if "'getArtistAlbums'," not in value:
    value = once(value, "  'getArtistTracks',\n", "  'getArtistTracks',\n  'getArtistAlbums',\n", 'IPC allowlist')
    save(path, value)

path = 'src/main/protocol/feiniu-client.js'
value = text(path)
if MARKER not in value:
    value = once(
        value,
        '    this.allowSelfSigned = Boolean(session.allowSelfSigned);\n',
        '    this.allowSelfSigned = Boolean(session.allowSelfSigned);\n    this.artistAlbumsCache = new Map();\n',
        'artist cache init'
    )
    anchor = """  getArtistTracks({ artistGUID, page = 1, size = 100, sort = null } = {}) {
    requireId(artistGUID, 'artistGUID');
    return this.#page('/track/artist-detail/list', { artistGUID, page, size, sort });
  }
"""
    addition = anchor + f"""
  // {MARKER}: FNOS has an artist-track endpoint but no artist-album endpoint.
  // Build the artist's albums from only that artist's bounded track pages and cache them.
  async getArtistAlbums({{ artistGUID, page = 1, size = 72 }} = {{}}) {{
    const id = requireId(artistGUID, 'artistGUID');
    const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
    const safeSize = Math.max(1, Math.min(200, Number.parseInt(String(size || 72), 10) || 72));
    let pending = this.artistAlbumsCache.get(id);
    if (!pending) {{
      pending = this.#collectArtistAlbums(id);
      this.artistAlbumsCache.set(id, pending);
      while (this.artistAlbumsCache.size > 48) {{
        const oldest = this.artistAlbumsCache.keys().next().value;
        if (oldest === id) break;
        this.artistAlbumsCache.delete(oldest);
      }}
    }} else {{
      this.artistAlbumsCache.delete(id);
      this.artistAlbumsCache.set(id, pending);
    }}
    let albums;
    try {{ albums = await pending; }} catch (error) {{
      this.artistAlbumsCache.delete(id);
      throw error;
    }}
    const start = (safePage - 1) * safeSize;
    return {{
      list: albums.slice(start, start + safeSize),
      total: albums.length,
      page: safePage,
      size: safeSize,
      sort: 'releaseDate:desc,name:asc'
    }};
  }}

  async #collectArtistAlbums(artistGUID) {{
    const pageSize = 400;
    const hardLimit = 12000;
    const first = await this.getArtistTracks({{ artistGUID, page: 1, size: pageSize }});
    const tracks = [...(first?.list || [])];
    const total = Math.min(Math.max(tracks.length, Number(first?.total || tracks.length)), hardLimit);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    for (let start = 2; start <= pages; start += 3) {{
      const requests = [];
      for (let current = start; current < Math.min(start + 3, pages + 1); current += 1) {{
        requests.push(this.getArtistTracks({{ artistGUID, page: current, size: pageSize }}));
      }}
      for (const result of await Promise.all(requests)) {{
        tracks.push(...(result?.list || []));
        if (tracks.length >= hardLimit) break;
      }}
      if (tracks.length >= hardLimit) break;
    }}
    const albums = new Map();
    for (const track of tracks.slice(0, hardLimit)) {{
      const source = track?.album || {{}};
      const guid = String(source.guid || track?.albumGUID || track?.albumGuid || '').trim();
      if (!guid) continue;
      let album = albums.get(guid);
      if (!album) {{
        album = {{
          guid,
          name: String(source.name || track?.albumName || '未知专辑'),
          coverId: source.coverId || track?.coverId || null,
          releaseDate: source.releaseDate ?? null,
          createdAt: source.createdAt ?? null,
          trackCount: 0
        }};
        albums.set(guid, album);
      }}
      album.trackCount += 1;
      const serverCount = Number(source.trackCount || 0);
      if (Number.isFinite(serverCount) && serverCount > album.trackCount) album.trackCount = serverCount;
      if (!album.coverId && (source.coverId || track?.coverId)) album.coverId = source.coverId || track.coverId;
      if ((!album.name || album.name === '未知专辑') && source.name) album.name = source.name;
      if (album.releaseDate == null && source.releaseDate != null) album.releaseDate = source.releaseDate;
      if (album.createdAt == null && source.createdAt != null) album.createdAt = source.createdAt;
    }}
    return [...albums.values()].sort((left, right) => {{
      const leftDate = Number(left.releaseDate || left.createdAt || 0);
      const rightDate = Number(right.releaseDate || right.createdAt || 0);
      if (leftDate !== rightDate) return rightDate - leftDate;
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', {{ numeric: true, sensitivity: 'base' }});
    }});
  }}
"""
    value = once(value, anchor, addition, 'artist album method')
    save(path, value)

print('Applied protocol-side album navigation patch')
