# `authorized-target-egress` — Design Spec

**Status:** design — to be red-teamed, then operator-reviewed, before any plan.
**Date:** 2026-06-10
**Author:** Obsidian Circuit (with Claude)
**Part of:** Platform v1.1 (public MIT core). Sibling capability `persistent-background-connection` (Telegram) is a separate, later design.

**Goal:** Add a plugin capability that lets a signed first-party plugin (the OSINT plugin's bundled offensive scanner) send attack traffic to **authorized** targets — including the private/loopback ranges the normal `egress` gate rejects — with per-request scope enforcement owned by DCS98 and a tamper-evident audit of every request.

**Architecture:** The capability is backed by four units in the DCS98 main process: a `ScopeManifest` (the authorization), a pure `ScopeEnforcer` (allow/deny decision), an `AuthorizedEgressProxy` (a loopback proxy the scanner routes through, enforcing the decision per-request), and `EngagementAudit` (every decision → immutable timeline). The scanner subprocess reaches targets only through the proxy.

**Threat model (stated up front, governs the whole design):** The scanner is *our own PQ-hybrid-signed, first-party code* running in a subprocess with raw OS sockets. The signature is the boundary against malicious code. This capability therefore defends against **operator accident** — a stale/expired scope, a fat-fingered target, a crawler or redirect wandering out of scope — and provides a **tamper-evident record of exactly what was attacked**. The proxy is enforcement-against-accident + audit, **not** a hard sandbox against a malicious scanner. (A true OS network jail was considered and rejected for v1: OS-specific, brittle on Windows, overkill for signed first-party code.)

---

## 1. Components

### 1.1 `ScopeManifest` (`src/main/offensive/scope-manifest.ts`)
The authorization document, ported from deep-eye's `core/scope_manifest.py` (clean, stdlib-only logic).

```typescript
export interface ScopeManifest {
  manifestId: string;                 // stable id, appears in every audit event
  mode: 'engagement' | 'bounty' | 'self' | 'lab';
  expiresAt: string;                  // ISO-8601 UTC; MANDATORY, no never-expire
  include: ScopeRule[];               // at least one
  exclude: ScopeRule[];               // exclusions always win
  requiresSignedAuthorization?: boolean; // if true, a valid signed token is required to grant
  attestation?: { operator: string; attestedAt: string }; // local-authored attestation
}
export type ScopeRule =
  | { kind: 'domain'; value: string }   // 'example.com' or '*.example.com'
  | { kind: 'cidr'; value: string };    // IPv4/IPv6 CIDR
// NOTE: ASN rules are DEFERRED to when the IP-intelligence dataset (BGP/RIR, the Team-Cymru-class
// tier-2 tool) exists. Resolving a target IP→ASN is impossible without it, and an unenforceable
// ASN *exclude* rule would be a fail-OPEN hole. v1 therefore REJECTS any manifest containing an ASN
// rule (clear error: "ASN scope rules require the IP-intelligence dataset, not yet available").
```
`parseScopeManifest(raw): ScopeManifest` validates: non-empty `manifestId`, known `mode`, parseable not-already-expired `expiresAt`, ≥1 `include` rule, well-formed rules (valid CIDR, domain syntax), and **rejects any `asn`-kind rule** (deferred — see note). Throws `ScopeManifestError` on any malformation (fail-closed).

### 1.2 `ScopeEnforcer` (`src/main/offensive/scope-enforcer.ts`)
Pure decision function — the single source of truth, no I/O:
```typescript
export type ScopeDecision = { allow: true } | { allow: false; reason: string };
export function decide(manifest: ScopeManifest, target: ResolvedTarget, now: number): ScopeDecision;
// ResolvedTarget = { host: string; ip: string }
```
Decision order (deny-by-default): **expired** (`now >= expiresAt`) → **excluded** (any exclude rule matches → deny) → **included** (some include rule matches → allow) → **deny**. Matching: domain uses exact or `*.`-suffix on the request host; CIDR uses *subnet containment* (the resolved target IP ∈ the CIDR; for an excluded CIDR, any IP-in-CIDR denies). `now` is injected (determinism). Fully unit-testable in isolation.

### 1.3 `AuthorizedEgressProxy` (`src/main/offensive/egress-proxy.ts`)
A loopback HTTP + HTTPS-CONNECT proxy bound to `127.0.0.1:<ephemeral>`, started when a scan begins and torn down when it ends. For **every** request (initial, crawl-discovered, redirect hop):
1. Extract the target host; DNS-resolve to IP(s) (reuse the resolver behind `assertResolvedPublic`).
2. `ScopeEnforcer.decide(manifest, resolvedTarget, now)`.
3. **Deny → respond `403` to the scanner** and emit a `denied` audit event. **Allow →** forward the request, emit an `allowed` audit event, and apply the rate limiter (configurable req/s; the proxy is the chokepoint deep-eye lacks).
The proxy never bypasses `decide`; redirects are re-checked because they pass back through the proxy as new requests. The proxy holds no secrets and forwards no credentials cross-origin (it inherits the platform's existing cross-origin credential-strip rule).

### 1.4 `EngagementAudit` (`src/main/offensive/engagement-audit.ts`)
`record(caseId, event)` appends to the case's **immutable timeline** (`caseStore.addTimeline`). Event shape: `{ manifestId, target, ip, method, decision: 'allowed'|'denied', reason?, attackType?, at }`. Logged for **both** allowed and denied requests — the timeline is the tamper-evident attack record (far better than deep-eye's plaintext log). Optionally PQ-signs the audit batch on engagement close (reuse signing primitives) for an externally-verifiable record.

---

## 2. Two-provenance scope model

**Local-authored (default).** The operator authors a `ScopeManifest` in a DCS98 form (targets/CIDRs, exclude list, mandatory expiry). On save, an `attestation` is recorded and an operator-attestation event is written to the timeline ("I am authorized to test these targets — <operator>, <time>"). Stored in the vault.

**Signed authorization (optional layer).** A `ScopeManifest` may be delivered as a signed token: the canonical hash of the manifest bytes is verified with the **existing `verifyPluginSignature` primitives** (Ed25519 ∥ ML-DSA-65) against a configured **issuer** public key (per-engagement or in settings — distinct from the plugin trust root). If `requiresSignedAuthorization` is true, the capability is **not granted** unless a valid issuer signature is present and unexpired. No new crypto; no AGPL Shadowbroker. This gives third-party-attested authorization for engagements that need it (client/bounty sign-off).

The capability is granted by the loader **only** when: the manifest parses, is unexpired, and — if `requiresSignedAuthorization` — verifies against an authorized issuer key.

---

## 3. Capability wiring

- Add `'authorized-target-egress'` to `CAPABILITIES` (`src/shared/plugin-types.ts`) and a scoped surface to `PluginContext` (`src/main/plugins/context.ts`): `attackEgress?: { proxyUrl(): string; scopeDecision(target): ScopeDecision }`. Distinct from `egress` — it *permits* private/loopback, but only for in-scope targets, and only through the proxy.
- `wire-deps.ts` builds the surface only when a valid `ScopeManifest` is loaded for the engagement. The plugin spawns its scanner subprocess configured to use `attackEgress.proxyUrl()` as its HTTP/S proxy (deep-eye's `proxy` config). The scanner sees a normal proxy; the gate is invisible to it and unbypassable *by accident*.
- The capability request renders a distinct, loud authorization surface (not the generic capability grant): it names the engagement and scope.

---

## 4. Authorization moment, Tor, rate-limiting

- **Per-scan confirmation (default):** before each scan, DCS98 shows "Send attack traffic to `<target(s)>` under engagement `<manifestId>`, expiring `<date>` — <scope summary>? Confirm." Recorded to the timeline. **User-preference toggle** (`settings.offensive.confirmMode: 'per-scan' | 'per-session'`) switches to confirm-once-per-engagement-session (one confirmation covers scans within that loaded-engagement session; re-arming on a new session or scope change). Default `per-scan`.
- **Tor:** opt-out for offense (default **direct-to-target** through the proxy — attack traffic over Tor is hostile to the network and slow). An option chains an external pentest proxy (Burp/ZAP) *downstream* of `AuthorizedEgressProxy`. The choice is explicit and recorded; never a silent direct-egress surprise.
- **Rate-limiting:** enforced at the proxy, configurable req/s (`settings.offensive.rateLimitPerSec`), since deep-eye doesn't honor its own. Disclosed in the confirmation prompt.

---

## 5. Settings additions (`src/shared/types.ts`)
```typescript
offensive: {
  confirmMode: 'per-scan' | 'per-session'; // default 'per-scan'
  rateLimitPerSec: number;                 // default e.g. 10
  downstreamProxy?: string | null;         // optional Burp/ZAP, default null (direct)
  issuerKeys?: { edPubHex: string; pqPubHex: string }[]; // authorized scope-signing issuers
};
```
Defaults are fail-safe: `per-scan`, no downstream proxy, no issuer keys (so any `requiresSignedAuthorization` manifest is refused until an issuer is configured).

---

## 6. Error handling (all fail-closed)

| Condition | Behavior |
|---|---|
| No manifest loaded | Capability not granted; scanner cannot egress |
| Manifest expired | Not granted; denial logged |
| `requiresSignedAuthorization` but no/invalid signature | Not granted; denial logged |
| Target not in scope (incl. crawl/redirect drift) | Proxy `403` + `denied` audit event; scan continues against in-scope targets only |
| Proxy unreachable / down | Scanner cannot egress (correct — no ungated path) |
| Malformed manifest | `ScopeManifestError`, not granted |
| Scan confirmation declined | Scan does not start |

---

## 7. Testing

- **`ScopeEnforcer` decision matrix** (pure unit): expired; exclude-wins-over-include; `*.`-wildcard domain; CIDR subnet containment (in/out); excluded-CIDR IP-in-CIDR denies; deny-by-default for unmatched; injected `now`.
- **`parseScopeManifest`**: rejects missing/already-past expiry, empty include, bad CIDR/domain, unknown mode, **and any `asn`-kind rule** (deferred-with-clear-error).
- **Signed authorization**: valid issuer signature grants; wrong key / tampered manifest / `requiresSignedAuthorization`-with-no-issuer all refuse (reuse the verify test patterns).
- **`AuthorizedEgressProxy`** (integration, mocked upstream): in-scope request forwarded + `allowed` event; out-of-scope → `403` + `denied` event; redirect to out-of-scope → denied; rate limiter caps throughput; private/loopback target **allowed when in-scope** (the whole point) and **denied when not**.
- **`EngagementAudit`**: allowed and denied both append timeline events with the right fields.
- **Confirmation/Tor/rate-limit settings**: defaults are fail-safe; `per-session` arms once.

---

## 8. Security invariants

- The normal `egress` capability and its SSRF gate are **unchanged**; this is a separate, deliberately-scoped capability. A plugin without `authorized-target-egress` can never reach private/loopback.
- Every attack request is enforced (per-request) and recorded (immutable timeline) — the audit is the responsible-use control, and it is owned by DCS98, not the scanner.
- The honest limit (§ threat model) is stated in code comments and the capability's authorization UI: this is accident-prevention + tamper-evident audit over signed first-party code, not a sandbox.
- No telemetry; the proxy is loopback-only; outbound is gated by scope, not the public-only SSRF rule.

---

## 9. Out of scope (this capability)
- `persistent-background-connection` (Telegram) — separate design.
- An OS-level network jail (rejected for v1; revisitable if a hard sandbox is ever required).
- The OSINT plugin itself / the bundled scanner integration (subsystem 2) — this is the platform capability it will target.
- A scope-issuing authority service (the signed path *verifies* tokens; issuing them is external/product).
- **ASN scope rules** — deferred until the IP-intelligence (BGP/RIR) dataset exists (a tier-2 OSINT tool). v1 rejects manifests containing them rather than enforce them fail-open.
