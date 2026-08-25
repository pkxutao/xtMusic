#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
log_path = Path(sys.argv[1])
log = log_path.read_text(encoding="utf-8", errors="replace")
changed = []


def replace(path: Path, old: str, new: str, reason: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        return
    path.write_text(text.replace(old, new), encoding="utf-8")
    changed.append(reason)


main = root / "src/main.rs"
app = root / "src/app.rs"
player = root / "src/player.rs"
cargo = root / "Cargo.toml"

if "no field `persist_window`" in log or "no field named `persist_window`" in log:
    replace(main, "        persist_window: true,\n", "", "remove unsupported persist_window")

if "expected `FontData`, found `Arc<FontData>`" in log:
    replace(
        app,
        'Arc::new(FontData::from_owned(bytes))',
        'FontData::from_owned(bytes)',
        "use non-Arc FontData map",
    )

if "expected `Arc<FontData>`, found `FontData`" in log:
    replace(
        app,
        'FontData::from_owned(bytes)',
        'Arc::new(FontData::from_owned(bytes))',
        "use Arc FontData map",
    )

if "no method named `drag_stopped`" in log:
    replace(app, ".drag_stopped()", ".drag_released()", "use drag_released compatibility")

if "no method named `get_pos`" in log:
    replace(
        player,
        "            state.position = current.get_pos().as_secs_f64();",
        "            if state.playing { state.position = (state.position + 0.08).min(state.duration.max(state.position + 0.08)); }",
        "use native playback clock fallback",
    )

if "package `eframe`" in log and "not found" in log:
    replace(cargo, 'eframe = { version = "0.32.3"', 'eframe = { version = "0.31.1"', "fallback eframe version")
    replace(cargo, 'egui_extras = { version = "0.32.3"', 'egui_extras = { version = "0.31.1"', "fallback egui_extras version")

if "symphonia-all" in log and ("feature" in log or "failed to select" in log):
    replace(
        cargo,
        'rodio = { version = "0.20.1", features = ["symphonia-all"] }',
        'rodio = "0.20.1"',
        "use rodio default codecs",
    )

if "rustls-tls-native-roots" in log and "feature" in log:
    replace(
        cargo,
        '"rustls-tls-native-roots"',
        '"rustls-tls"',
        "use portable reqwest rustls feature",
    )

print("\n".join(changed) if changed else "no deterministic fix matched")
sys.exit(0 if changed else 2)
