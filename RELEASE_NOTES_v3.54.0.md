# Ghost Intel 98 — v3.54.0

**Report-editor + PDF-Signer field polish, from GhostExodus's testing.**

Three small fixes after the v3.51–v3.53 report-editor and PDF-Signer work landed and got real use.

## What's fixed

- **Report editor — "To" recipient contacts popup.** Clicking **Choose…** next to the To field opens a contacts box (add / select / remove). Its frame didn't fully enclose the row **✕** buttons and the **Descriptor Preview** side-panel painted over them. Root cause: the popup was the 4th child of the editor's 3-column grid, so it flowed into the narrow left track and its rows overflowed the cell. It's now a proper floating bottom-left panel, wide enough to enclose every ✕, sitting above the rails.
- **Report editor — rail alignment.** The left and right rails hung a status-bar-height below the center document workspace. They now line up with it — a shared CSS variable reserves the status-bar height so the rail bottoms and the document bottom stay in lockstep.
- **PDF Signer — empty state.** The big blank grey area before you open a PDF now shows a PDF-and-pen illustration instead of an empty void. It's decorative (hidden from screen readers) and disappears the moment a PDF is loaded.

## Verification

- CSS overlap and alignment are invisible to JSDOM, so both report-editor fixes were verified with a **headless computed-style + screenshot pass** against the real stylesheet (measured rail-vs-document overshoot went 19px → 0; the ✕ buttons measured inside the popup frame). The PDF Signer empty-state composition was screenshot-checked against the requested layout, plus a new render test asserts the illustration shows only until a PDF is open.
- **3,691 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs. No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.54.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `ed4dbb76ed1ad701052ddecbd7d999de7bb2f2abcf127cc459c0478d8dc9d4f9`
- **Size:** 963,135,479 bytes (~963 MB).

*Everything from v3.53.0 and earlier carries forward.*
