# Ghost Intel 98 — v3.26.0

**Four features in one release: adaptive AI memory, a native X timeline scraper (GhostScrape), an OSINT Toolkit launcher, and free text-selection in the AI assistant.**

Built subagent-driven, each feature on its own branch with a parallel adversarial whole-branch review (refute-by-default verification) before merge — the review caught and fixed a charter-level memory-privacy critical and several correctness bugs that the per-task reviews missed.

## What's new

- **Adaptive Memory** — the AI assistant's local memory now goes **live, learns, and is fully inspectable**. It auto-reindexes on save (recall is no longer a manual snapshot); it distills durable facts into a **local, encrypted, self-updating profile**; and a new **Memory panel** shows what was recalled and lets you inspect, edit, pin, and **erase** every learned item (including the rolling summary). Off by default; loopback-Ollama only; nothing learned is silent or un-erasable.
- **GhostScrape** — a new native module that scrapes an X (Twitter) user's timeline (tweets / retweets / bio, with date filtering) by driving a **hidden, cookie-authenticated Electron browser** and capturing X's GraphQL. Reuses your existing X Intel session + the same clearnet gate, stays inside the X clearnet quarantine (no Tor/Telegram link, no new egress), exports JSON/TXT/CSV, and saves to a case. (Adapted from ZenScraper by 0Day3xpl0it, MIT — reimplemented on native Electron primitives.)
- **OSINT Toolkit** — a folder-style launcher that groups the OSINT tools by category → subcategory (Social Media · Geospatial · Identity · Network/Recon) as clickable tiles, giving the previously-scattered tools one home. Metadata-driven off the module registry; a desktop icon + Access-menu entry.
- **AI assistant free text selection** — you can now click-drag to highlight and copy any part of a message, and the right-click Copy menu is unchanged.

## Quality / QA

- **2,410 automated tests** passing; TypeScript strict (`pnpm typecheck` clean); clean `pnpm build`.
- **Pre-ship reachability audit** (machine-verified): every module is registered and every OSINT tool is tagged and reachable via the toolkit — no hidden or unreachable features.
- **Packaged-artifact integrity check**: all four features confirmed present in the shipped `app.asar` (nothing dropped from packaging).
- **Runtime smoke** is a human pass this release — a per-tool checklist ships in `docs/guides/v3.26.0-windows-smoke-checklist.md`. (A fully-automated Windows-VM UI smoke is planned for the next cycle; the build VM had been torn down.)
- No dependency, protocol, or crypto change. New egress: none beyond what each feature's existing gate already governs (Adaptive Memory = loopback Ollama only; GhostScrape = the hidden browser's own clearnet HTTPS to x.com under the existing X gate).

## Install

Windows NSIS installer attached.
SHA-256: `af248d03883d063624119e684af38261ff3eda2148ff4cc9945b3f3d48e0eb55`
Size: 906,335,471 bytes (~864 MiB)

*Everything from v3.25.0 carries forward.*
