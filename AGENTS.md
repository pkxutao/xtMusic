# AGENTS.md

## Scope

This repository contains an Electron Windows desktop client for FNOS Music.

## Non-negotiable security rules

- Never persist the user's original FNOS password.
- Never expose `music-token`, access code, DPAPI ciphertext, or arbitrary network access to the renderer.
- Keep `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- Do not add global certificate bypasses.
- Do not preserve credentials across an untrusted cross-origin redirect.
- Do not add telemetry, analytics, crash upload, or remote web content without explicit user approval.
- Do not log complete server URLs when they contain user-specific relay identifiers.

## Architecture

- Main process owns credentials and protocol.
- Preload exposes an allow-listed API.
- Renderer is presentation only.
- Media must use the `xtmusic://` proxy.
- Large track lists must use `VirtualTrackTable`.

## Before committing

Run:

```bash
npm run build
```

For release changes, also validate on Windows:

```bash
npm run pack:win
```
