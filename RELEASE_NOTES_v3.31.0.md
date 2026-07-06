# Ghost Intel 98 — v3.31.0

**Five features from GhostExodus's field requests, now in an installer: pick your web-search engine, click links in Q's answers, a rebuilt X-session credential model, out-of-box voice input, and a per-case investigation cockpit.** Everything here has been on `main` since v3.30.3; this is the build that puts it in your hands.

## What's new

- **Multi-engine web search.** A Firefox-style engine picker sits in Q's chat toolbar: choose **DuckDuckGo** or **SearXNG** and that engine drives the `[SEARCH:]` loop. Both run **onion-to-onion over Tor** — IP-hidden, no exit node, `.onion`-enforced and fail-closed. SearXNG is a metasearch that aggregates Google/Bing/etc. **server-side**, so you get broad coverage with **zero clearnet exposure**. The candidate clearnet engines (Google/Bing/Yandex/Yahoo) were **dropped after real-fixture testing on a Tor box** proved every one captcha-walls scraping — SearXNG is how their coverage reaches you safely instead. Untrusted results still pass the same per-request injection fence as before (now hardened against Unicode line-separator smuggling).

- **Clickable links in Q's replies.** URLs and markdown links in the assistant's answers render as clickable and open via a safe **external** path (never in-app navigation), gated behind a **one-time real-IP-exposure acknowledgement**. An adversarial review caught and fixed a **middle-click bypass** of that consent before merge. Hostile URL schemes render as inert text.

- **X/Twitter collector session refinement.** The credential model is rebuilt around **atomic `auth_token`+`ct0` sessions** — no more accidentally mixing a token from one login with a `ct0` from another. A single clearnet gate with a durable first-time consent modal replaces the old double toggle, a **"Test session"** button catches an expired/invalid cookie *before* a harvest fails, and the collector picks a session by label. Secrets stay keyring-only; the session metadata store holds only non-secret labels/status. (Adversarial review caught a migration that would have made existing X accounts vanish — fixed before merge.)

- **Voice input works out of the box.** Talk-to-Q's offline speech-to-text now ships with the bundled Apache-2.0 **Vosk** model (`vosk-model-small-en-us-0.15`) — no more "voice input needs a Vosk model in `resources/vosk/`". Recognition runs **fully on-device**. The model is OS-independent data, so it's already wired for future Linux/macOS builds. Fetched at build time, SHA-pinned and fail-closed, with an `afterPack` guard that fails the build if the model isn't in the package.

- **A per-case investigation cockpit.** Open a case → **"Open investigation…"** → a per-case workspace: an **entity graph** you build and add to (persons/emails/domains/IPs/…), beside an **INTELREPORT** generator with PDF export. The automated-transform *run* engine shows a calm "reasoning pack unavailable" state in this build — it arrives with a forthcoming private reasoning pack; the graph and report work today.

## Under the hood

- Built subagent-driven, each feature on its own branch with a **parallel adversarial whole-branch review** that caught real criticals before merge — a build-target wiring gap (`package:linux`), a tar non-determinism bug, the X credential-loss migration, and the clickable-link deanon vector.
- A **pre-ship reachability audit** caught and fixed a cockpit launcher gap that would otherwise have shipped the investigator opening into an "Invalid caseId" error state; opened from a case it now works, and opened without one it shows an actionable hint.
- **3,026 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- **No new network egress** beyond the existing opt-in paths; no telemetry.

## Verified & not-yet-verified

- CI proves the bundled Vosk archive conforms to `vosk-browser`'s documented model format; the **live microphone → transcription** path is confirmed only in the shipped app on a real Windows box with a mic (headless CI can't run the WASM speech worker).
- Known limitation: the SearXNG instance is the bundled default onion; a Settings-UI editor to point it at your own SearXNG instance is a fast-follow (the value is editable in the settings file today).

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.31.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `552bd5aaf0785e7b51247102a23ea75f01fc32ab0b4cc6508f45256df55fde3c`
- **Size:** 958,364,056 bytes (~958 MB).

*Everything from v3.30.3 (the GhostExodus field-fix batch) carries forward.*
