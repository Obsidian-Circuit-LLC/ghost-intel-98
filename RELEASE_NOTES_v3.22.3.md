# Ghost Intel 98 — v3.22.3

**X / Twitter collection now works on Windows out of the box.**

v3.22.2 made the X collector window launchable but honestly shipped without the Windows `twscrape` sidecar — PyInstaller can't cross-compile, so the `.exe` had to be built on real Windows. That binary now exists, is verified, and is bundled.

## What changed

- The **Windows `twscrape-runner.exe` sidecar** (PyInstaller onedir + its `_internal` runtime) is now **built and bundled** in the installer. The X collector window no longer reports "sidecar not installed" on Windows — it has a working collector.
- The binary's **SHA-256 is pinned** in `src/main/x/sidecar-client.ts` (`win32`). The app's existing **verify-before-exec** gate computes the SHA of the shipped binary at launch and refuses to run it on any mismatch — so a tampered or swapped sidecar fails closed.
- Built on a **genuine Windows 11 environment** (not Wine, not cross-compiled), verified byte-for-byte against the build hash before pinning.

## Trust posture (unchanged)

- X stays a **quarantined clearnet trust domain**: its own window, no code link to the Tor/Telegram transports (import-graph sentinel test still enforces this).
- Egress is still **off by default** and double-gated: `settings.x.networkEnabled` **and** the clearnet acknowledgement.
- twscrape pinned to `0.19.1` (vladkens), supply chain reviewed per §5.7. The pinned-version source install was over PyPI/TLS; the integrity guarantee the app enforces is the **output binary SHA**.

## Honest scope

- **Not live-smoked against X** — building/bundling the sidecar is verified; actually scraping requires your own burner X cookies (Settings → X / Twitter). First real use is the smoke test.
- **macOS sidecar still pending** — it needs a macOS build host (same per-OS PyInstaller constraint). Linux + Windows sidecars now ship.

## Quality

- **1,979 tests passing**, TypeScript strict, clean `pnpm build`. Sidecar build + client tests (44) green; the win32 SHA pin verified against the extracted binary.

## Install

Windows NSIS installer attached.
SHA-256: `05f2a3484c07ad2eea6890b32c69e529bf08b222051d97e9ec473b3fc93973bd`
Size: 906,298,224 bytes (864.3 MB)
