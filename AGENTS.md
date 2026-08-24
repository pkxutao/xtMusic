# AGENTS.md

## Scope

This repository contains an Electron desktop client for FNOS Music. Windows and Ubuntu share one protocol, renderer, player and account implementation; platform-specific behavior belongs in `src/main/platform.js` and `src/renderer/platform.*`.

## Non-negotiable security rules

- Never persist the user's original FNOS password.
- Never expose `music-token`, access code, encrypted secret material, or arbitrary network access to the renderer.
- Keep `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Do not add global certificate bypasses.
- Do not preserve credentials across an untrusted cross-origin redirect.
- Do not add telemetry, analytics, crash upload, or remote web content without explicit user approval.
- Do not log complete server URLs when they contain user-specific relay identifiers.
- On Linux, never treat Electron `safeStorage` backend `basic_text` or `unknown` as secure persistence.

## Architecture

- Main process owns credentials and protocol.
- Preload exposes an allow-listed API.
- Renderer is presentation only.
- Media must use the `xtmusic://` proxy.
- Large track lists must use `VirtualTrackTable`.
- Wayland must not depend on restoring absolute window coordinates.
- Linux tray activation uses the `click` event; Windows uses `double-click`.

## Before committing

Run:

```bash
npm run build
```

For release changes, validate the relevant platform package:

```bash
npm run pack:win
npm run pack:ubuntu
```

Full distributable builds:

```bash
npm run dist:win
npm run dist:ubuntu
```
