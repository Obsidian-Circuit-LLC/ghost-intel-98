# Confinement Trust-Boundary Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native `dcs98-confine` helper derive the WFP policy itself from trusted scalars (sid, proxy_port, allow_cidrs); stop trusting a TS-supplied filter list. Closes the OPEN trust-boundary finding.

**Architecture:** New pure-Rust `derive_scope_filters` is the single authority (ports + hardens the old TS `buildWfpFilterSpec`). `wfp::apply` takes scalars and derives internally; the `filters` field is removed from the pipe protocol; the TS `buildWfpFilterSpec`/`win-wfp-spec.ts` is deleted. Windows FFI bodies stay `todo!()` (deferred to a Windows host) but their contracts are fixed.

**Tech Stack:** Rust (`native/dcs98-confine`, `cargo test`/`cargo check`), Electron main TS, vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-confinement-trust-boundary-design.md`

## Global Constraints

- The native deriver is the **single source of truth**; NO filter list crosses the trust boundary (renderer/plugins are untrusted).
- **Fail closed:** invalid sid / port 0 / default-route CIDR (`/0`) / IMDS-covering CIDR / unparseable CIDR → `Err` from `derive_scope_filters` → `apply` Err → applyScope fails → no spawn.
- Every emitted filter condition pins the engine SID; weights `IMDS_DENY(15) > SCOPE_PERMIT(10) > BASE_DENY(5)`; GUIDs/weights/IMDS constants live in **Rust** (single source; must match `install.rs`).
- No new Rust crate dependency (validate the SID manually — do NOT add `regex`). No new TS dependency.
- Windows FFI (`FwpmFilterAdd0` loop, pipe DACL, `CreateProcessAsUserW`, install/service) stays `todo!()` — out of scope; only its *contracts* are fixed here. `cargo check` + `cargo test` (pure) must pass on Linux.

---

## Task 1: Native `derive_scope_filters` — the authority (pure Rust)

**Files:**
- Modify: `native/dcs98-confine/src/wfp.rs`

- [ ] **Step 1: Add the failing tests** (append inside the existing `#[cfg(test)] mod tests`)

```rust
    fn cidrs(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }
    const TSID: &str = "S-1-5-21-1-2-3-1001";

    fn conds_have_sid(f: &Filter, sid: &str) -> bool {
        f.conditions.iter().any(|c| matches!(c, Cond::AleUserId { sid: s } if s == sid))
    }

    #[test]
    fn derives_the_canonical_set_pinned_to_the_sid() {
        let fs = derive_scope_filters(TSID, 54321, &cidrs(&["203.0.113.0/24"])).unwrap();
        // 2 base-deny + 1 loopback permit + 1 scope permit + 2 IMDS-deny
        assert_eq!(fs.len(), 6);
        assert!(fs.iter().all(|f| conds_have_sid(f, TSID))); // every filter pins the engine SID
        // base-deny present at both families
        assert!(fs.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V4" && f.action == "block" && f.weight == 5));
        assert!(fs.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V6" && f.action == "block" && f.weight == 5));
        // loopback permit carries the port + 127.0.0.1/32
        let lb = fs.iter().find(|f| f.action == "permit" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemotePort { port: 54321 }))).unwrap();
        assert!(lb.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "127.0.0.1/32")));
        // IMDS-deny at top weight, both families
        assert_eq!(fs.iter().filter(|f| f.action == "block" && f.weight == 15).count(), 2);
    }

    #[test]
    fn routes_v4_and_v6_scope_cidrs_to_their_layers() {
        let fs = derive_scope_filters(TSID, 8080, &cidrs(&["198.51.100.0/24", "2001:db8::/32"])).unwrap();
        let permits: Vec<_> = fs.iter().filter(|f| f.action == "permit" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr.contains("198.51.100") || cidr.contains("2001:db8")))).collect();
        assert!(permits.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V4" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "198.51.100.0/24"))));
        assert!(permits.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V6" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "2001:db8::/32"))));
    }

    #[test]
    fn rejects_default_route_cidrs() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["0.0.0.0/0"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["::/0"])).is_err());
    }

    #[test]
    fn rejects_imds_covering_cidrs() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["169.254.169.254/32"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["169.254.0.0/16"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["fd00:ec2::/32"])).is_err());
    }

    #[test]
    fn rejects_malformed_cidr_bad_sid_and_zero_port() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["not-a-cidr"])).is_err());
        assert!(derive_scope_filters("notasid", 8080, &cidrs(&["198.51.100.0/24"])).is_err());
        assert!(derive_scope_filters("S-1", 8080, &cidrs(&[])).is_err()); // too few parts
        assert!(derive_scope_filters(TSID, 0, &cidrs(&["198.51.100.0/24"])).is_err());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `/dcs98/native/dcs98-confine`): `cargo test derive_ wfp::`  (or `cargo test`)
Expected: FAIL — `derive_scope_filters` not found.

- [ ] **Step 3: Add the constants + deriver to `wfp.rs`**

After the imports (top of file), add the pinned constants (single source of truth; must match `install.rs` + the old TS GUIDs):

```rust
/// Pinned WFP identifiers (match install.rs persistent policy + the prior win-wfp-spec.ts GUIDs;
/// DO NOT regenerate — a changed GUID orphans installed filters).
pub const PROVIDER_GUID: &str = "3f1820f3-9024-441f-a45f-82254c1cfc51";
pub const SUBLAYER_GUID: &str = "88845872-9863-4036-9e9e-a07efc333bb7";

