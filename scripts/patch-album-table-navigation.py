#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding='utf-8')
def write(path, value): (ROOT / path).write_text(value, encoding='utf-8')
def once(value, old, new, label):
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)

path = 'src/renderer/virtual-table.js'
value = read(path)
old = """  #handleClick(event) {
    if (event.target.closest('[data-open-kind][data-open-id]')) return;
    const row = event.target.closest('[data-track-index]');
"""
new = """  #handleClick(event) {
    const entity = event.target.closest('[data-open-kind][data-open-id]');
    if (entity) {
      event.preventDefault();
      event.stopPropagation();
      const kind = entity.dataset.openKind;
      const guid = entity.dataset.openId;
      this.options.onOpenEntity?.(kind, guid, {
        guid,
        name: entity.dataset.openName || '',
        coverId: entity.dataset.openCoverId || null
      });
      return;
    }
    const row = event.target.closest('[data-track-index]');
"""
value = once(value, old, new, 'virtual table entity callback')
write(path, value)

path = 'src/renderer/app.js'
value = read(path)
old = """      onAction: (action, index, track, event) => this.#handleTrackAction(action, track, tracks, index, event),
      onContext: (event, index, track) => this.#showTrackContext(event, track, tracks, index)
"""
new = """      onAction: (action, index, track, event) => this.#handleTrackAction(action, track, tracks, index, event),
      onOpenEntity: (kind, guid, item) => this.#navigate(kind, { guid, item }),
      onContext: (event, index, track) => this.#showTrackContext(event, track, tracks, index)
"""
value = once(value, old, new, 'application table entity callback')
write(path, value)

print('Applied explicit virtual-table album navigation callback')
