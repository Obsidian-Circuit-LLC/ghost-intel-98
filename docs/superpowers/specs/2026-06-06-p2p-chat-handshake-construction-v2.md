# DCS98 chat handshake — construction v2 (post-gate, for re-review)

**Status:** REVISED candidate. Re-gate 2026-06-06: **well-formed, all six goals statable** (formalist).
A fix-list (below) must land as v3 before freeze + ProVerif/CryptoVerif. NOT frozen, NOT implemented.

## Re-gate outcome (2026-06-06) — v3 fix-list

All four v1 blockers RESOLVED (circularity gone; transcript enumerated + KEM pubkeys&ciphertexts
bound; token gated; PQ-FS via one-time prekey + I-ephemeral). Remaining fixes for v3 (no criticals in
shipped code):

- **MixKey arg roles (crypto-auditor H-1, must-fix):** specify `MixKey(secret): CK = HKDF(ikm=secret,
  salt=CK, info=step, 32)` — the hybrid "either primitive survives" proof needs the secret as IKM and
  CK as salt. Implement as `hkdf(secret, CK, step, 32)`.
- **Signature domain separation (crypto-auditor H-2, must-fix):** prefix every Ed25519 use with a
  distinct frozen tag — `Sig_I = Sign(is_I, DS_HS_INIT‖TH1)`, `Sig_R = Sign(is_R, DS_HS_RESP‖TH3)`,
  `sig_pre = Sign(is_R, DS_PREKEY‖suite_id‖is_R‖prekey_id‖is_last_resort‖pk_pre)`.
- **Token fast-fail (red-team C-1, must-fix):** `H(T) into CK` does NOT fail before the KEM decap. Add
  a cheap `mac_T = MAC(H(T); suite_id‖xe_I‖ek_I‖prekey_id‖ct_pre)` verified BEFORE any asymmetric op;
  use the token as AEAD AAD (formalist + crypto-auditor preference) rather than mixing into CK.
- **Crash-durable consumption (red-team C-2, must-fix — Stage 3 obligation):** prekey/token
  consumption must `fsync` (file + parent dir, or a WAL) before R emits Msg2; treat ambiguous state as
  consumed (fail-closed). Current `secure-fs.ts` rename has no fsync.
- **Last-resort hardening (red-team H-3 / crypto-auditor M-3,M-4):** prefer online top-up; rotation-cap
  the last-resort; signed `is_last_resort` flag + remaining-count so I detects a forced downgrade;
  rate-limit; surface/audit last-resort use.
- **First-contact vs reconnect mode (red-team H-5, must-fix):** explicit 1-byte `mode` in Msg1, bound
  into TH0/TH1 and signed, so R selects the key schedule deterministically (no try-both DoS / fork).
- **Sign the whole invite (red-team H-6 / crypto-auditor §5):** R self-signs the entire invite
  (onion‖xs_R‖is_R‖prekey‖…) under `is_R`; today only the prekey is signed, so `xs_R` (used in `es`) is
  swappable by an invite-channel MITM, caught only by the human safety number.
- **Verify-before-encap invariant (red-team H-4):** R MUST complete `Sig_I`/token/pin checks before
  `Encap(ek_I)`; freeze as invariant + negative test.
- **Mediums:** enumerate the six `info_step` labels; `hk1≠hk2` info separation; stale-next-prekey
  recovery path that doesn't silently land on last-resort; `safetyNumber` modulo bias.

Formal verification (ProVerif symbolic + CryptoVerif computational, per the §"model scope") remains
the production gate before `handshake.ts`. Implied `identity.ts`/`invite.ts` v2 surgery (drop static
ML-KEM → 64-byte identity; add signed prekey type; version bump) precedes implementation.

--- Supersedes
the v1 draft (`2026-06-05-p2p-chat-handshake-construction.md`, BLOCKED). Must pass a second
adversarial gate and full ProVerif/CryptoVerif verification before `handshake.ts` is written.

## What changed from v1 (and why)

