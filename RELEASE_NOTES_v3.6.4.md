# Dead Cyber Society 98 — v3.6.4

**PDF viewer fixed.** The in-app document viewer renders PDFs again.

## What's new

- **PDF viewer renders again.** The in-app Doc Viewer now displays PDF case attachments page by
  page (zoom in/out) as intended. This clears the v3.6.3 known issue.

## The fix (what was wrong)

- pdfjs-dist 5.x calls `Map.prototype.getOrInsertComputed()` during page render — a recent TC39
  ("getOrInsert") proposal method that **Electron 33's Chromium 130 does not ship**. The render
  path threw `getOrInsertComputed is not a function` and the viewer went blank.
- This is the same class of gap as the `Uint8Array.toHex` method we already polyfill for pdf.js;
  the new method was simply missed. v3.6.4 adds a spec-faithful `Map.prototype.getOrInsertComputed`
  (and `WeakMap`) polyfill, installed in **both** the renderer and the pdf.js worker realms, and
  guarded so it becomes a no-op once the bundled Chromium ships the method natively.

## Verification

- `typecheck` clean · **243 tests** (5 new, asserting the polyfill matches the proposal contract —
  existing-value short-circuit, compute-on-miss, key passed to the callback, falsy-value handling).
- Reproduced and confirmed in the real Electron/Chromium-130 environment (`file://`, app CSP,
  module worker): a generated PDF goes `getDocument OK` → **render OK** where it previously threw.

## Notes

- Renderer-only change (a JS polyfill) — no IPC, network-egress, or encryption-at-rest code was
  touched. The viewer still streams bytes via the path-confined IPC; no `file://` URLs, no remote
  fetches.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.4.exe` — to be produced at packaging time (`pnpm package:win`).
**SHA-256:** _pending — fill in from the packaged installer before publishing the release._
