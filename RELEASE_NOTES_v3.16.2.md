# Ghost Intel 98 — v3.16.2

**Character voices.** The assistant's offline Piper TTS now ships four selectable character voices
alongside the public-domain default. Renderer/main + build only; no crypto/data/protocol change.

## What's new

### Bundled character voices
- Four new voices ship in the installer and appear in the assistant's voice dropdown:
  **Jarvis**, **HAL 9000**, **GLaDOS**, and **Wheatley**.
- The **default stays LJ Speech (public-domain)** — out-of-the-box behavior is unchanged; the
  character voices are an opt-in pick. You can still add **your own** voices via the v3.16.1
  Voices folder; the picker lists bundled voices + your own together.

### Safety
- Each bundled voice (model + config) is **SHA-256 pinned at build time, fail-closed** — a wrong or
  tampered model aborts the build and never ships. The piper **binary keeps its verify-before-exec
  hash gate**.
- Voice selection is resolved **traversal-safe in the main process**: an unknown/invalid/`../`/
  absolute selection resolves to nothing and **falls back to the default voice** — the renderer can
  never make the engine load a model outside the voices directories.
- **No runtime network, no telemetry.** The voices are fetched only at build time from pinned URLs.

### Voice provenance / licensing
- **LJ Speech** — public domain (the default). **Jarvis** — jgkawell/jarvis (MIT). **HAL 9000** —
  campwill/HAL-9000-Piper-TTS (Apache-2.0). **GLaDOS / Wheatley** — community uploads with no declared
  upstream license. The four character voices are community models derived from their respective
  works; they are provided as an optional convenience and are not the default.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.16.2.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: `__SIZE__`

The installer is larger (~846 MB) because it carries five voices. Unsigned — Windows SmartScreen will
warn: **More info → Run anyway**. Installs per-user (no admin) and upgrades any prior `Ghost Intel 98`
build in place.

## Notes
- Built with TDD: the bundled-voice scan/resolve core is unit-tested (including the path-traversal and
  absolute-path rejection cases) and the fetch is fail-closed SHA-pinned; per-task + whole-branch
  review. **1182 automated tests** green, typecheck clean.
- Same `Ghost Intel 98` app id — upgrades in place.
- Everything from v3.16.0 carries forward.
