# dcs98-confine — Windows WFP-on-SID egress jail helper (Plan 05a T5/T6)

Privileged Windows helper for the offensive-engine egress confinement. One signed binary, modes by argv:
`install` / `uninstall` (elevated, once) · `service` (SCM, LocalSystem) · `status` (probe) · `probe`
(INV-C1 gate worker). See `src/main.rs`.

The security-critical **allow/deny policy is decided in the unit-tested TypeScript**
(`src/main/offensive/confinement/win-wfp-spec.ts`) and shipped here as JSON. This binary is a careful
*applier* of that JSON — it never invents policy. The pinned WFP GUIDs here MUST equal
`win-wfp-spec.ts` (`PROVIDER_GUID 3f1820f3-…`, `SUBLAYER_GUID 88845872-…`).

## Status: SCAFFOLD — built/verified on the Windows host, NOT on the Linux dev box

This crate targets an OS the dev box can't execute. What is **done and inspectable on any host**:
the pipe frame codec + control-message model (`pipe.rs`, with `cargo test`), the WFP JSON model + CIDR
parsers (`wfp.rs`, with `cargo test`), the control-dispatch loop (`service.rs::serve_connection` /
`handle_request`), and the `status` probe (`install.rs`). The unsafe Win32/WFP/SCM bodies are `todo!()`
carrying the **exact call sequence** (grounded in `research-wiki/prior-art/offensive-engine-egress-
confinement.md`); they are filled on the Windows host where the compiler + `cargo doc` confirm the
`windows`-crate signatures. Every such spot is marked `HOST-CONFIRM` / `HOST:`. This is the honest
build boundary, not a placeholder pretending to be complete.

## Build (Windows host)

```
rustup target add x86_64-pc-windows-msvc            # new build prereq (operator-approved 2026-06-18)
cargo test                                          # the pure model/codec/parser tests
cargo build --release --target x86_64-pc-windows-msvc
cargo clippy --target x86_64-pc-windows-msvc -- -D warnings
```

Fill each `todo!()`/`HOST:` body against the documented sequence; iterate until `cargo build`/`clippy`
are clean. Then run the acceptance gate (below).

## Acceptance gate (the load-bearing Windows verification — go/no-go for any 05c offensive code)

```
dcs98-confine.exe install                           # elevated, once
powershell scripts\gates\win-confinement-pktmon.ps1 -ProxyPort 54321 -AllowCidr 203.0.113.0/24
powershell scripts\gates\win-confinement-pktmon.ps1 -Poisoned   # MUST fail (proves the gate isn't vacuous)
```

The gate asserts INV-C1: every egress packet for the engine user goes only to
`{127.0.0.1:proxyPort} ∪ scope-CIDRs`; zero DNS (UDP:53) / DoT (TCP:853); nothing to 8.8.8.8 or the IMDS
`169.254.169.254`. Same allow-set the Linux netns gate already proves.

## Two release gates NOT yet applied (deliberately — they would break the current Linux release path)

1. **`package.json build.extraResources`** — add, ONLY on the Windows build host (the binary doesn't exist
   on the Linux packaging box, and electron-builder errors on a missing `from`):
   ```jsonc
   { "from": "native/dcs98-confine/target/x86_64-pc-windows-msvc/release/dcs98-confine.exe",
     "to": "confine/dcs98-confine.exe" }
   ```
   `enable-setup.ts` resolves the helper at `resourcesPath/confine/dcs98-confine.exe`.
2. **Authenticode-sign `dcs98-confine.exe`.** An unsigned SYSTEM service that adds WFP rules is an
   unacceptable smell — this is the one binary that must be signed before a real offensive release, a
   release gate alongside the offline-release-key swap (`core trust.ts`). Do NOT flip `nsis.perMachine`
   — the main installer stays per-user/no-UAC; only the explicit "Enable offensive engine" setup elevates.

Confinement-first invariant: **no 05c / deep-eye offensive code lands until the pktmon gate above is green
on a real Windows 11 host** (and its `-Poisoned` run fails).
