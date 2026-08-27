#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'XT_BOTTOM_PLAYER_ALBUM_CLICK_0_3_7'


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding='utf-8')


def once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)


path = 'src/renderer/app.js'
value = read(path)
if MARKER not in value:
    anchor = "    this.els.playerTitle.addEventListener('click', openNowPlaying);\n"
    addition = anchor + f"""    // {MARKER}: keep this control independent from the now-playing title action.
    this.els.playerAlbum.addEventListener('click', (event) => {{
      event.preventDefault();
      event.stopPropagation();
      const guid = String(this.els.playerAlbum.dataset.openId || '').trim();
      if (!guid) return;
      const item = {{
        guid,
        name: this.els.playerAlbum.dataset.openName || this.els.playerAlbum.textContent || '未知专辑',
        coverId: this.els.playerAlbum.dataset.openCoverId || null
      }};
      this.#navigate('album', {{ guid, item }});
    }});
"""
    value = once(value, anchor, addition, 'bottom-player album click handler')
    write(path, value)

print('Applied explicit bottom-player album click handler')
