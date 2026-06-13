# Authorized-target-egress core hardening (Plan 05 prerequisite)

> Remediation of the red-team findings against the already-shipped `src/main/offensive/` egress core,
> done before the deep-eye fold-in builds on top of it. Each finding is grounded against real source.
> TDD; one task per cohesive change; existing per-file test suite extended.

**Posture (operator-locked):** honest cooperative proxy now + WFP confinement as a phase-2 follow-on;
full deep-eye suite bundled but non-HTTP transports inert until WFP (the C1 gate, owned by Plan 05).
All "confined/enforced" language reframed to "proxied-and-audited, not sandboxed."

**In scope here (shipped core):** C2, M2, M3, M4, H1, H3, H4.
**Deferred to Plan 05 (no bundled child yet):** C1 (transport-enumeration build gate), C3-full (separate Tor
instances + forbid private-CIDR-over-Tor downstream), H5 (Job-Object child reaping).

---

## Task A — Audit durability (C2)

**File:** `src/main/offensive/engagement-audit.ts` · **Test:** `test/offensive-engagement-audit.test.ts`

`record()` uses `appendFileSync` (no fsync) and the head pointer is recomputed from the file on construct
(`verifyAuditLog`), so a crash silently truncates the tail and `verifyAuditLog` still returns `ok:true`.

- fsync the append (open a persistent fd or fsync after each `appendFileSync`).
- Persist `headHash` + `seq` to a separate fsync'd sidecar `<path>.head` after each record.
- On construction, cross-check the recomputed head against the sidecar; if they diverge (tail lost/tampered),
  expose it (`truncated: true` on the verify result / throw on load) rather than silently accepting a shorter chain.
- Add optional `resolvedIps?: string[]` to `AuditEvent` (Task D populates it; `JSON.stringify` omits it when
  absent so existing logs/sigs stay valid).

**Tests:** fsync called before record returns; truncating the log is detected on reload; a record with
`resolvedIps` round-trips and verifies; an event without it still verifies (back-compat).

---

## Task B — Scope-manifest hardening (M3 + H3)

**Files:** `src/main/offensive/scope-manifest.ts`, `src/main/offensive/domain-match.ts`
**Tests:** `test/offensive-scope-manifest.test.ts`, `test/offensive-domain-match.test.ts`

- **M3:** `withDefaultExcludes` returns `lab` manifests untouched (`:91`), disabling *all* private/metadata
  excludes. Always inject a non-negotiable **metadata exclude** `169.254.169.254/32` (and `fd00:ec2::254/128`)
  even in lab mode — cloud metadata is never a legitimate lab target.
- **H3:** `DOMAIN_RE` rejects non-ASCII (rules must be `xn--`) and `normalizeHost` returns Unicode for Unicode
  hosts, so a Unicode target never matches a punycode rule. Run both rule values and target hosts through
  `url.domainToASCII` (punycode) before compare; reject only if `domainToASCII` returns empty.

**Tests:** lab manifest still excludes `169.254.169.254`; a Unicode host matches its punycode rule and a
confusable mixed-script host does not silently match; ASCII behaviour unchanged.

---

## Task C — Trusted DNS resolution (H1)

**File:** `src/main/offensive/pin-dial.ts` · **Test:** `test/offensive-pin-dial.test.ts`

`resolveAll` uses `node:dns` getaddrinfo (system resolver) → target names leak to the local/ISP/poisoned
resolver before the scope decision.

- Add a DoH resolver (HTTPS GET to a configurable trusted endpoint, cert-validated) returning the A/AAAA set.
- `resolveAll` uses DoH by default; **fail-closed** on DoH error (do NOT silently fall back to the system
  resolver — that reintroduces the leak). System resolver only via explicit opt-in flag, documented.
- Keep `dialPinned` unchanged (already pins to the resolved IP, no re-resolution).

**Tests:** DoH path parses an A/AAAA set (mock fetch); DoH failure rejects (no system-resolver fallback);
the injectable resolver seam preserved for the existing tests.

---

## Task D — Egress-proxy hardening (M2 + H4)

**File:** `src/main/offensive/egress-proxy.ts` · **Test:** `test/offensive-egress-proxy.test.ts`

- **M2:** `authorize()` returns `ips[0]` and the audit records only the dialed IP. A domain-include allows on
  the *hostname* alone (`scope-enforcer.ts:20`), so a poisoned A-record for a scoped domain → attack a
  poisoner-chosen public IP, audited as the scoped host. Fix: record the **full resolved IP set**
  (`resolvedIps`, the Task-A field) in every audit event, and pin to a resolved IP that itself passes the
  exclude check (never an excluded IP). (The exclude loop already blocks RFC1918; combined with Task C's
  trusted DoH this closes the practical poisoning surface and makes any residual auditable.)
- **H4:** the token-bucket uses `Date.now()` (`:51`) → a forward wall-clock step refills to full. Use a
  **monotonic** clock (`performance.now()`/`process.hrtime`) for refill and clamp negative deltas to 0.

**Tests:** an allowed request's audit carries all resolved IPs; the dialed IP is never one matching an
exclude; a simulated forward clock jump does not over-refill the bucket; rate limiting holds under a
monotonic clock.

---

## Task E — Nonce store + downstream-proxy invariant (M4 + C3-guard)

**File:** `src/main/offensive/engagement-controller.ts` · **Test:** new `test/offensive-engagement-controller.test.ts`

- **M4:** a corrupt `seen-nonces.json` resets the replay set to empty (`:66-70`) → previously-used scope
  tokens replayable (this is fail-**open** for replay, despite the comment). Fix: on corrupt store, **refuse
  to load signed manifests** (fail-closed) until the operator re-attests, rather than silently emptying.
  `persistNonces` → fsync.
- **C3-guard (the part that belongs in core now):** `downstreamProxy` is declared but unused. Add the
  invariant up front: if `settings.downstreamProxy` is set **and** the manifest contains any non-public CIDR
  (RFC1918/loopback/link-local), `loadScope`/`startScan` **refuses** — a private-CIDR target must never be
  routed through a downstream (e.g. Tor) proxy. (Full Tor-instance separation stays in Plan 05.)

**Tests:** corrupt nonce store → `loadScope` with a signed manifest throws (fail-closed); valid store →
token verifies and persists; `downstreamProxy` + a private-CIDR manifest → refused; `downstreamProxy` +
all-public manifest → allowed.

---

## Verification

- `pnpm typecheck` clean; `pnpm test` green (the offensive-* suites extended); `pnpm build` succeeds.
- Re-run the red-teamer on the branch diff to confirm C2/M2/M3/M4/H1/H3/H4 are closed and no regression.
- No behaviour change to the shipped public app (no core plugin holds the `authorized-target-egress` cap).
