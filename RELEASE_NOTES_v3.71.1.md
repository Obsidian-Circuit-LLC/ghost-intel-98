# Ghost Intel 98 — v3.71.1

**Fix: "X is not connected for this campaign" when capturing, even while signed in.**

Capturing a timeline could fail with *"X is not connected for this campaign. Open the session and sign in before capturing."* even though the session read **X SESSION ONLINE / SESSION CONNECTED**.

## Why it happened

The session status is derived from the **persisted X login cookie**, which is shared across campaigns and survives restarts — so it can read "online." But capture required a **live capture window for that specific campaign**, which only existed after you clicked *Open Session* and was gone after a restart. Those two were decoupled, so a signed-in-but-no-window state showed "online" while capture threw. Signing out/in or removing the old build didn't change it, because it was the cookie-vs-window mismatch, not the login.

## The fix — one-click capture

**Capture Timeline now manages its own window.** If no capture window is open for the campaign, it opens one over **Tor** (fail-closed — no clearnet unless you've enabled the acknowledged clearnet opt-in), navigates it to the target profile, waits for the timeline to render, then captures. You type a username — **or paste the profile URL** (e.g. `https://x.com/ExodusGhost`) — and click once. No separate Open Session → navigate → capture dance.

- If Tor isn't ready, you get a clear Tor message (not the misleading "not connected").
- If the timeline is slow to render, capture reports **0 captured** honestly rather than erroring.
- Nothing about the hardening changed: the window is Tor-gated, the profile URL is built only from a validated handle, and no clearnet path opens without the real-IP acknowledgement.

## Note on the look

The X Listening Station wears the Enterprise console in both Ghost Intel 98 themes. For the **dark neon** look closest to the original, switch to the **QUIET AMETHYST** theme (Settings ▸ Appearance); the default (classic) theme is the lighter variant.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.71.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `05be4384ebb282dc46f172f4742c2a4d0f6a881228245358335f42c261b0f9b7`
- **Size:** 944,463,719 bytes (~901 MB).

Confirm **Settings ▸ About** reads **3.71.1**. Everything from v3.71.0 carries forward.
