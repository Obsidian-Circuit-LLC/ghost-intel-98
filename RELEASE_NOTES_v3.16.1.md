# Ghost Intel 98 — v3.16.1

**Bring your own TTS voice.** The AI assistant's offline Piper voice is no longer limited to the one
bundled voice — add your own and pick it from a dropdown. Renderer/main-process only; no crypto,
data-format, or protocol change.

## What's new

### User-supplied Piper voices
- A new **Voices** folder under your app data holds extra Piper voices. Drop a matching
  **`<name>.onnx` + `<name>.onnx.json`** pair in, and it appears in the assistant's voice picker.
- In the assistant's voice controls (when the Piper / offline-neural engine is active), a
  **voice dropdown** lists **🧠 Bundled neural** plus every voice you've added; pick one to use it.
- A **📁 Voices** button opens the folder (created on first click) so you know exactly where to put
  the files; the list refreshes when you return.
- **Default unchanged** — with no added voices, the bundled public-domain neural voice is used,
  exactly as before.

### Why it's safe
- **Traversal-safe selection (main-process trust boundary).** The renderer only ever sends a voice
  *id*; the main process resolves it by matching against the files it actually scanned in the Voices
  folder. An unknown, empty, `../…`, or absolute-path selection resolves to nothing and **falls back
  to the bundled voice** — it can never make the engine load a model outside the Voices folder.
- The bundled piper **binary keeps its verify-before-exec SHA-256 gate**; your voice models are data
  you chose to add.
- **Local only:** nothing is bundled or downloaded, no telemetry, no new network path. (This is the
  intended way to use any third-party voice locally without shipping it.)

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.16.1.exe -Algorithm SHA256
```

SHA-256: `__SHA256__`
Size: `__SIZE__`

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- Built with TDD: the traversal-safe scan/resolve core is unit-tested (including the path-traversal
  and absolute-path rejection cases); per-task spec + code-quality review and a whole-branch review.
  **1177 automated tests** green, typecheck clean.
- Same `Ghost Intel 98` app id — upgrades in place.
- Everything from v3.16.0 carries forward.
