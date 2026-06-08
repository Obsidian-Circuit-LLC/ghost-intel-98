# DCS98 chat handshake — construction v3 (IMPLEMENTED at ML-KEM-1024; symbolic model run 2026-06-08)

**Status:** Folds in the full v2 re-gate fix-list. Supersedes v2. **Implemented and shipped** (v3.10–v3.12;
the ML-KEM leg was migrated from the original 768 draft to **ML-KEM-1024** via the AWS-LC sidecar — see the
2026-06-07 operator decision). The ProVerif symbolic model (`../formal/chat-handshake.pv`) was completed and
**run green on 2026-06-08** (ProVerif 2.05); the CryptoVerif computational bound (G2 hybrid IND) remains the
open item. The construction therefore stays labelled EXPERIMENTAL until G2 + external audit land.

> **Parameter note (768 vs 1024 and the proofs).** The migration to ML-KEM-1024 does **not** alter either
> formal model. In the symbolic model ML-KEM is an *ideal* KEM (perfect `encap`/`decap`), so the parameter is
> immaterial. In the computational model the assumption is `IND-CCA(ML-KEM)` for whichever parameter ships;
> 1024 changes only the concrete-security margin (the ε), not the structure of the reduction. The labels below
> read "1024" to match shipped code; no proof step depends on the choice.

## Primitives & notation

X25519 `DH(a,B)`; Ed25519 `Sign/Verify`; ML-KEM-1024 `Encap(K)->(ct,ss)`, `Decap(ct,sk)->ss`;
HMAC-SHA256 `MAC(key,msg)`; HKDF-SHA256. **MixKey (arg roles fixed, crypto-audit H-1):**
`CK ← HKDF(ikm = secret, salt = CK, info = <step-label>, len = 32)` — the new secret is IKM, CK is
salt; this is what makes "secure if EITHER X25519 or ML-KEM survives" hold. Implemented as
`hkdf(secret, CK, label, 32)` against `crypto.ts`'s `hkdf(ikm, salt, info, len)`.

**Domain-separation tags (frozen distinct byte-strings, H-2 / M-1):**
`DS_INVITE`, `DS_PREKEY`, `DS_HS_INIT`, `DS_HS_RESP`, `DS_MAC_T`, and the six MixKey step labels
`MIX_ES, MIX_SSPRE, MIX_EE, MIX_SE, MIX_SSI`, plus derive labels `DRV_HK1, DRV_HK2, DRV_ROOT, DRV_SID`
(all distinct ⇒ `hk1≠hk2≠RK≠SID`, M-Medium).

## Keys

- **Identity (long-term, pinned via TOFU + safety number):** `is` Ed25519, `xs` X25519. **No static
  ML-KEM** (it gave no FS; replaced by prekeys).
- **R's signed KEM prekeys:** each `= (prekey_id, is_last_resort: bool, pk_pre)` with
  `sig_pre = Sign(is_R, DS_PREKEY ‖ suite_id ‖ is_R ‖ prekey_id ‖ is_last_resort ‖ pk_pre)`. A pool of
  one-time prekeys + one rotating last-resort. One-time secrets are deleted on consumption.
- **Per-handshake ephemerals:** I → `xe_I` (X25519) + `ek_I` (ML-KEM-1024). R → `xe_R` (X25519).

## Invite (R self-signs the WHOLE payload — H-6)

`invite = { suite_id, onion, xs_R, is_R, prekey(one-time), sig_invite }`,
`sig_invite = Sign(is_R, DS_INVITE ‖ suite_id ‖ onion ‖ xs_R ‖ is_R ‖ prekey)`, plus the one-time
token `T` (32 random bytes). I verifies `sig_invite` under `is_R` and `sig_pre` before use. This
anchors `onion`/`xs_R`/prekey to `is_R` cryptographically (an invite-channel MITM can no longer swap
`xs_R`); TOFU still pins `is_R` via the human safety number.

## Mode

1-byte `mode ∈ {first_contact=0, reconnect=1}` in Msg1 cleartext, bound into the transcript and
signed (H-5), so R selects the key schedule deterministically (token path only for first_contact).

## Transcript (explicit, ordered; binds KEM pubkeys+ciphertexts, mode, prekey sig)

```
TH0 = H(PROTO_LABEL ‖ suite_id ‖ mode)
TH1 = H(TH0 ‖ "I" ‖ "R" ‖ is_R ‖ xs_R ‖ prekey_id ‖ is_last_resort ‖ pk_pre_R ‖ sig_pre_R
         ‖ xe_I ‖ ek_I ‖ ct_pre)          // all fixed-width fields (widths = crypto.ts constants)
TH2 = H(TH1 ‖ c_idI)
TH3 = H(TH2 ‖ xe_R ‖ ct_I ‖ next_prekey(prekey_id,is_last_resort,pk,sig))
TH4 = H(TH3 ‖ c_confR)
```

## Flow

**Msg1 (I → R):** `mode ‖ suite_id ‖ xe_I ‖ ek_I ‖ prekey_id ‖ ct_pre ‖ mac_T ‖ c_idI`
- `(ct_pre, ss_pre) = Encap(pk_pre_R)`.
- **Token pre-gate (C-1):** `mac_T = MAC(H(T); DS_MAC_T ‖ TH1)` (first_contact only). R verifies
  `mac_T` with **one HMAC, before any asymmetric op** — a wrong/absent token is rejected here, ahead
  of the KEM decap. (Reconnect has no `mac_T`; its DoS surface is bounded because the onion address
  is a capability known only to pinned contacts, plus rate-limit + concurrency cap.)
