# Ghost Intel 98 — v3.70.0

**A new X Listening Station, module banners that hold their form, and a boot screen you can make your own.**

This release bundles three of GhostExodus's field requests: a wholesale replacement of the X collector with the **X Listening Station Enterprise** feature set (rebuilt onto Ghost Intel 98's hardened core), pixel-art **banner headers** across the workspace, and a **custom boot-screen** picker.

## What's new

- **X Listening Station Enterprise** — the X collector is replaced by a full SOCMINT/OSINT workstation: authenticated **timeline capture** (posts/replies/reposts/comments), **historical archive** cycles, **follower/following network mapping** with common-connection analysis, **entity indicators**, **evidence hashing**, analyst **notes** and highlight **presets**, and **JSON/CSV/PDF exports**. It manages its **own campaigns** — so it no longer needs a case bound to it; open it and go.
- **Module banners** — full-width pixel-art headers on **Q, Briefcase, Mail, Settings, Journal Jots, and Shred**, with a colour-matched ambient bleed so they hold their form (no stretch or pixelation) at any window size, including maximized.
- **Custom boot screen** — **Settings → Theme → Boot screen image: Choose… / Clear** sets your own boot/login-screen image (mirrors the desktop-background picker); it falls back to the bundled art when cleared.
- **Journal Jots login** — the PIN prompt and book illustration now sit in line, no scrollbar.

## Anonymity, honesty & privacy

- **X is now Tor-by-default.** Capture routes through the app's bundled Tor, **fail-closed** — no request fires until a Tor exit is verified, with WebRTC-UDP locked. You can opt into **clearnet** per campaign, but only behind a **one-time real-IP acknowledgement**, with a persistent "clearnet — real IP exposed" marker. (There is no second bundled Tor engine; it uses the same Tor as the rest of the app.)
- **Encrypted at rest.** Every captured artifact — posts, networks, notes, presets, archive state, and cached media — is stored AES-GCM-encrypted through the app vault. Captured media is fetched host-allowlisted and stored as **local bytes**, never a remote URL that could beacon.
- **Honest by design.** Auth cookies are never read, logged, or transmitted (presence-checked only); capture is visible-DOM screen-scrape (no token replay); a verification/rate-limit challenge **stops** the capture; engagement counts keep their raw form (no invented precision); and **demo data is marked synthetic and excluded from analysis, exports, and evidence hashes** so it can never masquerade as real intelligence. Exports are formula-injection-guarded, HTML-escaped, and carry a SHA-256 sidecar; you choose the save location.
- **No new network egress** beyond the X capture target, **no telemetry**, **no new dependency**.

## Under the hood

- The Enterprise tool was **rebuilt onto Ghost Intel 98's hardened seams** — the shared context-isolated/sandboxed capture window, the host-anchored media fetch, the formula-safe CSV writer, the sender-checked IPC layer, and the encrypted store — rather than grafted in. Its plaintext state file, bundled Tor binary, and standalone shell were deliberately **not** ported.
- Built subagent-driven across three staged phases (foundation → features → renderer), each with a parallel adversarial whole-branch review that caught and fixed real defects before merge — including a clearnet-capture bypass and a demo-data leak into a hashed export — none of which shipped.

## Verification

- **4,319 automated tests** passing (1 skipped); `pnpm typecheck` clean; the QUIET AMETHYST theme guards green.
- **Recommended before field use:** an on-device smoke on Windows — sign into X, run a Tor-default capture (and try the clearnet opt-in), pull a follower network and an archive cycle, and export — to confirm the live auth and Tor path on your machine.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.70.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `f2a9a2383cfb81d2f0bca882241ca62577fe4012205fa53d961ef13a982307ae`
- **Size:** 944,307,209 bytes (~901 MB).

*Everything from v3.69.0 (the GhostExodus banner/Journal-Jots batch) and earlier carries forward.*