1. **Dropped static-static `ss`** (was circular + unnecessary; IK auth comes from `es`+`se`+sigs).
2. **Identity no longer contains a static ML-KEM key.** Identity = Ed25519 `is` + X25519 `xs` only.
   The KEM is now *ephemeral / prekey*, which is what gives forward secrecy. (Implies an
   `identity.ts` change: `IdentityPublic = {ed25519, x25519}`; ML-KEM moves to a signed-prekey type.)
3. **Signed KEM prekeys for PQ forward secrecy** (operator decision). R publishes signed ephemeral
   ML-KEM prekeys; the invite carries one current signed prekey; each Msg2 hands I the next signed
   prekey for the following session; a signed **last-resort** prekey covers availability when no
   one-time prekey remains (FS degrades only when the last-resort is used — documented).
4. **I sends a fresh ephemeral ML-KEM key per handshake** so the R→I PQ contribution is also FS
   (I is always online, so no prekey needed for I's direction).
5. **Explicit, enumerated transcript** binding every public value INCLUDING KEM public keys AND
   ciphertexts (the PQXDH/USENIX'24 binding requirement) and the prekey signatures.
6. **One-time token bound into the key schedule** so a wrong/absent token fails the AEAD-open of
   Msg1 *before* the costly Ed25519 verify; token consumed atomically on first AEAD-authenticated
   Msg1; handshakes rate-limited + concurrency-capped (DoS).
7. **Key confirmation:** I→R confirmation deferred to the first `session.ts` message (documented); R→I
   confirmation is the AEAD of `c_confR` under the derived key.

## Keys

- **Identity (long-term, pinned):** `is` Ed25519, `xs` X25519. (Onion address owned by transport.)
- **R's KEM prekeys:** ML-KEM-768 keypairs, each public part signed by `is_R`:
  `prekey = (pk_pre, sig_pre = Sign(is_R, "prekey" ‖ pk_pre ‖ prekey_id))`. One-time (consumed) +
  one signed last-resort (reused; FS-degraded when used).
- **Per-handshake ephemerals:** I generates `xe_I` (X25519) and `ek_I` (ML-KEM-768). R generates
  `xe_R` (X25519). R needs no ephemeral KEM (I encapsulates to R's prekey; R encapsulates to `ek_I`).

`MixKey(secret)`: `CK = HKDF(CK, secret, info_step, 32)`. Fixed ordered steps (no map iteration —
determinism). `DH(a,B)=X25519`. `Encap(K)->(ct,ss)`, `Decap(ct,k)->ss` (ML-KEM-768).

## Transcript (explicit, ordered)

```
TH0 = H(PROTO_LABEL ‖ suite_id)
TH1 = H(TH0 ‖ "I" ‖ "R" ‖ is_R ‖ xs_R ‖ pk_pre_R ‖ sig_pre_R ‖ prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre)
TH2 = H(TH1 ‖ c_idI)
TH3 = H(TH2 ‖ xe_R ‖ ct_I ‖ pk_pre_next ‖ sig_pre_next)
TH4 = H(TH3 ‖ c_confR)
```
`is_R, xs_R, pk_pre_R, sig_pre_R` come from the invite, so I's signature over `TH1` binds R's
identity (kills UKS). `ct_pre`, `ct_I` (KEM ciphertexts) and `pk_pre_R`, `ek_I` (KEM public keys) are
all bound (KEM-binding requirement). `suite_id` in `TH0` (downgrade resistance).

## Flow

**Pre:** I has, from the invite: `is_R, xs_R`, one signed prekey `(pk_pre_R, sig_pre_R, prekey_id)`,
and one-time token `T`. I verifies `sig_pre_R` under `is_R` before use.

**Msg1 (I → R):** `suite_id ‖ xe_I ‖ ek_I ‖ prekey_id ‖ ct_pre ‖ c_idI`
- `(ct_pre, ss_pre) = Encap(pk_pre_R)`.
- `CK = TH1`; `MixKey(H(T))` (token-gate — wrong/absent T ⇒ wrong CK ⇒ AEAD fails fast);
  `MixKey(es = DH(xe_I, xs_R))`; `MixKey(ss_pre)`. Derive `hk1`.
- `c_idI = AEAD(hk1; nonce0; {xs_I, is_I, Sig_I})`, `Sig_I = Sign(is_I, TH1)`.
- **R:** look up prekey by `prekey_id` (reject if unknown/consumed); `Decap(ct_pre, sk_pre)`;
  `DH(xs_R, xe_I)`; `MixKey(H(T_pending))`, `MixKey(es)`, `MixKey(ss_pre)` → `hk1`; AEAD-open `c_idI`
  (**fails fast if T wrong — before any signature verify**); verify `Sig_I` over `TH1`; **first
  contact:** consume `T` atomically (single-flight) / **reconnect:** verify `{xs_I, is_I}` == pinned
  (else hard-fail = MITM). R must derive `hk1` from `es` (`xs_R` secret + public `xe_I`) and `ss_pre`
  (prekey secret) — **no dependency on I's static ⇒ no circularity.**

**Msg2 (R → I):** `xe_R ‖ ct_I ‖ pk_pre_next ‖ sig_pre_next ‖ c_confR`
- `(ct_I, ss_I) = Encap(ek_I)`; `MixKey(ee = DH(xe_R, xe_I))`, `MixKey(se = DH(xe_R, xs_I))`,
  `MixKey(ss_I)`. Derive `hk2`; `c_confR = AEAD(hk2; nonce0; {Sig_R})`, `Sig_R = Sign(is_R, TH3)`.
  `pk_pre_next` (signed) is the prekey for the NEXT session (rotation).
- **I:** `Decap(ct_I, ek_I_sk)`; mixes; opens `c_confR`; verifies `Sig_R` over `TH3`; verifies
  `is_R/xs_R` == invite/pinned; stores `pk_pre_next` for next time. Zeroize `ek_I_sk`, ephemerals.

**Derive:** `RK = HKDF(CK, "", "root", 32)`, `SID = HKDF(CK, "", "sid", 16)` → `session.ts`
(I = initiator, R = responder). First session message from I under `RK` is the implicit I→R key
confirmation.

## Security goals (claims for re-review)

1. **Mutual auth / UKS / KCI:** `es`+`se`+`Sig_I`(over TH1 incl. `is_R`)+`Sig_R`(over TH3). KCI: R's
   key compromise can't forge `Sig_I` nor compute `se` (needs `xs_I` or `xe_R` secret).
2. **Hybrid confidentiality:** break requires BOTH X25519 (`es`/`se`/`ee`) AND ML-KEM (`ss_pre`/`ss_I`).
3. **Classical FS:** `ee` (both ephemeral).
4. **PQ FS:** `ss_pre` to a one-time prekey (FS, bounded by prekey rotation/consumption), `ss_I` to I's
   ephemeral (FS). Last-resort prekey is the only FS-degraded path — documented, availability-only.
5. **KEM binding:** `ct_pre`, `ct_I`, `pk_pre_R`, `ek_I` all in TH (PQXDH requirement met).
6. **Replay/DoS:** `xe_R`/`ee` give session freshness; `T` bound + consumed atomically blocks
   first-contact replay/hijack; wrong `T` fails AEAD before the Ed25519 verify; rate-limit +
   concurrency cap; `prekey_id` consumed one-time blocks prekey replay.
7. **Downgrade:** `suite_id` in `TH0`, signed.

## Open items for the re-gate

- Is mixing `H(T)` into `CK` the right token binding, or should `T` be AEAD AAD for `c_idI`? (Both
  give fast-fail; which is cleaner to verify?)
- Last-resort prekey: acceptable availability/FS trade, or require online prekey top-up only?
- Is implicit I→R confirmation (first session msg) acceptable, or add an explicit Msg3 MAC?
- Confirm `se = DH(xe_R, xs_I)` (not a duplicate of `es`) and the full mix order is complete for the
  auth goals.
- ProVerif/CryptoVerif model scope before implementation.

## Implied code changes (when frozen)

`identity.ts`: drop ML-KEM from `IdentityPublic`/`IdentityKeyPair`; add a signed `KemPrekey` type +
generation/verification. `invite.ts`: carry `(pk_pre_R, sig_pre_R, prekey_id)` + `is_R/xs_R` (no
static ML-KEM); recompute `IDENTITY_PUBLIC_LEN`. Prekey store (one-time + last-resort, consumption
state) in the persistence layer. `session.ts` unchanged (still consumes `RK`/`SID`).
