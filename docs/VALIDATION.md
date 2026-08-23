# Validation status

This file records what has and has not been verified for the initial source drop.
It exists to prevent build or compatibility claims from getting ahead of evidence.

## Verified in the source workspace

- Required source files are present.
- CommonJS and renderer ES-module syntax checks pass under Node.js 22.
- Protocol unit tests pass, including FNID signing, SHA-256 password handling,
  URL normalization and HLS URL rewriting.
- HTTP transport tests pass, including explicit HTTP consent and removal of
  cookies, access codes and authorization headers on cross-origin redirects.
- Static Electron security checks pass for context isolation, renderer sandboxing
  and disabled Node integration.

Run the dependency-free checks with:

```bash
npm run check
npm run check:syntax
npm test
```

## Not verified in this environment

- `npm install` could not be completed because this execution environment has no
  outbound DNS access to the npm registry.
- Consequently, the Electron renderer bundle and Windows installer have not been
  built here.
- No real FNOS NAS account or live music library was available, so endpoint and
  response-field compatibility still requires testing against the target FNOS
  version.
- No installer or GitHub Release should be described as available until the
  Windows GitHub Actions workflow succeeds and its artifact is inspected.

## Required release gate

A release is ready only after all of the following are true:

1. GitHub Actions installs dependencies on `windows-latest`.
2. `npm run build` succeeds.
3. `npm run dist:win` produces both NSIS and portable executables.
4. Login, library browsing, audio playback, range seeking, lyrics, favorites and
   playlists are exercised against a real FNOS instance.
5. The built application is checked to ensure the renderer cannot read the NAS
   token or access code.
