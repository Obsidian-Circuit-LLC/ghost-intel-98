# Confinement Trust-Boundary Fix (native-authoritative WFP policy) — Design

**Date:** 2026-06-21
**Surface:** Ghost Intel 98 core app (`/dcs98`) — offensive-engine WFP confinement (native Rust + TS protocol)
**Status:** Approved for planning

## Goal

Close the OPEN trust-boundary finding on `dcs98-confine`: the privileged native helper must **derive
the WFP firewall policy itself** from trusted scalars, instead of applying a filter list handed to it by
the (untrusted, plugin-reachable) TypeScript/main-process side. After this change, nothing the
renderer/plugin layer can influence can loosen confinement.

## Context (grounding facts)

- The native side currently trusts TS verbatim: `win-wfp.ts` calls `buildWfpFilterSpec(plan, sid)` and
  sends the whole `filters` array over the pipe; `service.rs` `ApplyScope { sid, filters, .. }` **drops**
  `proxy_port`/`allow_cidrs` (the `..`) and calls `wfp::apply(sid, filters)` which applies them verbatim.
- **The entire native FFI layer is `todo!()`** — `wfp::apply`/`remove`/`run_probe`, `service::run`/
  `accept_loop`/`pump_child`, all of `spawn.rs`, `install::install`/`uninstall`. So there is no live
  exploit today; this is a *scaffold*. The redesign makes the design sound **before** those todos are
  implemented on a Windows host.
- The pure pieces that compile + unit-test on any host (Linux): `wfp.rs` `Filter`/`Cond` types,
  `parse_cidr_v4`/`parse_cidr_v6`/`split_cidr`, `layer_guid`, `action_is_permit`, the `ScopeTable`;
  `pipe.rs` wire structs + frame codec; the TS frame codec + dispatch.
- The canonical policy (to port into Rust) is `win-wfp-spec.ts buildWfpFilterSpec`: base-deny V4+V6 on
  the engine SID (weight 5), loopback permit `127.0.0.1/32:proxyPort` (weight 10), one permit per scope
  CIDR (weight 10), IMDS-deny V4+V6 (weight 15, top). Pinned `PROVIDER_GUID`/`SUBLAYER_GUID`; weights
  `IMDS_DENY=15 > SCOPE_PERMIT=10 > BASE_DENY=5`. **What it does NOT do:** reject a default-route
  (`0.0.0.0/0` / `::/0`) or an IMDS-covering CIDR in `allowCidrs`.
- Windows-only verification (cannot run on Linux): `scripts/gates/win-confinement-pktmon.ps1` +
  `assert-pktmon-confined.py` (the INV-C1 pktmon acceptance gate, incl. its `-Poisoned` must-fail mode).

## Scope boundary (explicit)

This delivers the **testable trust-boundary fix** (native deriver + protocol change + TS rewire +
Rust/TS tests) — runnable via `cargo test` + `pnpm test` here. It does **NOT** implement the Windows
FFI (`FwpmFilterAdd0` apply loop, pipe-server DACL, `CreateProcessAsUserW`, install/service) — those
stay `todo!()` and must be implemented + **pktmon-verified on a Windows host** in a follow-up. The
fix's value: when those todos are filled, the trust boundary is already correct. Confinement stays
**out of any release** until the Windows FFI is done + the pktmon gate (incl. poisoned mode) passes.

## Architecture

### 1. Native deriver — the single authority (pure Rust, testable)

New in `wfp.rs`: `derive_scope_filters(sid: &str, proxy_port: u16, allow_cidrs: &[String]) -> Result<Vec<Filter>>`.
Ports `buildWfpFilterSpec` into Rust **and hardens it**:
- **Validate `sid`** against `^S-\d-\d+(-\d+)*$` (reject otherwise) — the engine SID every condition pins to.
- **Validate `proxy_port != 0`** (u16 already bounds ≤65535).
- Emit the canonical set, all conditions pinned to `sid`:
  - base-deny V4 + V6 (weight `BASE_DENY`);
  - loopback permit `127.0.0.1/32 : proxy_port` V4 (weight `SCOPE_PERMIT`);
  - one permit per `allow_cidr` at its family layer (weight `SCOPE_PERMIT`);
  - IMDS-deny V4 (`169.254.169.254/32`) + V6 (`fd00:ec2::254/128`) (weight `IMDS_DENY`, top).
- **Reject each `allow_cidr` that** (a) doesn't parse as a valid V4/V6 CIDR (via `parse_cidr_v4/v6`),
  (b) is a default route (`/0`), or (c) **contains the IMDS address** (V4 containment via `(imds &
  mask) == (net & mask)`; V6 via first-`prefix`-bits compare). Reject → `Err`, so a permit can never
  widen to all or whitelist metadata. (The top-weight IMDS-deny already wins by arbitration; this makes
  it un-expressible too — defense in depth.)
- Family routing in Rust: a CIDR that `parse_cidr_v4` accepts → V4 layer, else `parse_cidr_v6` → V6,
  else error (replaces the TS `isIP` check).
- The pinned `PROVIDER_GUID`/`SUBLAYER_GUID`, the `WEIGHT` constants, and the IMDS constants **move to
  Rust** as the single source of truth (they must match `install.rs`'s persistent base-deny, which is
  also Rust — consolidating removes the prior TS↔Rust duplication).

### 2. `wfp::apply` becomes native-authoritative

