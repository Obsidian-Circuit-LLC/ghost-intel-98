# Ghost Intel 98 — v3.27.0

**Seven items from GhostExodus's field feedback: crash-safety, a Tor-hang fix, a scraper credential-race fix, per-tool scraping cases with migration, OSINT consolidation, an installer cleanup opt-in, and a Searchlight graph reset.**

Built subagent-driven — each workstream on its own branch with a parallel adversarial whole-branch review (refute-by-default verification) before merge. That review caught and fixed real defects the per-task reviews and the green test suite missed: a cache-poisoning regression, X credentials left resident in memory, an off-screen Access-menu flyout, an installer data-loss on Back/Next, and — the one this release most needed to get right — a **migration duplication-on-crash critical**. It also flagged a "critical" that ground-truth compilation refuted, and surfaced a real two-pass installer build break; both were run down against the actual toolchain rather than taken on faith.

## What's new

- **Crash-safety (W1).** A module error boundary means no single tool can white-screen the whole app again — a failed tool now renders a contained panel with a real "Close window." Host Info, News, and Camera (previously pop-out-only) now open **standalone** from the Toolkit instead of crashing on a missing stream.
- **CCTV host-resolution (W2).** The Host-resolution panel no longer hangs on Tor bootstrap — it **fast-fails** to a clear "Tor not ready" state and warms Tor in the background. A new explicit **"Resolve camera hosts over Tor"** setting (default on) turns resolution off entirely when you want; resolution stays **Tor-only** and never falls back to clearnet, so a camera lookup can't leak your real IP.
- **GhostScrape credential isolation (W3).** Each scrape job now runs in its **own ephemeral session partition**, so two concurrent jobs can no longer clobber each other's X credentials; a failed capture is surfaced honestly instead of reported as an empty success. Injected credentials are cleared from the session on job completion.
- **Independent scraping cases + migration (W4).** SOCMINT and X/GhostScrape now have their **own encrypted case stores** with a left-hand Cases sidebar (Add / Open / Delete), fully separate from your investigation cases. Existing harvested data is relocated by a **one-time migration** that is **backed up byte-for-byte before anything is removed, idempotent on crash** (a retry overwrites, never duplicates), and reversible. An **"Import into a main case"** action copies a scraping case's results across when you want them in an investigation.
- **OSINT consolidation (W5).** The OSINT tools move off the desktop into the Toolkit and a **one-hop Access-menu flyout** (grouped Social Media / Geospatial / Identity / Network-Recon); the Toolkit window is compact.
- **Installer cleanup opt-in (W6).** A **default-off** installer checkbox to remove a previous installation's `%APPDATA%` data. Opt-in every time; existence-guarded; scoped strictly to the app's own data dirs; never touches the install directory.
- **Searchlight graph reset (W7).** Reset the entire relationship graph (with a confirm) and re-import from sweep results.

## Quality / QA

- **2,535 automated tests** passing; TypeScript strict (`pnpm typecheck` clean); clean `pnpm build`; Windows installer builds clean (both makensis passes, warnings-as-errors).
- **Pre-ship reachability audit** (machine-verified): every module registered; every OSINT tool reachable via the Toolkit and the flyout; no OSINT tool left as an orphaned desktop icon.
- **Packaged-artifact integrity check**: all seven workstreams confirmed present in the shipped `app.asar`.
- **Runtime smoke** is a human pass this release — a per-tool checklist ships in `docs/guides/v3.27.0-windows-smoke-checklist.md`. (The automated Windows-VM UI smoke is still pending a Win11 ISO on the build host.)
- **No new egress, no telemetry, no dependency/protocol/crypto change.** Host-resolution stays Tor-only; the X clearnet quarantine is intact; all scraping-case data is encrypted at rest.

## Migration note (read once)

On first launch of v3.27.0, existing SOCMINT/X harvested items and jobs are moved out of your investigation case dirs into the new scraping stores (`scraping-cases/socmint/…` and `scraping-cases/x/…`, split by platform). The raw originals are copied byte-for-byte into `scraping-cases/backup-pre-v3.27.0/<caseId>/` **before** they are removed — that folder is your recovery path if anything looks off. The migration runs once (marker-guarded) and is a permanent no-op afterward.

## Install

Windows NSIS installer attached.
SHA-256: `539328999962dc05f11373cc882a55d5e86d2aa1da3803a1ce0b6ac77207761b`
Size: 906,342,326 bytes (~864 MiB)

*Everything from v3.26.0 carries forward.*
