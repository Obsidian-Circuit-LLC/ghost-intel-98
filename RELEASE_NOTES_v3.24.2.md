# Ghost Intel 98 — v3.24.2

**Hotfix: the SOCMINT collectors actually collect now.**

Two social-media intelligence features looked ready but were broken at the seam between the screen and the engine. The X/Twitter account you logged in wasn't being used, and the Telegram/WhatsApp **Start Monitor** button did nothing. Both are fixed. **The detection and Searchlight features were not affected.**

## What was wrong

Both bugs had the same shape: the main process already accepted the right inputs, but the screen never sent them — so each side looked complete on its own and the gap only showed up when you actually tried to collect.

- **X / Twitter — your logged-in account was ignored.** The Collect screen sent the case, mode, and query but never said *which stored account* to use. The collector only attaches your saved `auth_token`/`ct0` cookie when an account is named, so every harvest ran logged-out — which X answers with near-zero results and instant rate-limiting. Pasting your cookie in Settings did nothing because nothing pointed a harvest at it.
- **Telegram / WhatsApp — Start Monitor was a dead button.** The screen asked to start monitoring with only the case ID — no burner identity, no channel list, no platform. The monitor engine requires all three, so it refused immediately, and the screen quietly logged the refusal and showed nothing. Clicking the button appeared to do nothing at all.

## The fix

- **X collection now uses your account.** The Collect screen lists your stored accounts (IDs only — credentials never leave the main process), lets you pick one, and sends it with the harvest. Collection is now blocked until an account is chosen, with a clear pointer to add one in Settings — so you can't accidentally launch a logged-out harvest that's guaranteed to return nothing.
- **Start Monitor now starts monitoring.** The screen sends the full request — burner identity, the monitored channels for the case, and the selected platform — and a new **Burner ID** field lets you name the burner you configured in Settings (Telegram) or WA Setup (WhatsApp). If a run can't start (no channels reachable, network disabled, or any other reason), the screen now tells you why instead of silently doing nothing.
- **The request-building logic for both flows is now in small, pure, unit-tested modules** — the exact lines that broke are locked by regression tests that fail if either request ever drops a required field again.

No change to the egress model: X collection still requires both the network-enable and clearnet-acknowledge confirmations; Telegram/WhatsApp still run through the chosen transport (Tor or direct) and still fail closed if Tor is selected but unavailable. The fixes only complete requests that the safety gates already guard — they tighten the screen-side checks, they don't loosen anything.

## Quality

- **2,224 automated tests** passing (29 new: the X collect-request and SOCMINT start-monitor regression suites), TypeScript strict, clean `pnpm build`.
- No dependency, protocol, crypto, or network-egress change. Renderer wiring + tests only.

## Install

Windows NSIS installer attached.
SHA-256: `SHA_PLACEHOLDER`
Size: SIZE_PLACEHOLDER bytes
