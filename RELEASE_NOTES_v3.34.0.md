# Ghost Intel 98 — v3.34.0

**Field-feedback batch: file-type icons, drag-and-drop, notes into My Documents, a readable Investigation panel, a mirrored News feed, and a Windows Media Player–style Jukebox.**

Six improvements from live OSINT casework, all in one release.

## What's new

- **Per-file-type icons in My Documents.** Files no longer all share one generic page glyph. Text, documents, spreadsheets, data, images, audio, video, archives, and code each get their own hand-drawn Win98-style icon, with a neutral fallback for anything unrecognized.

- **Drag-and-drop in My Documents.**
  - Drag a file onto a folder tile to move it into that folder (no more cut-and-paste for a quick tidy).
  - Drag text notes **between My Documents and the Briefcase**, both directions — a Briefcase note dropped into My Documents lands as an encrypted `.txt`; a text file dropped onto the Briefcase becomes a note. (Binary files are declined with a notice rather than mangled.)

- **Save a note straight into My Documents.** Notepad 98's save-target dropdown now lists **📂 My Documents** alongside the Briefcase and your cases. Re-saving the same open note updates it in place. Notes are encrypted at rest just like everything else in the store.

- **The Investigation window is readable again.** The autonomous-investigation cockpit (My Cases → Open investigation) had an unstyled side panel — black text on a near-black background. It now has a proper Win98-grey control panel, so the Run/Report tabs, the seed controls, and the "reasoning pack" notice all read clearly. The graph canvas stays dark. (For the record: it *is* a Maltego-style tool — seed an entity, pivot outward across transforms; the fully-autonomous fan-out needs the bundled reasoning pack.)

- **The News tool now mirrors GeoINT's Live News.** The standalone News window (OSINT Toolkit → News) no longer defaults to Bloomberg-only. It shares GeoINT's saved live-news feeds: pick any saved stream from the dropdown, or add a new one — and feeds added in either place show up in both. One feed list, two windows.

- **Jukebox: a Windows Media Player re-skin.** The compact deck is restyled as a classic media player — a bordered screen with the spectrum visualizer, a transport row (rewind / play / pause / stop / fast-forward), and the Ghost Intel 98 logo tucked in the bottom-right corner. It opens smaller by default; the expand caret still reveals the track info and library/stations.

## Under the hood

- Two new encrypt-at-rest IPC channels (`documents:writeText` / `documents:readText`) carry note content in and out of the store through secure-fs with path-confinement; oversize bodies are rejected at the boundary rather than silently truncated. New rewind/fast-forward seek uses a clamped pure helper.
- The News feed list is a single shared component backed by the existing `geoint.newsStreams` setting — no duplicate store, no migration.
- **3,165 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs. No new network egress; encrypt-at-rest unchanged.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.34.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `3dd6246276be0b643f69e59248b990289410ed2d7f44d16cd94c82563c0bd851`
- **Size:** 958,379,658 bytes (~958 MB).

*Everything from v3.33.1 and earlier carries forward.*
