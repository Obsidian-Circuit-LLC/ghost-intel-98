# Ghost Intel 98 — v3.24.1

**Hotfix: Searchlight username sweeps work again after upgrading.**

If you upgraded from a build older than v3.23.0, launching a username sweep did nothing — the results panel stayed on "No sweep yet" and the action felt unresponsive — and the **Learning** tab was dead. This release fixes that. **Fresh v3.24.0 installs were not affected.**

## What was wrong

The app keeps your settings forward-compatible by **deep-merging** each nested settings block against the current defaults every time it reads `settings.json` — so a block saved by an older build still gains any sub-fields added since. The `searchlight` block was **missing from that merge list**. As a result, a `settings.json` carried forward from before v3.23.0 (which predates the `scorer` detection config) **replaced** the default `searchlight` block wholesale, leaving `searchlight.scorer` undefined.

The sweep's main-process handler reads `scorer.foundThreshold` when you hit **Launch Sweep**, so it threw immediately, the launch aborted before any job started, and the UI never moved off its empty state. The same missing `scorer.useMl` broke the Learning tab. Because a *fresh* install always writes and reads the full defaults, the automated suite and manual smoke tests — all run on fresh profiles — never exercised the upgrade path that triggers it.

## The fix

- **Restored the deep-merge for `searchlight`** (including its nested `scorer` block) in the settings merge, matching how every other nested settings block is already handled.
- **Audited the whole class:** `chat`, `offensive`, and `x` had the same latent gap (a new default sub-field would be lost on upgrade) and are now deep-merged too. (`plugins` is a dynamic map and is correctly left as a wholesale replace.)
- **Defense-in-depth:** the sweep handler now falls back to the canonical default scorer if one is ever missing, so a malformed or partially-migrated settings object can never again hard-break detection.
- **Regression test** added that reproduces the failure (it fails before the fix) and locks the entire class of nested-settings blocks against recurrence.

Your existing settings **heal transparently on next launch** — no reinstall, no reconfiguration, no lost data.

## Quality

- **2,193 automated tests** passing (the 3 new merge regression tests included), TypeScript strict, clean `pnpm build`.
- No dependency, protocol, crypto, or network-egress change. One main-process logic fix plus a test.

## Install

Windows NSIS installer attached.
SHA-256: `<filled at publish>`