Signature change: `apply(sid: &str, proxy_port: u16, allow_cidrs: &[String]) -> Result<String>`. Body:
`let filters = derive_scope_filters(sid, proxy_port, allow_cidrs)?;` then the existing (still `todo!()`)
`FwpmFilterAdd0` transaction loop over those **natively-derived** filters. Add a **fail-closed
precondition** `verify_base_deny_present()` (new `todo!()` FFI — queries the persistent base-deny by
`PROVIDER_GUID`) that `apply` calls before adding any permit; if the persistent base-deny is absent it
returns `Err` (no permits without their deny baseline). The grounded comment is updated accordingly.

### 3. Protocol — drop `filters` from the wire

`pipe.rs` `ControlRequest::ApplyScope` becomes `{ sid, proxy_port, allow_cidrs }` (remove `filters:
Vec<Filter>`). `service.rs` `ApplyScope` arm **consumes** all three (no `..` drop) and calls
`wfp::apply(&sid, proxy_port, &allow_cidrs)`. The TS mirror `win-pipe.ts ControlRequest` drops
`filters` from the `applyScope` variant.

### 4. TS stops being the authority

`win-wfp.ts` sends `{ op:'applyScope', proxyPort, allowCidrs, sid }` only (no `filters`); it no longer
imports or calls `buildWfpFilterSpec`. `win-wfp-spec.ts` is **deleted** (its job — deriving the filter
set — now lives in Rust). Any TS references to `PROVIDER_GUID`/`SUBLAYER_GUID`/`WEIGHT`/`WfpFilter`
are removed (verified by grep; nothing outside the deleted file + its test should import them). The
`ConfinementPlan` + `buildConfinementPlan` (CIDR validation, plan shape) are unchanged.

### 5. Encode the remaining Windows-FFI security requirements (deferred bodies, fixed contracts)

So the Windows implementer cannot regress the boundary:
- `service::accept_loop` — the DACL comment becomes a hard contract: the pipe SECURITY_ATTRIBUTES
  DACL admits **only** `{ LocalSystem, the install-time interactive owner SID }` (recorded as
  `engine.owner` by `install.rs` step 2); document the deny-all default.
- `spawn`/`service` Spawn arm — document that `cmd` MUST be constrained to the bundled engine binary
  path (not an arbitrary executable), with a `todo!()` `is_allowed_engine_cmd(cmd)` check noted at the
  Spawn dispatch.
These remain `todo!()` FFI/host work; this spec fixes their **contracts**, not their bodies.

## Data flow (after)

`win-wfp.ts` → pipe `{applyScope, sid, proxyPort, allowCidrs}` → `service.rs` consumes scalars →
`wfp::apply(sid, proxy_port, allow_cidrs)` → `derive_scope_filters` (the authority, validated) →
[Windows todo] `verify_base_deny_present()` then `FwpmFilterAdd0` loop. Nothing untrusted supplies a
filter.

## Error / edge handling

- Bad SID / port 0 / default-route CIDR / IMDS-covering CIDR / unparseable CIDR → `derive_scope_filters`
  returns `Err` → `apply` returns `Err` → `service` replies `ControlResponse::err` → TS `applyScope`
  fails → **no spawn** (the existing fail-closed: a failed applyScope never spawns).
- Persistent base-deny absent at runtime → `apply` fails closed (no permits added).

## Testing

- **Rust `cargo test` (runs on Linux)** — `derive_scope_filters`:
  - canonical set for a simple plan: base-deny V4+V6, loopback permit (with port + 127.0.0.1/32 +
    SID conditions), IMDS-deny V4+V6 present at the right weights; all conditions carry the engine SID.
  - V4 and V6 `allow_cidr` route to the correct layer; multiple permits preserved in order.
  - **reject** `0.0.0.0/0` and `::/0` (default route); **reject** an IMDS-covering CIDR
    (`169.254.169.254/32`, `169.254.0.0/16`, `fd00:ec2::/32`); **reject** a malformed CIDR; **reject**
    a bad SID; **reject** `proxy_port == 0`.
  - (Existing `parse_cidr`/`layer_guid`/`action_is_permit`/deserialize tests stay green.)
- **TS `pnpm test`** — `confinement-win-wfp.test.ts` updated: the `applyScope` payload no longer
  contains `filters` (asserts `{proxyPort, allowCidrs, sid}` only); fail-closed-no-spawn behavior
  unchanged. `confinement-wfp-spec.test.ts` is **deleted** (the spec it tested moved to Rust).
- `pnpm typecheck` + `cargo check` clean. (The Windows FFI + pktmon gate are out of scope — verified
  later on a Windows host.)

## Charter / invariants

- Renderer/plugins are untrusted: the WFP policy is now derived **only** in the privileged native
  helper from `{sid, proxy_port, allow_cidrs}`; no filter list crosses the trust boundary.
- Fail-closed everywhere: invalid input → no filters → no spawn; missing base-deny → no permits.
- No new dependency, no network, no telemetry. The GUIDs/weights are pinned and consolidated in Rust.
- Core branch `fix/confinement-trust-boundary` → operator merges. Confinement remains **unreleased**
  until the Windows FFI is implemented and the pktmon gate (incl. poisoned-mode must-fail) passes on a
  Windows host.

## Out of scope

- Implementing the Windows FFI bodies (`FwpmFilterAdd0` loop, pipe DACL, `CreateProcessAsUserW`,
  install/service) — separate Windows-host work. The pktmon acceptance gate. Any release of the
  offensive engine.
