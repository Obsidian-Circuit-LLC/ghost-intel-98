# Ghost Intel 98 — v3.19.0

**Searchlight: username-sweep OSINT, Tor-first.** A new top-level module that finds where a username
exists across the web — built for an OpSec-first platform, so the sweep is un-attributable by default
and your investigation never touches disk in the clear.

## What's new — Searchlight

Open **Searchlight** from the desktop, enter a username, and sweep it across a bundled **1,433-site
Maigret database**. Six tabs:

- **Sweep** — the engine. Results stream in live and are interpreted Maigret-aware (HTTP status code /
  page-text presence-absence strings / redirect heuristics), bucketed into **Found / Not found /
  Redirect / Blocked / Error**. Filter, text-search, and **export found results to CSV**. Import your
  own Maigret `data.json` to extend or replace the site list.
- **Dashboard** — case + sweep summary at a glance.
- **Graph** — an SVG relationship graph: drag / zoom / pan, connect and label nodes, and one-click
  **auto-import** the found profiles as nodes.
- **Whiteboard** — an infinite canvas: drag-drop images / text files and add colour-coded sticky notes.
- **Reports** — export a styled **HTML** report plus **CSV / JSON / TXT**, with a found-only filter and
  per-sweep selection.
- **Cases** — Searchlight's own investigation cases with `.gic` import / export.

## Tor-first egress (off by default)

- The sweep runs **through Tor by default** — 1,400+ time-correlated requests tied to one handle never
  leave from your real IP. A clearly-labelled per-sweep **"Direct (clearnet) — exposes your IP"**
  checkbox lets you fall back for sites that hard-block Tor exits.
- Both paths are gated behind a **new master network opt-in that is off by default**: with it off,
  Searchlight sends nothing. The whole sweep executes **in the main process**; the renderer makes **no
  network calls**.
- If the bundled Tor isn't bootstrapped yet, a Tor sweep returns a clean **"Tor not ready"** instead of
  a wall of connection errors — and it **never silently falls back to clearnet**. Anti-Tor **403/429**
  responses read as **Blocked**, never a false **Not found**.

## Security / architecture

- **Encrypted at rest:** cases, results, graph, whiteboard, and imported site lists persist through the
  vault (AES-256-GCM) — no plaintext on disk, no `localStorage`.
- **Untrusted input sanitised at the trust boundary:** imported `.gic` case files and Maigret
  `data.json` are validated/coerced before persist (array/type coercion, enum validation), and any
  `WhiteboardFile` whose embedded `dataUrl` isn't a `data:` payload is **dropped** (blocks
  `javascript:`-in-`<img>`).
- **XSS-hardened reports:** every field in the generated HTML report is escaped, links are
  scheme-guarded to `http(s)` with `rel="noopener noreferrer"`, and CSV cells are neutralised against
  spreadsheet formula injection.
- No untrusted regular expressions are compiled on the main thread. TLS verification stays on. CSP is
  unchanged (PDFs render as cards, not embedded `data:` frames).
- One new dependency (`react-rnd`, for whiteboard drag/resize). No telemetry, no phone-home.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.19.0.exe -Algorithm SHA256
```

SHA-256: `11f3a28e732dc2dbeae897d50e408517e53bf7aa4a9e33566e09c23a0c6adeb9`
Size: 878514847 bytes (837.8 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin)
and upgrades any prior `Ghost Intel 98` build in place.

## Notes

- Built subagent-driven over 12 TDD tasks with per-task review and a whole-branch review (which caught
  a Tor-readiness diagnostic gap and a local-DNS-on-Tor leak, both fixed). **1,317 automated tests**
  green, typecheck + build clean.
- Everything from v3.18.1 carries forward.