/// Filter weights within the dcs98 sublayer (higher wins): IMDS_DENY > SCOPE_PERMIT > BASE_DENY.
pub mod weight { pub const IMDS_DENY: u64 = 15; pub const SCOPE_PERMIT: u64 = 10; pub const BASE_DENY: u64 = 5; }

/// AWS-style link-local instance-metadata endpoints — always denied, and never permittable.
const IMDS_V4: &str = "169.254.169.254/32";
const IMDS_V6: &str = "fd00:ec2::254/128";
const IMDS_V4_ADDR: Ipv4Addr = Ipv4Addr::new(169, 254, 169, 254);
const IMDS_V6_OCTETS: [u8; 16] = [0xfd, 0x00, 0x0e, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x54];

const LAYER_V4: &str = "ALE_AUTH_CONNECT_V4";
const LAYER_V6: &str = "ALE_AUTH_CONNECT_V6";
```

Then add the deriver + its helpers (place above `apply`):

```rust
/// Validate a Windows SID string: `^S-\d-\d+(-\d+)*$` (no regex crate). "S", a single-digit revision,
/// then one or more all-numeric authority/sub-authority parts.
fn valid_sid(sid: &str) -> bool {
    let parts: Vec<&str> = sid.split('-').collect();
    if parts.len() < 3 || parts[0] != "S" { return false; }
    if parts[1].len() != 1 || !parts[1].bytes().all(|b| b.is_ascii_digit()) { return false; }
    parts[2..].iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

enum Fam { V4, V6 }

/// True if the v6 network (octets/prefix) contains `target`.
fn v6_contains(net: &[u8; 16], prefix: u8, target: &[u8; 16]) -> bool {
    let full = (prefix / 8) as usize;
    if net[..full] != target[..full] { return false; }
    let rem = prefix % 8;
    if rem == 0 { return true; }
    let mask = 0xffu8 << (8 - rem);
    (net[full] & mask) == (target[full] & mask)
}

/// Validate a scope CIDR and classify its family. Rejects: unparseable, default route (/0), and any
/// CIDR that COVERS the IMDS address (so a permit can never widen to all or whitelist metadata).
fn scope_cidr_family(cidr: &str) -> anyhow::Result<Fam> {
    if let Ok((addr, mask)) = parse_cidr_v4(cidr) {
        if mask == 0 { anyhow::bail!("default-route CIDR not allowed in scope: {cidr:?}"); }
        if (u32::from(IMDS_V4_ADDR) & mask) == (addr & mask) {
            anyhow::bail!("scope CIDR covers the IMDS address (denied): {cidr:?}");
        }
        return Ok(Fam::V4);
    }
    if let Ok((octets, prefix)) = parse_cidr_v6(cidr) {
        if prefix == 0 { anyhow::bail!("default-route CIDR not allowed in scope: {cidr:?}"); }
        if v6_contains(&octets, prefix, &IMDS_V6_OCTETS) {
            anyhow::bail!("scope CIDR covers the IMDS address (denied): {cidr:?}");
        }
        return Ok(Fam::V6);
    }
    anyhow::bail!("unparseable CIDR in scope: {cidr:?}")
}

/// THE AUTHORITY. Derive the canonical WFP filter set from trusted scalars — the native side never
/// trusts a caller-supplied filter list. Mirrors the netns jail: deny-by-default for the engine SID,
/// permit {loopback proxy, validated scope CIDRs}, inviolable top-weight IMDS deny. Pure + unit-tested.
pub fn derive_scope_filters(sid: &str, proxy_port: u16, allow_cidrs: &[String]) -> anyhow::Result<Vec<Filter>> {
    if !valid_sid(sid) { anyhow::bail!("confinement requires a valid engine SID, got {sid:?}"); }
    if proxy_port == 0 { anyhow::bail!("confinement requires a valid loopback proxy port, got 0"); }
    let user = || Cond::AleUserId { sid: sid.to_string() };
    let mut filters: Vec<Filter> = Vec::new();

    // (1) catch-all BLOCK for the engine SID at both families (deny-by-default).
    filters.push(Filter { layer: LAYER_V4.into(), action: "block".into(), weight: weight::BASE_DENY, conditions: vec![user()] });
    filters.push(Filter { layer: LAYER_V6.into(), action: "block".into(), weight: weight::BASE_DENY, conditions: vec![user()] });

    // (2) PERMIT the loopback proxy (127.0.0.1:proxy_port).
    filters.push(Filter {
        layer: LAYER_V4.into(), action: "permit".into(), weight: weight::SCOPE_PERMIT,
        conditions: vec![user(), Cond::IpRemoteAddress { cidr: "127.0.0.1/32".into() }, Cond::IpRemotePort { port: proxy_port }],
    });

    // (3) PERMIT each validated scope CIDR at its family's layer.
    for cidr in allow_cidrs {
        let layer = match scope_cidr_family(cidr)? { Fam::V4 => LAYER_V4, Fam::V6 => LAYER_V6 };
        filters.push(Filter {
            layer: layer.into(), action: "permit".into(), weight: weight::SCOPE_PERMIT,
            conditions: vec![user(), Cond::IpRemoteAddress { cidr: cidr.clone() }],
        });
    }

    // (4) TOP-weight IMDS BLOCK at both families (inviolable defense-in-depth).
    filters.push(Filter { layer: LAYER_V4.into(), action: "block".into(), weight: weight::IMDS_DENY, conditions: vec![user(), Cond::IpRemoteAddress { cidr: IMDS_V4.into() }] });
    filters.push(Filter { layer: LAYER_V6.into(), action: "block".into(), weight: weight::IMDS_DENY, conditions: vec![user(), Cond::IpRemoteAddress { cidr: IMDS_V6.into() }] });

    Ok(filters)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test` (from `native/dcs98-confine`)
Expected: PASS — new deriver tests + the existing CIDR/deserialize tests all green.

- [ ] **Step 5: Commit**

```bash
git add native/dcs98-confine/src/wfp.rs
git commit -m "feat(confinement): native derive_scope_filters — the WFP policy authority"
```

---

## Task 2: `apply` consumes scalars + protocol drops `filters` + contracts

**Files:**
- Modify: `native/dcs98-confine/src/wfp.rs` (`apply` signature/body + `verify_base_deny_present` stub)
- Modify: `native/dcs98-confine/src/pipe.rs` (`ControlRequest::ApplyScope`)
- Modify: `native/dcs98-confine/src/service.rs` (ApplyScope arm; DACL + spawn-cmd contracts)

- [ ] **Step 1: Change `apply` to derive natively (`wfp.rs`)**

Replace the current `pub fn apply(_sid: &str, _filters: &[Filter]) -> anyhow::Result<String> { … todo!() }` with:

```rust
/// Apply a scope for one engagement. The filter set is DERIVED here from trusted scalars (never
/// caller-supplied). Fail-closed: refuses to add permits unless the persistent base-deny is present.
/// Returns a fresh scope_id tracking the created filter keys.
pub fn apply(sid: &str, proxy_port: u16, allow_cidrs: &[String]) -> anyhow::Result<String> {
    let filters = derive_scope_filters(sid, proxy_port, allow_cidrs)?;
    verify_base_deny_present()?; // fail-closed: no per-scope permits without the persistent deny baseline
    // HOST: FwpmEngineOpen0; FwpmTransactionBegin0; for f in &filters { build FWPM_FILTER_CONDITION0[]
    //   (AleUserId->ALE_USER_ID SD, IpRemoteAddress->V4/V6_ADDR_AND_MASK via parse_cidr_*, IpRemotePort->UINT16),
    //   FWPM_FILTER0 { layer_guid(&f.layer)?, SUBLAYER_GUID, FWP_UINT64(f.weight), action from action_is_permit(&f.action)?,
    //   PROVIDER_GUID }, FwpmFilterAdd0 -> collect id }; FwpmTransactionCommit0; record scope_id->ids.
    let _ = (&*scopes(), layer_guid, action_is_permit, &filters);
    todo!("HOST: FwpmFilterAdd0 loop over the natively-derived `filters` in one transaction")
}

/// HOST precondition for apply: confirm the PERSISTENT base-deny filters (installed by install.rs step 3,
/// keyed by PROVIDER_GUID) exist, so per-scope permits are always exceptions to a live deny baseline.
/// Err (fail-closed) if absent.
fn verify_base_deny_present() -> anyhow::Result<()> {
    // HOST: FwpmFilterEnum0 filtered by PROVIDER_GUID; assert base-deny V4+V6 present; else bail.
    todo!("HOST: verify persistent base-deny (PROVIDER_GUID) present; fail closed if missing")
}
```

- [ ] **Step 2: Drop `filters` from the wire (`pipe.rs`)**

In `ControlRequest::ApplyScope`, remove the `filters: Vec<crate::wfp::Filter>` field (and its doc line), leaving:

```rust
    #[serde(rename_all = "camelCase")]
    ApplyScope {
        proxy_port: u16,
        allow_cidrs: Vec<String>,
        sid: String,
    },
```

If `pipe.rs`'s own `#[cfg(test)]` round-trip test constructs/asserts an `ApplyScope` with a `filters`
field, update it to the new shape (drop `filters`) so the module still compiles + tests pass. (serde
ignores an unknown JSON `filters` key by default, but a Rust-side struct-literal or field match won't.)

- [ ] **Step 3: Consume the scalars in `service.rs`**

Replace the ApplyScope arm (it currently destructures `{ sid, filters, .. }` and calls `apply(&sid, &filters)`):

```rust
        ControlRequest::ApplyScope { sid, proxy_port, allow_cidrs } => Ok(Some(match crate::wfp::apply(&sid, proxy_port, &allow_cidrs) {
            Ok(scope_id) => ControlResponse { ok: true, scope_id: Some(scope_id), ..Default::default() },
            Err(e) => ControlResponse::err(format!("WFP apply failed: {e}")),
        })),
```

- [ ] **Step 4: Harden the deferred-FFI contracts (comments in `service.rs`)**

In `accept_loop`'s `todo!()`, make the DACL a hard contract:

```rust
    // HOST: create the named pipe \\.\pipe\dcs98-confine with a SECURITY_ATTRIBUTES DACL that denies by
    // default and admits ONLY { LocalSystem, the install-time interactive owner SID recorded as
    // engine.owner by install.rs step 2 }. No other principal may connect — this DACL is the entire
    // local-attacker boundary for applyScope/spawn/clearScope.
    todo!("HOST: create pipe server with the LocalSystem+owner-SID-only DACL; ConnectNamedPipe accept loop")
```

In the `Spawn` arm, note the cmd constraint (before the `create_as_engine_user` call):

```rust
        ControlRequest::Spawn { scope_id, cmd, args } => {
            // CONTRACT: `cmd` MUST be the bundled engine binary, not an arbitrary executable — the jail
            // confines a known tool. HOST: enforce is_allowed_engine_cmd(&cmd) (compare against the
            // resolved bundled engine path) and reject otherwise before spawning.
            let mut child = match crate::spawn::create_as_engine_user(&cmd, &args) {
```

- [ ] **Step 5: `cargo check` + `cargo test`**

Run (from `native/dcs98-confine`): `cargo test`
Expected: compiles; all pure tests pass. (`apply`/`verify_base_deny_present` remain `todo!()` — not exercised by tests.)

- [ ] **Step 6: Commit**

```bash
git add native/dcs98-confine/src/wfp.rs native/dcs98-confine/src/pipe.rs native/dcs98-confine/src/service.rs
git commit -m "feat(confinement): apply derives natively; drop filters from wire; fix FFI contracts"
```

---

## Task 3: TS rewire — send scalars only; delete the TS spec builder

**Files:**
- Modify: `src/main/offensive/confinement/win-wfp.ts`
- Modify: `src/main/offensive/confinement/win-pipe.ts`
- Delete: `src/main/offensive/confinement/win-wfp-spec.ts`
- Delete: `test/confinement-wfp-spec.test.ts`
- Modify: `test/confinement-win-wfp.test.ts` (drop `filters` from the expected applyScope payload)

- [ ] **Step 1: Update the failing TS test first**

In `test/confinement-win-wfp.test.ts`, find the assertion(s) on the `applyScope` request payload and remove any expectation of a `filters` field (the payload is now `{ op:'applyScope', proxyPort, allowCidrs, sid }`). If the test imports anything from `win-wfp-spec`, remove that import. Run it to see it fail against the not-yet-updated `win-wfp.ts` (still sending `filters`):

Run: `pnpm exec vitest run test/confinement-win-wfp.test.ts`
Expected: the suite exercises the new payload shape (fails until Step 2).

- [ ] **Step 2: `win-wfp.ts` sends scalars only**

Remove the import `import { buildWfpFilterSpec } from './win-wfp-spec';`. Remove the line
`const spec = buildWfpFilterSpec(plan, sid);`. Change the applyScope call to drop `filters`:

```ts
    const sid = deps.engineSid();
    const applied = await call({ op: 'applyScope', proxyPort: plan.proxyPort, allowCidrs: plan.allowCidrs, sid });
```

(Update the file's header comment that references "buildWfpFilterSpec output" to say the native helper derives the policy from the scalars.)

- [ ] **Step 3: `win-pipe.ts` — drop `filters` from the applyScope variant**

```ts
export type ControlRequest =
  | { op: 'applyScope'; proxyPort: number; allowCidrs: string[]; sid: string }
  | { op: 'spawn'; scopeId: string; cmd: string; args: string[] }
  | { op: 'kill'; pid: number }
  | { op: 'clearScope'; scopeId: string }
  | { op: 'status' };
```

- [ ] **Step 4: Delete the now-vestigial TS spec builder + its test**

```bash
git rm src/main/offensive/confinement/win-wfp-spec.ts test/confinement-wfp-spec.test.ts
```

(Confirm nothing else imports `win-wfp-spec` — verified: only `win-wfp.ts` + the deleted test. The
`PROVIDER_GUID`/`SUBLAYER_GUID`/`WEIGHT` now live in Rust.)

- [ ] **Step 5: Typecheck + run the TS confinement tests**

Run: `pnpm typecheck`
Expected: OK (no dangling imports of the deleted module).
Run: `pnpm exec vitest run test/confinement-win-wfp.test.ts test/confinement-win-pipe.test.ts test/confinement-plan.test.ts test/confinement-enable-setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/offensive/confinement/win-wfp.ts src/main/offensive/confinement/win-pipe.ts test/confinement-win-wfp.test.ts
git commit -m "refactor(confinement): TS sends scalars only; delete TS WFP spec builder"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `cargo test` (in `native/dcs98-confine`) — deriver + existing pure tests green.
- [ ] `pnpm typecheck` — OK.
- [ ] `pnpm test` — full suite green (confinement-wfp-spec removed; confinement-win-wfp updated).
- [ ] `cargo check` — clean.
- [ ] Security audit: confirm NO filter list crosses the pipe (grep `pipe.rs`/`win-pipe.ts`/`win-wfp.ts` for `filters` — should be gone from the applyScope path); `derive_scope_filters` is the only producer of `Filter`s; `apply` calls `verify_base_deny_present` before the (todo) add loop; the DACL + spawn-cmd contracts are documented.
- [ ] State plainly that the Windows FFI bodies remain `todo!()` and confinement is NOT releasable until they are implemented and the pktmon gate (incl. `-Poisoned` must-fail) passes on a Windows host.

## Parked / out of scope

- Implementing the Windows FFI (`FwpmFilterAdd0` apply loop, `verify_base_deny_present`, pipe DACL, `CreateProcessAsUserW`, install/service), and the pktmon acceptance gate — Windows-host follow-up. Any release of the offensive engine.
