# DCS98 chat handshake — candidate construction (DRAFT, pre-gate)

**Status:** DRAFT — **BLOCKED, must be revised** per the gate review below before implementation.
NOT frozen, NOT implemented.

## Gate review outcome (2026-06-05) — formalist + red-teamer + crypto-auditor

Three independent reviews converged. Headline: as drafted the protocol is **not well-formed / not
implementable**, and even its runnable degenerate form loses two properties the project most needs.
Required changes before `handshake.ts` is written:

**Blocking design fixes:**
1. **Drop the static-static `ss = DH(xs_I, xs_R)` term.** It creates a circular dependency (R needs
   `xs_I` — sealed inside `c_idI` — to derive the key that decrypts `c_idI`). Noise IK gets mutual
   auth from `es` + `se` + signatures; `ss` adds nothing and is also unneeded for KCI. Also remove the
   duplicated `es` mistakenly listed in Msg2. Frozen mix order:
   `Msg1: MixKey(es) → MixKey(ss_R)`; `Msg2: MixKey(ee) → MixKey(se) → MixKey(ss_I)`; then `RK,SID`.
2. **Enumerate the transcript explicitly and bind the KEM public keys AND ciphertexts.** `TH` must
   absorb, in fixed order, `suite_id`, roles, responder statics `(xs_R, ks_R, is_R)` (from invite —
   so I's signature binds R's identity, killing UKS), `xe_I, ct_R`, then `c_idI`, then `xe_R, ks_I,
   ct_I`, then `c_confR`. Binding `ct` **and** `ks` is the exact PQXDH/USENIX'24 finding — mandatory,
   not goal-list aspiration. Pin which `TH` snapshot each signature covers.
3. **Token `T`: bind into the transcript/AEAD and verify early.** Currently `T` sits inside `c_idI`
   and is checked only after R performs an unauthenticated ML-KEM decap + X25519 + Ed25519 verify →
   pre-auth asymmetric-crypto DoS. And "consume on success" is a TOCTOU: a replayed/leaked invite can
   burn the token (denial of legitimate first contact) or complete a first-contact hijack within the
   TOFU window. Fix: fold `H(T)` into `TH`/AEAD AAD so a wrong/absent `T` fails AEAD-open before the
   expensive verify; rate-limit + cap concurrent handshakes; consume `T` atomically (single-flight).
4. **Add explicit key confirmation or document the deferral.** No I→R confirmation exists in the
   2-message flow; either add a MAC over the final `TH` under a `CK`-derived key, or document that
   I→R confirmation is deferred to the first `session.ts` message (acceptable, but state it).

