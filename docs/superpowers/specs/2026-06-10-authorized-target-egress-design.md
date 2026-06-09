# `authorized-target-egress` — Design Spec (v2, post-red-team)

**Status:** design — revised after an adversarial red-team pass (3 critical / 5 high / 4 medium, all addressed below). §3.1 resolved by operator to **option A (HTTP-only v1, raw scanning disabled)**. Awaiting final operator spec review before writing-plans.
**Date:** 2026-06-10
**Author:** Obsidian Circuit (with Claude)
**Part of:** Platform v1.1 (public MIT core). Sibling capability `persistent-background-connection` (Telegram) is a separate, later design.
**Red-team:** `red-teamer` opus pass, 2026-06-10 — verdict on v1 was "does not meet either goal"; this v2 closes the must-fix list.

**Goal:** A plugin capability that lets a signed first-party plugin (the OSINT plugin's bundled offensive scanner) send attack traffic to **authorized** targets — including private/loopback ranges the normal `egress` gate rejects — with per-request scope enforcement owned by DCS98 and a **genuinely tamper-evident** audit of every proxied request.

**Architecture:** Four units in DCS98 main: a `ScopeManifest` (authorization), a pure `ScopeEnforcer` (allow/deny over the *full resolved address set*), an `AuthorizedEgressProxy` (a loopback CONNECT proxy that **pins connections to the validated IP** and the scanner routes all TCP through), and `EngagementAudit` (an append-only, hash-chained, signed-at-write log). The scanner reaches HTTP/TCP targets only through the proxy.

**Threat model (governs everything):** the scanner is our own PQ-hybrid-signed, first-party code with raw OS sockets; the signature is the boundary against malicious code. This capability defends against **operator accident** (stale/expired scope, fat-fingered target, crawl/redirect/DNS drift) and provides a **tamper-evident record of what was attacked**. *The red-team correctly noted v1 leaned on the same trusted-scanner code path for the audit it was supposed to make trustworthy.* v2 fixes that by (a) pinning enforcement to DCS98-observed facts (the IP we dialed), not scanner claims, and (b) making the audit tamper-evident against everything except the scanner deliberately bypassing the proxy — which is the explicitly-accepted malicious-first-party case, surfaced honestly (§3.1, §8).

---

## 1. Components

### 1.1 `ScopeManifest` (`src/main/offensive/scope-manifest.ts`)
```typescript
export interface ScopeManifest {
  manifestId: string;
  mode: 'engagement' | 'bounty' | 'self' | 'lab';
  expiresAt: string;          // ISO-8601 UTC; MANDATORY, must be in the future at load
  notBefore?: string;         // optional ISO-8601; scope inactive before this
  include: ScopeRule[];       // ≥1
  exclude: ScopeRule[];       // exclusions always win
  attestation?: { operator: string; attestedAt: string };
}
export type ScopeRule =
  | { kind: 'domain'; value: string }   // 'example.com' or '*.example.com' (leftmost-only wildcard)
  | { kind: 'cidr'; value: string };    // IPv4/IPv6 CIDR
// ASN rules DEFERRED (no IP-intel dataset yet → would be fail-OPEN on excludes); v2 REJECTS asn rules.
export function contentHash(m: ScopeManifest): string; // canonical SHA-256 over normalized manifest
```
**`requiresSignedAuthorization` is NOT a manifest field** (red-team Finding 8c: an artifact must not self-assert whether it needs to be signed). Whether a signature is required is **policy** in settings (§2, §5).

`parseScopeManifest(raw)` validates and **normalizes** fail-closed: non-empty `manifestId`; known `mode`; `expiresAt` parses and is in the future; `notBefore ≤ expiresAt` if present; ≥1 `include`; every rule well-formed; **rejects any `asn` rule** with a clear error. Throws `ScopeManifestError` otherwise.

### 1.2 `ScopeEnforcer` (`src/main/offensive/scope-enforcer.ts`) — pure, no I/O
```typescript
export type ScopeDecision = { allow: true } | { allow: false; reason: string };
export interface ResolvedTarget { host: string; ips: string[]; }   // ALL resolved addresses
export function decide(m: ScopeManifest, t: ResolvedTarget, now: number): ScopeDecision;
```
Order (deny-by-default): **time-invalid** (`now >= expiresAt`, or `notBefore` set and `now < notBefore`) → **any IP excluded** (any address matches any exclude → deny) → **host excluded** → **every IP must be includable**: deny unless *the host matches an include domain rule* **or** *every resolved IP is inside some include CIDR* (red-team Finding 4 — checking one IP is unsafe; require the whole set). `now` injected.

**Exact, tested matching semantics (red-team Findings 5, 6):**
- **Domain:** lowercase; strip exactly one trailing dot; convert to punycode (ASCII) before compare; split on `.` and match on **label boundaries** (never `endsWith`/substring on raw strings). `example.com` matches only `example.com`. `*.example.com` matches `a.example.com`, `a.b.example.com` — **not** the apex `example.com` (needs its own rule) and not `evil-example.com`/`example.com.attacker.com`. `*` is permitted **only** as the leftmost label; reject otherwise.
- **Address:** parse every target IP and every CIDR to a canonical integer form; **map IPv4-mapped-IPv6 (`::ffff:a.b.c.d`) to IPv4** and strip IPv6 zone-ids **before** containment (reuse `validate.ts`'s existing canonicalization — `ipv6ToMappedIPv4`, etc.); integer containment, not string. Excludes evaluated on the normalized address (so a `10.0.0.0/8` exclude catches `::ffff:10.0.0.5`).

### 1.3 `AuthorizedEgressProxy` (`src/main/offensive/egress-proxy.ts`)
A loopback HTTP + HTTPS-CONNECT proxy on `127.0.0.1:<ephemeral>`, started per scan. For **every** request (initial, crawl-discovered, every redirect hop):
1. Extract host; **resolve once** to the full IP set.
2. `decide(manifest, {host, ips}, now())`.
3. **Deny → `403` to the scanner + a `denied` audit event.** **Allow →** dial the upstream using a **fixed-`lookup` agent that returns ONLY one of the just-validated IPs** — *no re-resolution between check and connect* (red-team Finding 1, the critical TOCTOU/rebind fix). Carry the original Host/SNI for TLS. Emit an `allowed` audit event recording the **IP DCS98 actually dialed** (not a scanner claim). Apply the rate limiter (§4).
Redirects: each hop is a fresh resolve-all + decide + pin against **both** host and IP dimensions; deny if either is out of scope (red-team Finding 10). Cross-origin credential strip is inherited from the platform egress rule. Non-HTTP redirects (meta-refresh/JS) are out of audit scope (documented).

### 1.4 `EngagementAudit` (`src/main/offensive/engagement-audit.ts`)
**Not** the case `timeline.json` (red-team Findings 2, 3, 11 — that file is plaintext, full-rewrite O(n²), unsigned). Instead a dedicated **append-only** audit log per engagement under the vault: one JSON line per event, fsync-batched, **hash-chained** (`h_n = SHA-256(h_{n-1} ∥ canonical(event_n))`) with a separately-persisted head pointer, and **each event (or small batch) signed at write time** with a key the scanner subprocess cannot read (reuse the offline/loader trust material; key isolation per §8). Load-time verification detects truncation, reordering, or edits. Structured event type:
```typescript
interface AuditEvent {
  seq: number; prevHash: string;
  manifestId: string; manifestContentHash: string;
  host: string; dialedIp: string; port: number; method: string;  // DCS98-observed facts
  decision: 'allowed' | 'denied'; reason?: string;
  attackType?: string;          // SCANNER-ASSERTED, UNVERIFIED — labeled as such
  at: string;
}
```
A one-line summary of each event is *also* mirrored into the case timeline for the operator's at-a-glance view, but the **audit log is the authority**. Honest completeness statement (carried into §8): the audit is **complete only for traffic that goes through the proxy** and **tamper-evident against the operator/UI and disk-level edits**, not against the scanner deliberately using raw sockets (the accepted malicious-first-party case).

---

## 2. Two-provenance scope model
- **Local-authored (default).** Operator authors a `ScopeManifest` in DCS98 (targets/CIDRs, excludes, mandatory expiry). On save, an `attestation` is recorded and an operator-attestation event is written. Stored in the vault.
- **Signed authorization (optional, policy-gated).** A manifest may be delivered as a signed token. **Distinct signing domain `DCS98-SCOPE-v1`** (red-team Finding 8b — must never collide with the plugin trust root's `DCS98-PLUGIN-v1`). The signed payload binds `{ manifestContentHash, engagementId, issuedAt, nonce, expiresAt }` and is verified with the existing hybrid primitives against a **configured issuer key** (`settings.offensive.issuerKeys`, separate from the plugin trust root). **Anti-replay:** the `(issuerKeyId, nonce)` pair is recorded; reuse is rejected; `engagementId` binds the token to one engagement (red-team Finding 8a). Whether a signature is **required** is `settings.offensive.requireSignedAuthorization` (policy), not a manifest field. If required and absent/invalid/replayed/expired → capability not granted.

---

## 3. Capability wiring
- Add `'authorized-target-egress'` to `CAPABILITIES` (`src/shared/plugin-types.ts`) + a scoped `attackEgress?` surface on `PluginContext`: `{ proxyUrl(): string; scopeContentHash(): string }`. Distinct from `egress`: permits private/loopback, **only** for in-scope targets, **only** through the pinning proxy.
- `wire-deps.ts` builds it **only** when a valid, time-active manifest is loaded and (if policy requires) a valid signed token is present. The plugin spawns the scanner configured to use `proxyUrl()` and **with `NO_PROXY` explicitly cleared/empty in the subprocess env** (red-team Finding 7 — a default `NO_PROXY=localhost` would silently bypass the gate for the loopback targets this exists to hit).

### 3.1 Non-HTTP egress — the honesty boundary (RESOLVED → option A)
A cooperative `HTTP(S)_PROXY` only gates HTTP(S) clients that honor it. deep-eye's **web-vuln engine (the 45+ checks: SQLi/XSS/SSTI/XXE/etc.) is HTTP** and will route through the CONNECT proxy. But its **raw-socket recon** (port scans, raw DNS, banner grabs) and WebSocket modules do **not** honor an HTTP proxy and would egress ungated + unaudited.

**DECISION (operator, 2026-06-10): option A — constrain + disclose.** In the DCS98 integration, **disable deep-eye's raw-socket recon / port-scan / WebSocket modules**; route only its HTTP(S) web-vuln engine, forced through the CONNECT proxy with `NO_PROXY` cleared. Scope + audit then cover **everything the build does**, with no silent bypass. During subsystem-2 integration we **enumerate every deep-eye module by transport** and gate the build to HTTP-only. The authorization UI discloses plainly: "scope + audit cover HTTP(S) attack traffic; raw-socket scanning is disabled in this build." The spec does **not** claim "all attack traffic gated" — it claims "all traffic this build performs is gated," which under option A is the same set.

**Deferred (not v1):** option B — an OS-level jail (Linux netns+nftables / Windows WFP) forcing *all* subprocess TCP (raw scans included) through the gate — is a later increment that would re-enable raw port scanning under full enforcement. It is OS-specific, brittle on Windows, and warrants its own design + red-team. Tracked, not built now.

---

## 4. Authorization moment, Tor, rate-limiting
- **Per-scan confirmation (default):** before each scan, DCS98 shows target(s), `manifestId`, expiry, scope summary, **and the transport-coverage disclosure (§3.1)** → explicit confirm, recorded with the **manifest content hash**.
- **Per-session toggle** (`settings.offensive.confirmMode`): one confirmation covers scans **bound to the active manifest content hash**; **any change to the content hash re-arms** (red-team Finding 9 — bind to content, not `manifestId`). Default `per-scan`.
- **Tor:** opt-out for offense; default **direct-to-target** through the proxy; option chains an external pentest proxy (Burp/ZAP) downstream. Explicit + recorded.
- **Rate-limiting:** enforced at the proxy, configurable req/s (deep-eye doesn't honor its own). Disclosed in the prompt.

---

## 5. Settings (`src/shared/types.ts`)
```typescript
offensive: {
  confirmMode: 'per-scan' | 'per-session';        // default 'per-scan'
  rateLimitPerSec: number;                         // default 10
  downstreamProxy?: string | null;                 // optional Burp/ZAP; default null (direct)
  requireSignedAuthorization: boolean;             // POLICY; default false
  issuerKeys?: { keyId: string; edPubHex: string; pqPubHex: string }[]; // authorized scope signers
};
```
Fail-safe defaults: `per-scan`, no downstream proxy, signatures not required only because no issuer is configured — but **if `requireSignedAuthorization` is true and `issuerKeys` empty, every signed-required manifest is refused** (fail-closed).

---

## 6. Error handling — all fail-CLOSED (red-team Finding 12 — table expanded)

| Condition | Behavior |
|---|---|
| No manifest / expired / `notBefore` not reached | Capability not granted; logged |
| Policy requires signature; absent/invalid/replayed/expired/wrong-issuer | Not granted; logged |
| Target host or any resolved IP out of scope (incl. crawl/redirect/rebind) | Proxy `403` + `denied` event; scan continues against in-scope targets only |
| **Resolver timeout / DNS error mid-request** | **Deny** (can't validate → can't dial) + logged |
| **`decide()` throws / rate-limiter state error** | **Deny** + logged |
| **Audit write fails** | **Deny the request** (no audit → no forward), bounded so it can't wedge the proxy |
| **Wall-clock moves backward during a session** | Session invalidated; re-confirm required (anti clock-rollback) |
| Proxy unreachable/down | Scanner cannot egress (no ungated path *for proxied traffic*; see §3.1 for raw) |
| Malformed manifest | `ScopeManifestError`; not granted |
| Scan confirmation declined | Scan does not start |

---

## 7. Testing
- **`ScopeEnforcer`** (pure): expired / notBefore; exclude-wins; **domain semantics** — apex-vs-wildcard, `evil-example.com` rejected, `example.com.attacker.com` rejected, trailing-dot, punycode/IDN confusable, case; **address semantics** — CIDR containment in/out, **IPv4-mapped-IPv6 exclude catches `::ffff:10.x`**, zone-id stripped, IPv6 CIDR; **multi-IP** — deny if *any* resolved IP out of scope; deny-by-default; injected `now`.
- **`parseScopeManifest`**: rejects missing/past expiry, empty include, bad CIDR/domain, unknown mode, **any asn rule**.
- **Signed path**: valid issuer grants; wrong key / tampered manifest / replayed nonce / wrong engagementId / expired token / `requireSignedAuthorization`-with-no-issuer all refuse; **`DCS98-SCOPE-v1` vs `DCS98-PLUGIN-v1` cross-domain confusion** test (a plugin signature must not validate a scope token and vice-versa).
- **Proxy** (integration, mocked upstream + a controllable resolver): in-scope allowed + `allowed` event recording the dialed IP; out-of-scope `403` + `denied`; **DNS-rebind** — resolver returns in-scope on check-query and out-of-scope on a second query → connection still goes to the pinned validated IP, never the rebound one; multi-IP dual-stack denied if either family out of scope; redirect-to-out-of-scope denied; private/loopback **allowed when in-scope** and **denied when not**; rate limiter caps throughput; `NO_PROXY` cleared in spawned env.
- **`EngagementAudit`**: hash chain verifies; a hand-edited/truncated/reordered log **fails** verification on load; allowed+denied both recorded with DCS98-observed fields; `attackType` flagged unverified.
- **Per-session re-arm**: content-hash change re-arms; backward clock invalidates session.

---

## 8. Security invariants (honest)
- The normal `egress` capability + its SSRF gate are **unchanged**; a plugin without `authorized-target-egress` can never reach private/loopback.
- Enforcement keys on **DCS98-observed facts** (the validated, pinned IP we dialed), not scanner assertions; the only scanner-asserted field (`attackType`) is labeled unverified.
- The audit is **append-only, hash-chained, signed-at-write**, tamper-evident against disk edits and the UI; **complete only for proxied traffic**. Under option §3.1(A), non-HTTP raw scanning is **disabled**, so "proxied traffic" = "the attack surface this build performs." This completeness boundary is stated in code, the spec, and the authorization UI — never overclaimed.
- A deliberately-malicious first-party scanner using raw sockets to bypass the proxy is **explicitly out of model** (the signature is that boundary) and is surfaced, not hidden.
- No telemetry; proxy loopback-only; outbound gated by scope, not the public-only SSRF rule.

---

## 9. Out of scope
- `persistent-background-connection` (Telegram) — separate design.
- A scope-issuing authority service (the signed path *verifies*; issuing is external/product).
- **ASN scope rules** — deferred until the IP-intel (BGP/RIR) dataset exists; v2 rejects them rather than enforce fail-open.
- Option §3.1(B) OS-level jail, unless the operator selects it.
- The OSINT plugin / bundled-scanner integration itself (subsystem 2) — this is the platform capability it targets.
