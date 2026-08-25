# Native architecture

```text
xtmusic-app (Iced/wgpu)
  ├─ Login / library / lyric state machine
  ├─ Native virtualized track list
  └─ mpv JSON IPC controller

xtmusic-core (pure Rust)
  ├─ FN Connect discovery and candidate probing
  ├─ strict official-relay redirect boundary
  ├─ FlyMusic API client
  ├─ authenticated media URL/header generation
  └─ LRC parser and active-line search
```

## Why Iced instead of another WebView shell

Tauri would reduce the process footprint compared with Electron, but its UI is
still HTML/CSS rendered by a system WebView. That does not address the stated
requirement.

Iced renders widgets through wgpu and owns a native window/event loop. It does
not embed a browser engine. The same Rust UI code runs on Windows and Ubuntu.

## Why not two platform widget stacks

A strict OS-widget implementation would mean WinUI 3 on Windows and
GTK4/libadwaita on Ubuntu. That provides the closest platform-native controls,
but requires two independent UI implementations and doubles long-term layout,
accessibility, and interaction work.

The selected design is GPU-native and browser-free while retaining one UI
codebase. Platform integrations such as Windows media controls and Linux MPRIS
can remain small adapters.

## Player

The preview launches mpv as a native child process and communicates over a
Unix socket or Windows named pipe. Network credentials are supplied as request
headers to mpv and are never put in the stream URL.

A later packaging stage can bundle an LGPL-compatible mpv build or replace the
process boundary with libmpv while preserving the UI and protocol layers.
