# Ghost Intel 98 — v3.69.0

**Pixel-art banners across the workspace, a redesigned Shred, and a Journal Jots that finally writes like a journal — GhostExodus's field designs, built in.**

This release lands GhostExodus's UI batch: full-width pixel-art banner headers on six modules, a redesigned Shred with its "SHRED IT" panel, a relaid-out Journal Jots unlock screen, and — the big one — a Journal Jots that now takes rich text, photos, and clickable links instead of a plain text box.

## What's new

- **Banner headers** on **Q**, **Briefcase**, **Mail**, **Settings**, **Journal Jots**, and **Shred** — full-width art at the top of each window, uniform height, theme-aware chrome around it.
- **Shred, redesigned** — a SHRED banner plus a right-side **"SHRED IT"** panel (Delete it · Forget it · It never existed) and the standing reminder that **once it's shredded, it's gone for good**. The shredding itself — what it deletes and its guarantees — is exactly as before; this is the framing around it.
- **Journal Jots unlock, relaid out** — the PIN prompt sits up top-left beside the journal illustration, with the same honest note that the PIN is a *convenience gate, not the encryption key* (your entries are encrypted at rest by the vault regardless of the PIN).
- **Journal Jots rich editor** — write entries as blocks with **bold / italic / underline**, insert **photos you can upload and drag to resize**, and add **clickable hyperlinks**. Every existing plain-text entry keeps working and opens unchanged.

## Honesty & privacy (still offline-first, still no egress)

- **Journal photos are encrypted at rest** in a new journal-scoped asset store — the same vault encryption as your entries. An entry references a photo by an internal id; it never stores a remote URL that could beacon.
- **Rich text is sanitized** on the way in *and* on the way out (defense-in-depth), so nothing an entry contains — a tampered file, a pasted payload — can execute. Formatting and links only; no scripts, no event handlers.
- **Links open through the app's guarded opener** — http/https only, with the usual clearnet acknowledgement. No `javascript:`/`file:` links.
- **No new network egress, no telemetry, no new dependency.** The rich editor reuses the Reports module's existing sanitizer and photo machinery rather than adding anything.

## Under the hood

- The Journal entry model moved from a single text string to a **block list** (text + image blocks), reusing the Reports module's `TextBlock`/`ImageBlock` and its DOMPurify sanitizer. Legacy entries migrate to a single text block on read, HTML-escaped so old text is never re-interpreted as markup. Main-process validation is structural (it has no DOM) and gates every image reference against path traversal.
- Built subagent-driven across two plans (banners, then the editor) with parallel adversarial whole-branch reviews that caught and fixed real defects before merge — a memory-index data-loss regression, a legacy-entry size-cap that would have made large old entries unsavable, and a theme-token slip — none of which shipped.

## Verification

- **3,977 automated tests** passing (1 skipped); `pnpm typecheck` clean; the QUIET AMETHYST theme guard is green.
- **Recommended before field use:** an on-device smoke on Windows — apply a couple of banners, and in Journal Jots format some text, drop in and resize a photo, and click a link — to confirm the editor and photo store on your machine.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.69.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `50f75b98abe154689646a65570e93f93bad08d321e5421a84384bc11a629709b`
- **Size:** 944,270,891 bytes (~901 MB).

*Everything from v3.68.0 (the X + Telegram collectors) and earlier carries forward.*
