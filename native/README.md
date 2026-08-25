# XT Music Native

`native/` is the browser-free rewrite of XT Music.

## What “native” means here

- Rust application and protocol core
- Iced 0.14 native window/event loop
- wgpu renderer: DirectX 12 on Windows, Vulkan on Ubuntu when available
- no Chromium, Electron, DOM, HTML, CSS, JavaScript, or WebView
- mpv native audio process controlled through JSON IPC

This is intentionally separate from the existing Electron client until feature
parity and real-NAS testing are complete.

## Current Native Preview scope

- explicit FNOS URL and FN ID discovery
- official `fnos.net` / `5ddd.com` relay redirects
- access security code handshake
- FlyMusic application-account password login
- SHA-256 password digest; raw password is never written to disk
- paged loading of up to 30,000 tracks
- native virtualized song list and local search
- authenticated audio streaming through mpv
- play/pause, previous/next, seek, volume, and progress polling
- LRC parsing and synchronized native lyric display
- Windows and Ubuntu CI builds

## Build

```bash
cd native
cargo run -p xtmusic-native
```

Ubuntu build requirements:

```bash
sudo apt install build-essential pkg-config \
  libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev \
  libx11-xcb-dev libasound2-dev mpv
```

Windows playback requires `mpv.exe` in `PATH`, beside the executable, or at:

```text
runtime/mpv/mpv.exe
```

The player can also be selected explicitly:

```bash
XTMUSIC_MPV=/path/to/mpv cargo run -p xtmusic-native
```

## Security boundary

The UI never receives a persistent raw password. The current preview keeps the
session only in memory. Before the native client becomes the default release,
Windows Credential Manager and Linux Secret Service storage will be added.
