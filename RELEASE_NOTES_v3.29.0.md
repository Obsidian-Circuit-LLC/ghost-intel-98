# Ghost Intel 98 — v3.29.0

**Meet "Q": the assistant gets a name, a one-tap voice, and Tor-routed web search.**

Three items from GhostExodus's field feedback, all scoped to the AI assistant. The assistant is now **Q** (à la 007). Voice is a **single latching push-to-talk toggle** — tap once to talk hands-free, tap again to stop. And Q can now **search the web over Tor**, onion-to-onion, when you let it.

## What's new

- **The assistant is now "Q".** The window title, Help, Welcome, and Settings all name the assistant Q, and the default system prompt introduces it as Q. Internal keys and the chat schema are unchanged — this is a branding pass, not a behavior change.
- **One-tap voice.** The old two-button (Hands-free / Push-to-talk) + Stop voice bar collapses into a single latching toggle: **🎤 Talk to Q** starts a hands-free conversation (mic stays open; Q listens, answers, and speaks while you read); **🔴 Listening — tap to stop** ends it. The Vosk speech-to-text + Piper turn-taking engine is unchanged under the hood. (Voice *input* still requires the operator-supplied Vosk model in `resources/vosk/`; without it, only speak-aloud works.)
- **Tor-routed web search (off by default).** Enable "Let Q search the web over Tor" in Settings and Q can emit a `[SEARCH: query]` directive; the main process runs the search over the bundled Tor SOCKS to **DuckDuckGo's onion service** (onion-to-onion — no exit node, no clearnet, no API key), feeds the results back, and Q answers citing sources. A hybrid directive loop is used instead of model-native tool-calling so it works reliably with the local abliterated model. Bounded to 3 searches per turn.

## Security / charter

- **Onion-to-onion, enforced.** Web search egress goes only through `torFetch` to a `.onion` host; the endpoint is `.onion`-checked and **fails closed** (no results) on anything else, so a clearnet host can never route through a Tor exit node. A blocked/non-200 fetch yields no results — never a clearnet fallback.
- **Search results are untrusted.** Any page can rank itself into results, so results are wrapped in an **unforgeable per-request fence** (random token), fence-scrubbed, newline-stripped, and URL-sanitized before Q ever sees them, with an explicit "untrusted DATA, not instructions" preamble. These defenses close a prompt-injection surface a **red-team pass** found and verified before merge (un-neutralized URL line, a prose-only block boundary, and a missing `.onion` guard — all fixed).
- **No new clearnet egress, no telemetry.** The only new outbound path is the DDG onion over the existing bundled Tor.
- **2,595 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.

## Verify before trusting

The DuckDuckGo onion address is pinned as a constant and must be verified against DuckDuckGo's official published v3 onion before you rely on it; if it is ever wrong, search fails closed (returns nothing) — there is no leak.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.29.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `PENDING_BUILD`
- **Size:** PENDING_BUILD

*Everything from v3.28.0 (global scalable memory + Mind's Eye) carries forward.*
