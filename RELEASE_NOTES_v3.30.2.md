# Ghost Intel 98 — v3.30.2

**Three fixes from GhostExodus's field testing of v3.30.1: file references, web-search visibility, and the Mind's Eye label glitch.** Memory recall is working well now (v3.30.1's fix landed) — this cleans up the rough edges around it.

## What's fixed

- **Referencing a file no longer leaves you guessing.** When a case file can't be included in a chat — a binary/Office file (e.g. a `.docx`), a scanned/image PDF with no text layer, or a read error — Q now shows a **clear notice** naming the file and why ("`report.docx` — a binary or Office file; use ➕ Add to memory for DOCX/PDF"), instead of silently dropping it into a context line the model might not mention. The underlying file reading was already crash-safe; this makes the *skip* visible and actionable.
- **Web search tells you why it found nothing.** A zero-result search used to collapse every cause into the same silent "(0 results)". Q now distinguishes them: **"Tor isn't available — the bundled Tor connection couldn't start"**, **"could not reach DuckDuckGo over Tor — the onion was unreachable or the request was blocked/timed out"**, and **"Tor reached DuckDuckGo but there were no results"**. So a failed search points at its own cause. (Web search itself is working — verified against DuckDuckGo over both Tor and clearnet; a persistent zero is a local Tor-reachability issue, which this now surfaces.)
- **Mind's Eye no longer stacks labels into an unreadable blob.** In a dense cluster, every node's label was drawn on top of the others. The shared graph canvas now **declutters labels** — it keeps the non-overlapping ones, prioritizing larger/more-important nodes, and drops the colliders. Deterministic, and because the canvas is now shared, it also keeps the new investigation graph readable.

## Under the hood

- **2,684 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- No new network egress; no telemetry. The offline embedding runtime bundled in v3.30.1 is unchanged (the `afterPack` guard still verifies it ships).

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.30.2.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `58120522a0c03b7092eccb38b9c4f7624eaeab2af85f795f1594260682b68abe`
- **Size:** 917,681,157 bytes (~918 MB).

*Everything from v3.30.1 (the offline-memory runtime fix + web-search same-query guard) carries forward.*
