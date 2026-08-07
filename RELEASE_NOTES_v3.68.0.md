# Ghost Intel 98 — v3.68.0

**New X and Telegram collectors — GhostExodus's Listening Station tooling, ported in, hardened, and anonymity-preserving.**

This release replaces the social-media collection engines wholesale. GhostExodus's field-built **X Listening Station** and **Telegram Hunter** are ported into Ghost Intel 98 — rebuilt onto a shared hardened capture core, encrypted at rest, and (for Telegram) routed fail-closed over Tor. WhatsApp monitoring is unchanged.

## What's new

- **X Listening Station** — a new module that captures a signed-in **X** session in a dedicated hardened window: visible posts, replies, reposts, third-party comments, follower/following network extraction, analyst notes, and low-rate archive cycles. It replaces the old X collector *and* GhostScrape, and retires the whole external `twscrape` sidecar (no more separate Windows binary). X stays a **clearnet quarantine** — a separate trust domain, never linked to Tor or Telegram.
- **Telegram Hunter (inside SOCMINT)** — the Telegram engine is now an authenticated **Telegram Web** session in a hardened window, **routed fail-closed over Tor**: message capture, group/channel member intelligence, visible profile fields, keyword watch, and Telegram-Desktop JSON import — all landing in your encrypted case store. WhatsApp is untouched.

## Honesty & privacy (this is an offline-first, Tor-aware OSINT tool)

- **Visible-capture only.** Both collectors read only what your signed-in account can already see. They never bypass privacy controls, never solve or work around a verification/rate-limit challenge (they stop), never recover deleted content, and record Telegram's unavailable account-creation date as **unavailable — never a guess**. A display name is never fabricated from a handle; engagement counts keep their approximate character.
- **Telegram is Tor fail-closed.** The Telegram session is proxied through the bundled Tor before the page loads, with WebRTC UDP locked to kill the classic IP-leak path, and capture will not start unless Tor is bootstrapped — **no clearnet fallback**. X remains deliberately clearnet-quarantined.
- **Encrypted at rest**, captured media is stored as **local thumbnails** (never a remote URL that could beacon), CSV exports are formula-injection-guarded, and imports are path-traversal-confined.
- **No new network egress** beyond the capture targets (X clearnet; Telegram over Tor), **no telemetry**, and one *fewer* dependency (`@mtcute/node` dropped).

## Under the hood

- A shared main-process **hardened capture window** (context-isolated, sandboxed, sender-checked IPC, deny-by-default navigation) that both collectors ride; captured items normalize into the existing encrypted `HarvestedItem` case pipeline, with per-tool encrypted stores for notes/networks/keyword-watch/imports.
- Built subagent-driven across two plans (X, then Telegram) with parallel adversarial whole-branch reviews that caught and fixed real defects before merge — a path-traversal, a Tor WebRTC-timing invariant, capture-reachability gaps — none of which shipped.

## Verification

- **3,952 automated tests** passing (1 skipped); `pnpm typecheck` clean.
- **Recommended before field use:** an on-device smoke on Windows — sign into X and capture, sign into Telegram *over Tor* and capture — to confirm live auth and the Tor path on your machine.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.68.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `969626f422c8c2577ee3e743a9bf3b3a2cccee3aee43847b030aa8bc012d8f52`
- **Size:** 940,546,319 bytes (~897 MB).

*Everything from v3.67.0 (the QUIET AMETHYST theme) and earlier carries forward.*
