# Ghost Intel 98 — v3.55.0

**Bookmarks: retire the vestigial per-card `height` field (data hygiene).**

A small hardening, no visible change. GhostExodus flagged full-height Bookmark category cards and a full-height "Add link" popup. Those were both fixed long ago — the manual per-card resize was removed in **v3.14.0-beta.7**, so cards **auto-fit their links** and the Add-link dialog is a **compact centered modal**. (If you still see the full-height versions, you're on a build older than v3.14 — updating resolves it.)

What lingered was the *data*: the board validator still round-tripped a stored per-card `height`, so a board created by an old build kept that field forever. Harmless — the renderer ignores it — but a smell, and a stored height should never be able to resurface a full-height card.

## What changed

- `ensureBookmarkBoard` now **drops** any per-card `height` instead of carrying it. Both the `get` and `save` IPC handlers run through this validator, so a stored board **self-heals on first load** and **rewrites clean on first save** — no migration step, no user action.
- The `height?` field is removed from the `BookmarkCategory` type. Tests that previously asserted the carry now assert the retirement.
- **No visible change** — the compact dialog and auto-fit cards have shipped since v3.14; this only cleans the persisted data.

## Verification

- **3,691 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- The current Bookmarks rendering was confirmed with a headless computed-style pass: category cards measure to their content (e.g. 155/103/129px for 3/1/2 links) and the Add-link dialog is a compact ~187px box centered in the viewport.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.55.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `d93eeb33fec7210af26a11570a3b5fe9f13e53fef9f0c0d893aaf44589819a13`
- **Size:** 963,132,867 bytes (~963 MB).

*Everything from v3.54.0 and earlier carries forward.*
