# Dead Cyber Society 98 — v3.6.5

**The AI can now read PDF case attachments — and sticky notes are resizable.**

## What's new

- **AI reads PDFs.** Attach a PDF to a case and the assistant now includes its **text** in case
  context. PDFs were previously rejected as "binary" (the first NUL byte tripped the binary guard),
  so the model never saw them. v3.6.5 extracts the PDF **text layer** through the same offline pdf.js
  engine the in-app viewer uses — **no OCR, no network, no `file://`** — and feeds it in under the
  *same* remote-egress confirmation and size caps as every other attachment.
- **Resizable sticky notes.** Each desktop note now has a **resize grip** in its bottom-right corner.
  Drag it to size the note; the dimensions persist per note and survive restarts.

## Details

- **Text-layer only, by design.** A scanned / image-only PDF has no text layer and yields nothing —
  in that case the attachment is reported as *no extractable text* rather than silently dropped. OCR
  is out of scope (it would mean shipping an image-recognition model; not happening here).
- **No new trust surface.** Extraction runs entirely in the renderer through the existing pdf.js
  worker + polyfills; the bytes come from the same path-confined attachment IPC already in use. The
  text is gathered inside the existing `gatherCaseFiles` path, so it inherits the per-item and total
  context caps and the **explicit confirmation before anything leaves the machine** to a remote model.
- **Sticky-note sizes are validated.** New `w`/`h` fields are clamped in the **main-process**
  validator (min 140×90, max 1200×1200) before they ever hit disk — the renderer is still treated as
  hostile; the persisted size is the validator's output, not whatever the renderer claims.

## Verification

- `typecheck` clean · **251 tests** (8 new: 4 cover PDF text-item joining incl. EOL handling and
  marked-content skips; 4 cover the sticky-note dimension validator — omit-when-absent, round/keep,
  min/max clamp, drop-non-numeric).
- PDF extraction **confirmed end-to-end in the real Electron/Chromium-130 environment**: a generated
  PDF runs through the live pdf.js worker and the expected text is recovered.
- Resizable notes verified visually: a note with persisted `360×260` renders at that size with the
  grip; a default note renders at `184×120`; a forged on-disk size is clamped on load by the validator.

## Notes

- The PDF change is renderer + a main-process validator bound; **no new network egress** anywhere.
  Extraction is offline; the only thing that ever goes remote is the case context you already confirm.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.5.exe` (124,480,907 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `3cd8eb58b4962f1884368f2df16c20113e722ee98b25b19c6cb62b6e3d5211a8`
