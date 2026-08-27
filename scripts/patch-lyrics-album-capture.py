#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'XT_LYRICS_ALBUM_CAPTURE_0_3_7'


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
    anchor = """  #bindGlobalEvents() {
    document.addEventListener('click', (event) => this.#handleClick(event));
"""
    addition = f"""  #bindGlobalEvents() {{
    // {MARKER}: lyrics enhancements can install their own delegated handlers.
    // Capture this navigation at Window before any page-level handler can consume it.
    window.addEventListener('click', (event) => {{
      const target = event.target.closest?.('.lyrics-album-link[data-open-id]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const guid = String(target.dataset.openId || '').trim();
      if (!guid) return;
      const item = {{
        guid,
        name: target.dataset.openName || target.textContent?.trim() || '未知专辑',
        coverId: target.dataset.openCoverId || null
      }};
      this.#navigate('album', {{ guid, item }});
    }}, true);
    document.addEventListener('click', (event) => this.#handleClick(event));
"""
    value = once(value, anchor, addition, 'lyrics album capture handler')
    write(path, value)

print('Applied capture-phase navigation for the lyrics album link')
