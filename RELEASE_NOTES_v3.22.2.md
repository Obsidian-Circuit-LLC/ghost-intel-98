# Ghost Intel 98 — v3.22.2

Two dogfooding gaps from the v3.22.0 SOCMINT activation, closed — plus the X collector window finally made launchable.

## Searchlight — Connect Tor

A Tor-mode sweep (the default — *Direct (clearnet)* unticked) used to report **"TOR NOT READY"** for **every** site whenever the bundled Tor hadn't been bootstrapped. Root cause: the bundled Tor is lazy and was only ever started by the **Chat** module; Searchlight read Tor's status but never started it. So unless you'd opened and connected Chat first, a Tor sweep could only fail.

Now, when you're in Tor mode with the network gate on and Tor isn't ready, Searchlight shows a clear notice with:
- a one-click **Connect Tor** button (shows *Starting Tor… (~30–60s)* while bootstrapping),
- a reminder that ticking **Direct (clearnet)** sweeps without Tor.

The **no-silent-clearnet invariant is unchanged** — Tor mode still fails closed (per-site `TOR_UNAVAILABLE`) when Tor is down; the button only lets you start Tor *explicitly*. The connector is idempotent (one shared in-flight bootstrap, no double-spawn) and reports `ready` only once Tor is actually bootstrapped.

## X / Twitter — the collector window is now launchable

The X collector was wired into IPC + Settings in v3.22.0 but its **window was never registered**, so there was no way to open it and run a search. It's now a launchable window (Start menu + desktop), kept **separate from the SOCMINT window by design**: X is a quarantined clearnet trust domain, and the import-graph sentinel test still forbids any code link between the X collector and the Tor/Telegram transports.

The **twscrape sidecar** is now bundled by the packager via `extraResources` (filtered to exclude the Python build venv/vendor caches) whenever a built binary is present.

## ⚠️ Honest platform note — X on Windows needs a Windows sidecar

The X collector runs a PyInstaller **twscrape sidecar**, which is **per-OS and cannot be cross-compiled**:
- The **Linux** sidecar is built and SHA-256-pinned and ships in a Linux build.
- **This Windows installer ships without an X sidecar** (it can't be built on a Linux host). The X window opens but reports **"X collector sidecar not installed"** until you build it on Windows:
  1. Run `scripts\build-twscrape-runner.bat` (verifies the twscrape supply chain, builds the onedir binary).
  2. Pin the printed SHA-256 into `win32` of `PINNED_SHA256` in `src/main/x/sidecar-client.ts`.
  3. Rebuild the installer.

The Searchlight Connect-Tor fix is fully effective on Windows today.

## Quality

- **1,979 tests passing**, TypeScript strict, clean `pnpm build`.
- Built subagent-driven over 4 tasks with per-task review and a parallel **adversarial whole-branch review** (correctness / charter-security / tests-build / spec-coverage → refute-by-default verification). The review caught a broken cross-file channel-contract test (the new IPC channels weren't added to its exact-set assertion) — fixed before merge — and confirmed the X quarantine and no-new-egress invariants intact.

## Install

Windows NSIS installer attached.
SHA-256: `98b317dc114bef9755570cb8a70a3202de8a4a71561e1611b53201c03b0cb122`
Size: 897,096,430 bytes (855.5 MB)
