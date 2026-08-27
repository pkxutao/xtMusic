#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'XT_TRACK_LIST_TYPOGRAPHY_0_3_7'


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding='utf-8')


def once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 anchor, got {count}')
    return value.replace(old, new, 1)


# The virtual table's geometry must match the larger visual row height.
path = 'src/renderer/virtual-table.js'
value = read(path)
if MARKER not in value:
    value = once(
        value,
        '    this.rowHeight = options.rowHeight || 58;\n',
        f'    this.rowHeight = options.rowHeight || 64; // {MARKER}\n',
        'virtual track row height'
    )
    write(path, value)

# Append narrowly scoped overrides so every page using the shared song table
# receives the same readable typography without inflating unrelated screens.
path = 'src/renderer/styles.css'
value = read(path)
if MARKER not in value:
    value = value.rstrip() + f'''

/* {MARKER}: readable song lists across library and detail pages */
.virtual-track-table {{
  grid-template-rows: 42px minmax(0, 1fr);
}}

.track-table-head {{
  font-size: 12px;
  font-weight: 680;
  letter-spacing: 0.025em;
}}

.track-table-row {{
  font-size: 13px;
}}

.track-col-index {{
  font-size: 12px;
}}

.track-row-cover {{
  width: 42px;
  height: 42px;
}}

.track-row-title {{
  font-size: 14px;
  font-weight: 630;
  line-height: 1.35;
}}

.track-row-subtitle,
.track-col-album,
.track-col-date,
.track-col-duration {{
  font-size: 12px;
  line-height: 1.4;
}}

.track-album-link {{
  font-size: inherit;
  line-height: inherit;
}}

/* The play queue is also a song list, so keep it visually consistent. */
.queue-row {{
  grid-template-columns: 42px minmax(0, 1fr) auto;
  min-height: 54px;
}}

.queue-row-cover {{
  width: 42px;
  height: 42px;
}}

.queue-row-title {{
  font-size: 13px;
  line-height: 1.35;
}}

.queue-row-artist {{
  font-size: 11px;
  line-height: 1.35;
}}

/* Song rows used in picker dialogs should not fall back to 10px metadata. */
.selectable-row {{
  font-size: 13px;
}}

.selectable-row small {{
  font-size: 11px;
}}
'''
    write(path, value + '\n')

print('Applied larger typography and matching geometry to every song list')