**Operator decision (PQ forward secrecy) — see below.** Both KEM encaps target STATIC keys (`ks_R`
from invite, `ks_I` from identity), so the PQ leg has **no forward secrecy**: a harvested `ct` + later
static-KEM-key compromise recovers the PQ shared secret for every past session — and because Msg1
mixes only static-keyed terms on R's side, static compromise breaks Msg1's *whole* hybrid
confidentiality (including I's "encrypted" identity), not just the PQ dimension. Red-teamer + crypto-
auditor recommend BLOCKING v1 on a signed one-time/short-rotation KEM prekey (PQXDH model); formalist
concurs but defers to the operator. This is the load-bearing decision for the revision.

**Process:** the revised, fully-ordered construction must pass ProVerif/CryptoVerif (per the PQXDH
methodology) before `handshake.ts` is implemented — full formal verification is a production gate.

**Shipped-code fixes (separate from the handshake; actionable now):** add `destroy()`/zeroize to
`IdentityKeyPair` + confront the JWK base64-**string** private-key-copy leak in `crypto.ts` (Node JWK
path copies secrets into immutable V8 strings `zeroize()` can't reach — argues for raw-byte X25519/
Ed25519, e.g. `@noble/curves`); pin `@noble/post-quantum` to exact `0.6.1` (no caret); enforce the
envelope size cap on bytes BEFORE UTF-8 decoding (`session.ts` decodes up to 1 MiB then checks a 16K
cap); normalize invite base64url (strip padding/whitespace) before the strict re-encode check; assert
the three counters (chain/nonce/AAD) are equal + document a per-session rekey cap; reduce
`safetyNumber` modulo bias (low).

---
(Original draft below — retained for the record; supersede per the fixes above.) Anchored on PQXDH/PQ3
(Signal) and the Noise IK pattern; hybridized X25519 + ML-KEM-768. Must pass formalist + red-teamer
+ crypto-auditor review here, and full formal verification (ProVerif/CryptoVerif, per the PQXDH
paper) before production.

## Setting

Interactive, both peers online over a reliable onion TCP stream. **Initiator I** = the invitee who
dials; **Responder R** = the inviter (listener) whose static public keys + onion + a one-time token
`T` are in the invite. After first contact both peers pin each other's statics; reconnects omit `T`
and instead verify transmitted statics against the pinned ones (mismatch ⇒ hard-fail = MITM/key
change).

## Keys

Per party, long-term static: `xs` (X25519), `ks` (ML-KEM-768), `is` (Ed25519). Per handshake,
ephemeral X25519: `xe`. Notation: `DH(a,B)=X25519(a_priv,B_pub)`; `Encap(K)->(ct,ss)`,
`Decap(ct,k_priv)->ss` (ML-KEM-768); `Sig`=Ed25519. `MixKey(secret)`: `CK = HKDF(CK, secret,
info_step, 32)` (Noise-style chaining key). `TH` = running SHA-256 transcript over suite id, roles,
and every public value, in order. Initial `CK = TH = H(PROTO_LABEL ‖ suite_id)` (suite id in the
transcript ⇒ downgrade resistance).

## Flow

**Msg1 (I → R):** `suite_id ‖ xe_I ‖ ct_R ‖ AEAD(c_idI)` where `(ct_R, ss_R) = Encap(ks_R)`.
Mixes before encrypting `c_idI`: `MixKey(DH(xe_I, xs_R))` (es) then `MixKey(ss_R)` (PQ to R). Derive
handshake key `hk1` from `CK`; `c_idI = AEAD(hk1; {xs_I, ks_I, is_I, T?, Sig_I})` with `Sig_I =
Sign(is_I, TH)`. R: `Decap(ct_R,ks_R)`, `DH(xs_R, xe_I)`, mixes identically, decrypts `c_idI`, learns
I's statics, verifies `Sig_I` over `TH`, then **first contact:** verify `T` (one-time, consumed) **/
reconnect:** verify `{xs_I,ks_I,is_I}` == pinned (else hard-fail).

**Msg2 (R → I):** `xe_R ‖ ct_I ‖ AEAD(c_confR)` where `(ct_I, ss_I) = Encap(ks_I)` (R now knows
`ks_I`). Mixes: `MixKey(DH(xe_R, xe_I))` (ee, FS) `MixKey(DH(xs_R, xe_I))`?? **[OPEN: exact se/ss
set — review]** `MixKey(DH(xe_R, xs_I))` (se) `MixKey(ss_I)` (PQ to I). `c_confR = AEAD(hk2; {Sig_R})`,
`Sig_R = Sign(is_R, TH)`. I verifies `Sig_R` and the pinned/announced `xs_R,ks_R,is_R` (from invite).

**Derive:** `RK = HKDF(CK, "", "root", 32)`, `SID = HKDF(CK, "", "sid", 16)` → handed to `session.ts`
(I = initiator role, R = responder role).

## Candidate mix set (the crux to review)

Classical (Noise-IK-like, mutual auth): `es = DH(xe_I, xs_R)`, `ss = DH(xs_I, xs_R)`,
`ee = DH(xe_I, xe_R)`, `se = DH(xs_I, xe_R)`. PQ: `ss_R = Encap(ks_R)`, `ss_I = Encap(ks_I)`.
**[OPEN: is `ss` mixed in Msg1 (requires R to have I's static first → it's inside `c_idI`, so `ss`
can only be mixed AFTER decrypting I's identity — ordering needs care). Review the exact ordering and
whether all four DH terms + both KEM terms are present and transcript-bound.]**

## Security goals (to be checked / refuted)

1. Mutual authentication (static keys + Sig over full TH incl. both identities → resists UKS/identity
   misbinding).
2. **Hybrid confidentiality:** compromise requires breaking BOTH X25519 (es/ss/ee/se) AND ML-KEM
   (ss_R/ss_I).
3. Classical forward secrecy via ephemerals (ee/se/es).
4. **Known limitation to confirm:** the PQ leg uses encapsulation to *static* KEM keys (no ephemeral
   KEM), so it is **not** forward-secret in the PQ dimension — harvested `ct_R`/`ct_I` + later static
   KEM-key compromise reveals `ss_R`/`ss_I`. (PQXDH mitigates via signed/one-time KEM prekeys.) Decide:
   accept for v1 + document, or add an ephemeral KEM prekey.
5. KEM **binding** property (PQXDH/USENIX'24): bind `ct` and the KEM public key into `TH`.
6. Replay: R's `xe_R` + `ee` give session freshness; one-time `T` blocks first-contact replay. Confirm
   msg1 replay can't establish a session or be used as an oracle.
7. Downgrade resistance: `suite_id` in `TH`.
8. KCI resistance; key-compromise impersonation.
9. Identity payload confidentiality (I's static identity is encrypted, à la Noise IK) — is the key it's
   encrypted under derived only from secrets an active MITM can't produce?

## Questions for reviewers

- Is the mix set complete and correctly ORDERED for mutual auth + hybrid confidentiality? Any missing
  DH/KEM term, or any term that can't be computed at the point it's needed (e.g., `ss` before R learns
  I's static)?
- Any replay / reflection / UKS / KCI / downgrade attack?
- Is the KEM binding handled (ct + pubkey in transcript)?
- Is the PQ-no-FS limitation acceptable for v1, or is an ephemeral KEM prekey required?
- Is the signature-over-transcript sufficient, or is a key-confirmation MAC also needed?
