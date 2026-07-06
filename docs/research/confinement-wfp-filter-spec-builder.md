# Reference — Windows WFP filter-spec builder (`buildWfpFilterSpec`)

**Status:** extracted reference, NOT wired into `main`. Preserved here so the logic survives without a
stale branch.
**Provenance:** branch `feat/confinement-win-t5t6-ts`, commit `6f88c4f` ("pure WFP-on-SID filter-spec
builder — 05a-T5.1"), authored before `dcs98-confine` merged to `main`. Its file
`src/main/offensive/confinement/win-wfp-spec.ts` (+ test `test/confinement-wfp-spec.test.ts`) never
landed — every other file on that branch (`win-pipe.ts`, `win-wfp.ts`, `enable-setup.ts`) re-landed in
reworked form, but this one has no equivalent in `main`.

## Why this is a reference, not merged code — the open decision it sits on

This module derives the WFP (Windows Filtering Platform) filter set **in TypeScript** and hands it to the
native helper (`dcs98-confine.exe`) to **apply verbatim**. That is precisely the arrangement the open
confinement trust-boundary decision is weighing: the merged `dcs98-confine` scaffold has an
**unresolved design flaw — "native applies TS filters verbatim"** — and the operator-stated direction is
to move **policy-derivation native** (and to harden the control pipe's DACL) *before* implementing/
shipping the applier. See the `confinement-wfp-trust-boundary` memory.

So this code embodies the **TS-side-derivation** approach. Its own header argues for that approach
("putting the allow/deny decision here, not in unverifiable Rust, keeps the load-bearing INV-C1 logic
unit-tested on every Linux CI run; the native helper is a dumb applier of the JSON this emits"). Whether
that argument wins, or the derivation moves into the Rust helper, is the reserved decision. Keep this as
**reference for the native rewrite** (the rule structure and weights are correct regardless of *where*
the derivation runs) — do not merge it as-is without settling native-vs-TS first.

## Compatibility with current `main`

Still typechecks against today's code: `main`'s `ConfinementPlan` (`src/main/offensive/confinement/plan.ts`)
retains the two fields this consumes — `proxyPort: number` and `allowCidrs: string[]`. It is the Windows
analog of `main`'s `linux-netns.ts:buildNetnsNftRuleset` (the Linux jail's pure, unit-tested rule builder).

## Rule model

WFP arbitrates **within a sublayer by weight**: the highest-weight matching filter with a hard action
wins. The three weights encode "deny-by-default, permit exceptions, with an inviolable IMDS hole-plug":

| Weight | Name | Purpose |
|---|---|---|
| 15 | `IMDS_DENY` | TOP-weight block of link-local instance-metadata (`169.254.169.254/32`, `fd00:ec2::254/128`) — inviolable even if a scope CIDR contains link-local. Mirrors the proxy's M3 always-exclude. |
| 10 | `SCOPE_PERMIT` | permit `127.0.0.1:proxyPort` and each manifest scope CIDR. |
| 5 | `BASE_DENY` | catch-all block for the engine SID at both families (deny everything else, system-resolver DNS included, by falling through). |

Every filter conditions on the dedicated engine user's **SID** (`ale_user_id`) — a filter set not bound
to that SID would confine nothing (the builder rejects an empty/malformed SID). The applier keys install
(base policy) and uninstall (purge-by-provider) on the **pinned GUIDs** — regenerating them orphans
installed filters, so they must never change.

## Behavioral contract (from the original test)

- Always permits the loopback proxy at v4 with `[user, addr 127.0.0.1/32, port proxyPort]` conditions, at `SCOPE_PERMIT` weight.
- Emits a catch-all BLOCK for the engine SID at **both** families, below the permits (`SCOPE_PERMIT > BASE_DENY`).
- Routes each scope CIDR to the layer for **its** family (v4 → `ALE_AUTH_CONNECT_V4`, v6 → `…_V6`), above the base deny.
- Emits a TOP-weight IMDS deny at both families (`IMDS_DENY > SCOPE_PERMIT`).
- Carries the engine SID + pinned provider/sublayer GUIDs through to the returned spec.
- Rejects an empty/malformed SID (`/engine SID/`) and an out-of-range proxy port (`0`, `70000` → `/proxy port/`).

## Source (verbatim)

```ts
import { isIP } from 'node:net';
import type { ConfinementPlan } from './plan';

/**
 * A declarative WFP filter set, applied verbatim by the native helper (dcs98-confine.exe). This module
 * is the Windows analog of linux-netns.ts:buildNetnsNftRuleset — the PURE, deterministic, unit-tested
 * security core. The rule set mirrors the netns jail: PERMIT {127.0.0.1:proxyPort, scope CIDRs} for the
 * engine user's SID; a catch-all BLOCK for that SID denies everything else (system-resolver DNS included,
 * by falling through); an explicit TOP-weight IMDS BLOCK is defense-in-depth (matches the proxy's M3
 * always-exclude). WFP arbitrates WITHIN a sublayer by weight: the highest-weight matching filter with a
 * hard action wins — so IMDS_DENY > SCOPE_PERMIT > BASE_DENY gives "deny-by-default, permit exceptions,
 * with an inviolable IMDS hole-plug."
 *
 * Putting the allow/deny decision here (not in unverifiable Rust) keeps the load-bearing INV-C1 logic
 * unit-tested on every Linux CI run; the native helper is a dumb applier of the JSON this emits.
 */

/** Pinned identifiers so install (base policy) and runtime (per-scope) agree, and uninstall can purge by
 *  provider GUID. Generated once; DO NOT regenerate (a changed GUID orphans installed filters). */
export const PROVIDER_GUID = 'b8c7e2a0-4d3f-4e91-9a2b-7c1d5e6f0a11';
export const SUBLAYER_GUID = 'b8c7e2a0-4d3f-4e91-9a2b-7c1d5e6f0a12';

/** Filter weights within the dcs98 sublayer (higher wins). */
export const WEIGHT = { IMDS_DENY: 15, SCOPE_PERMIT: 10, BASE_DENY: 5 } as const;

/** AWS-style link-local instance-metadata endpoints, always denied (SSRF belt — mirrors scope-enforcer M3). */
const IMDS_V4 = '169.254.169.254/32';
const IMDS_V6 = 'fd00:ec2::254/128';

export type WfpLayer = 'ALE_AUTH_CONNECT_V4' | 'ALE_AUTH_CONNECT_V6';
export type WfpCondition =
  | { field: 'ale_user_id'; sid: string }
  | { field: 'ip_remote_address'; cidr: string }
  | { field: 'ip_remote_port'; port: number };
export interface WfpFilter {
  layer: WfpLayer;
  action: 'permit' | 'block';
  weight: number;
  /** ANDed together (WFP filter conditions on distinct fields are conjunctive). */
  conditions: WfpCondition[];
}
export interface WfpFilterSpec {
  providerGuid: string;
  sublayerGuid: string;
  /** The dedicated engine user's SID (string form, e.g. "S-1-5-21-..."). All filters condition on it. */
  engineSid: string;
  filters: WfpFilter[];
}

function familyLayer(cidrOrIp: string): WfpLayer {
  const base = cidrOrIp.includes('/') ? cidrOrIp.slice(0, cidrOrIp.lastIndexOf('/')) : cidrOrIp;
  return isIP(base) === 6 ? 'ALE_AUTH_CONNECT_V6' : 'ALE_AUTH_CONNECT_V4';
}

export function buildWfpFilterSpec(plan: ConfinementPlan, engineSid: string): WfpFilterSpec {
  if (!engineSid || !/^S-\d-\d+(-\d+)*$/.test(engineSid)) {
    throw new Error(`confinement requires a valid engine SID, got ${JSON.stringify(engineSid)}`);
  }
  if (!Number.isInteger(plan.proxyPort) || plan.proxyPort < 1 || plan.proxyPort > 65535) {
    throw new Error(`confinement requires a valid loopback proxy port, got ${plan.proxyPort}`);
  }
  const user: WfpCondition = { field: 'ale_user_id', sid: engineSid };
  const filters: WfpFilter[] = [];

  // (1) Catch-all BLOCK for the engine SID at both families (deny-by-default).
  filters.push({ layer: 'ALE_AUTH_CONNECT_V4', action: 'block', weight: WEIGHT.BASE_DENY, conditions: [user] });
  filters.push({ layer: 'ALE_AUTH_CONNECT_V6', action: 'block', weight: WEIGHT.BASE_DENY, conditions: [user] });

  // (2) PERMIT the loopback proxy (127.0.0.1:proxyPort). The proxy binds v4 loopback in core.
  filters.push({
    layer: 'ALE_AUTH_CONNECT_V4',
    action: 'permit',
    weight: WEIGHT.SCOPE_PERMIT,
    conditions: [user, { field: 'ip_remote_address', cidr: '127.0.0.1/32' }, { field: 'ip_remote_port', port: plan.proxyPort }],
  });

  // (3) PERMIT each scope CIDR at its family's layer (manifest order; buildConfinementPlan validated it).
  for (const cidr of plan.allowCidrs) {
    filters.push({
      layer: familyLayer(cidr),
      action: 'permit',
      weight: WEIGHT.SCOPE_PERMIT,
      conditions: [user, { field: 'ip_remote_address', cidr }],
    });
  }

  // (4) TOP-weight IMDS BLOCK at both families — inviolable even if a scope CIDR contains link-local.
  filters.push({ layer: 'ALE_AUTH_CONNECT_V4', action: 'block', weight: WEIGHT.IMDS_DENY, conditions: [user, { field: 'ip_remote_address', cidr: IMDS_V4 }] });
  filters.push({ layer: 'ALE_AUTH_CONNECT_V6', action: 'block', weight: WEIGHT.IMDS_DENY, conditions: [user, { field: 'ip_remote_address', cidr: IMDS_V6 }] });

  return { providerGuid: PROVIDER_GUID, sublayerGuid: SUBLAYER_GUID, engineSid, filters };
}
```

## If/when this is revived

- Settle **native-vs-TS derivation** first (the reserved trust-boundary decision). If derivation moves
  native, port this rule structure/weights into the Rust helper and keep only a thin typed view here; if
  it stays TS, this file merges roughly as-is but the **control pipe must be DACL-hardened** so a lower-
  privileged process cannot feed the SYSTEM applier a forged `WfpFilterSpec`.
- The original test (`test/confinement-wfp-spec.test.ts` on the branch) encodes the contract above; recover
  it from that branch or re-derive from the bullet list.