- Key schedule (token NOT mixed into CK — it's a pre-gate + AAD only):
  `CK = HKDF(ikm = PROTO_LABEL, salt = TH1, info = "init", 32)`; `MixKey(es=DH(xe_I,xs_R), MIX_ES)`;
  `MixKey(ss_pre, MIX_SSPRE)`; `hk1 = HKDF(CK, TH1, DRV_HK1, 32)`.
- `c_idI = AEAD(hk1; nonce0; aad = (first_contact ? H(T) : ∅); {xs_I, is_I, Sig_I})`,
  `Sig_I = Sign(is_I, DS_HS_INIT ‖ TH1)`.
- **R order (verify-before-encap, H-4):** check `mode`/`prekey_id` (reject unknown/consumed) →
  verify `mac_T` (first_contact) → `Decap(ct_pre)` → derive `hk1` → AEAD-open `c_idI` (AAD `H(T)`;
  wrong token also fails here) → verify `Sig_I` over `TH1` → first_contact: **consume `T` + prekey
  atomically and durably (fsync) BEFORE proceeding** / reconnect: verify `{xs_I,is_I}`==pinned (else
  hard-fail). R derives `hk1` from `es` (`xs_R` secret + public `xe_I`) + `ss_pre` (prekey secret) —
  no dependency on I's static ⇒ no circularity. **Only after all checks pass** does R do `Encap(ek_I)`.

**Msg2 (R → I):** `xe_R ‖ ct_I ‖ next_prekey ‖ c_confR`
- `(ct_I, ss_I) = Encap(ek_I)`; `MixKey(ee=DH(xe_R,xe_I), MIX_EE)`; `MixKey(se=DH(xe_R,xs_I), MIX_SE)`;
  `MixKey(ss_I, MIX_SSI)`; `hk2 = HKDF(CK, TH3, DRV_HK2, 32)`.
- `c_confR = AEAD(hk2; nonce0; {Sig_R})`, `Sig_R = Sign(is_R, DS_HS_RESP ‖ TH3)`.
- `next_prekey` = a fresh **one-time** signed prekey when available; if R must hand the last-resort,
  `is_last_resort=true` (signed) so I detects the downgrade (H-3). I verifies `sig` before storing
  (L-1) and refuses to store a last-resort as a one-time (M-4).
- **I:** `Decap(ct_I, ek_I_sk)`; mix; open `c_confR`; verify `Sig_R` over `TH3`; verify
  `is_R/xs_R`==invite/pinned; store `next_prekey`. Zeroize `ek_I_sk`, `xe_I`, `xe_R`.

**Derive:** `RK = HKDF(CK, TH4, DRV_ROOT, 32)`, `SID = HKDF(CK, TH4, DRV_SID, 16)` → `session.ts`.
First session frame from I under `RK` is the implicit I→R key confirmation (R-side "complete" is
PROVISIONAL until that frame — P4; downstream must not act on completion before it).

## Recovery & lifecycle

- **Stale next-prekey (Med-7):** if `prekey_id` is unknown to R (rotation race), R rejects
  `prekey_unknown`; I re-fetches a current one-time prekey (re-uses the invite's prekey or an
  out-of-band refresh) — it MUST NOT silently fall to last-resort.
- **Prekey exhaustion / last-resort:** prefer online top-up; rotation-cap the last-resort; rate-limit
  last-resort use; surface/audit it. FS-degraded sessions are tagged via `is_last_resort` in the
  transcript.
- **Crash durability (C-2):** `T`/prekey consumption is fsync'd (file + parent dir, or a WAL) before
  Msg2; ambiguous state ⇒ treated as consumed (fail-closed). (Implemented in the persistence layer;
  `secure-fs` gains fsync.)

## Security goals (PLAUSIBLE; to be discharged by ProVerif/CryptoVerif)

1. Mutual auth / UKS / KCI — `es`+`se`+domain-separated `Sig_I`(over TH1 incl. `is_R`)+`Sig_R`.
2. Hybrid confidentiality — break needs BOTH X25519 (`es`/`ee`/`se`) AND ML-KEM (`ss_pre`/`ss_I`);
   sound under the fixed MixKey arg roles.
3. Classical FS — `ee` (both ephemeral).
4. PQ FS — one-time prekey (`ss_pre`) + I-ephemeral (`ss_I`); last-resort is the only FS-degraded,
   now detectable + bounded.
5. KEM binding — `ct_pre,ct_I,pk_pre_R,ek_I` all in TH.
6. Replay/DoS — `xe_R`/`ee` freshness; `mac_T` cheap pre-gate; atomic+durable one-time consumption;
   rate-limit; `mode` removes the key-schedule fork.
7. Downgrade — `suite_id`+`mode` in TH0, signed; `is_last_resort` signed.

## Formal-verification scope (production gate)

ProVerif: injective agreement (G1), UKS + KCI (selective key-reveal oracles), replay/no-double-accept
(G6), downgrade (G7), identity-payload secrecy `c_idI` (G2′, the value protected only by `es`+`ss_pre`).
CryptoVerif: IND of `RK` under IND-CCA(ML-KEM) ∨ GapDH(X25519) (G2). FS via phases: corrupt statics +
remaining prekeys after the session; the consumed one-time prekey must be deleted (models C-2); the
last-resort phase query must FAIL (confirming documented FS degradation, not hiding it).

## Implied code changes (when frozen)

`identity.ts`: `IdentityPublic = {ed25519, x25519}`, `IDENTITY_PUBLIC_LEN = 64`; add `KemPrekey`
type + sign/verify. `invite.ts`: whole-invite signature, prekey block, `mode`, `INVITE_VERSION` bump,
recompute lengths, keep strict-canonical decode. Prekey store with durable one-time consumption +
last-resort rotation. `handshake.ts`: the state machine above (verify-before-encap invariant + tests).
`session.ts`: unchanged.
