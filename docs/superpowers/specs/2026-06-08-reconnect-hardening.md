# DCS98 chat — reconnect-hardening spec (v4 of the handshake)

**Status:** DESIGN / FREEZE CANDIDATE — pending formal re-verification + operator sign-off. Refines the
v3 construction (`2026-06-06-p2p-chat-handshake-construction-v3.md`); supersedes its reconnect mode.
NOT yet implemented.

## Context — why this exists

The internal adversarial audit (`../formal/internal-audit-2026-06-08.md`) and the formal kit left three
reconnect-specific gaps that the shipped v3 first_contact path does not have:

- **HIGH-1 (real, reachable): reconnect-prekey strand → permanent lockout.** Dial-on-demand reconnect
  (`engine.ts:131,155`) burns the responder's one-time prekey: R durably `consume()`s it
  (`handshake.ts:287`) before sending Msg2. If the stream drops before the initiator receives Msg2 (and
  persists the new rotation prekey), I keeps presenting the now-consumed `nextPrekey`; R answers
  `unknown or consumed prekey` and closes. Because the initiator only sees a generic "stream closed,"
  there is no in-band recovery — the contact is unreachable until a **fresh out-of-band invite**.
- **MED-2 (a): reconnect has no cheap DoS pre-gate.** The `mac_T` token gate is first_contact-only, so a
  forged reconnect Msg1 forces a full ML-KEM decap + two X25519 ECDHs (and head-of-line-blocks the
  serialized sidecar) before the identity check can reject it.
- **MED-2 (b): reconnect mode is covered by NO formal model.** Every `.pv`/`.cv` is first_contact only;
  the downgrade claim (mode in TH0, signed) is asserted but never exercised with `mode = reconnect`.

The v3 spec already *anticipated* the recovery (Med-7: "R rejects `prekey_unknown`; I re-fetches a
current one-time prekey … MUST NOT silently fall to last-resort") but left it unspecified and
unimplemented. This spec makes it concrete, adds the pre-gate, and brings reconnect under proof.

## Definition of done

Reconnect is **self-healing** (a consumed/stale rotation prekey recovers in-band, no fresh invite
needed), **DoS-pre-gated** (a forged reconnect Msg1 is rejected by one HMAC before any asymmetric op),
**downgrade-safe** (no silent first_contact↔reconnect or one-time↔last-resort coercion; a forged
rejection cannot redirect I), and **formally re-verified** (ProVerif reconnect run + CryptoVerif
assumptions extended); `SUITE_ID`→v4; typecheck + full suite green incl. new reconnect/recovery/pre-gate
tests; the engine no longer hard-fails reconnect on a consumed prekey.

## Design

### 1. Message-type tag on the responder→initiator handshake message (wire change)

Today Msg2 is positional with no discriminant. To let R answer Msg1 with either **Msg2** (accept) or a
**Reject** (recover), prepend a 1-byte `hs_type ∈ {MSG2 = 0, REJECT = 1}` to every responder→initiator
handshake payload. Bound into the transcript so it can't be flipped (see §4). Msg1 is unchanged in
shape except for the reconnect pre-gate field (§3).

### 2. In-band recovery: authenticated `prekey_unknown` rejection + bounded retry (fixes HIGH-1)

When R cannot resolve the presented `prekey_id` (unknown or already consumed) on a `reconnect` Msg1
**after** the pre-gate (§3) passes:

- R does NOT close. R selects a **current prekey** to offer: a fresh one-time prekey from the pool
  (preferred), or the rotating last-resort iff the pool is exhausted (`is_last_resort = true`, signed).
- R sends `Reject = hs_type(REJECT) ‖ offered_prekey(signed) ‖ Sig_R_reject`, where
  `Sig_R_reject = Sign(is_R, DS_HS_REJECT ‖ TH1 ‖ offered_prekey)`. The signature binds the rejection to
  *this* exchange (TH1) and to the offered prekey, so it cannot be forged, replayed onto another session,
  or used to redirect I to an attacker-chosen prekey.
- R discards this aborted attempt (no state consumed — the pre-gate already proved liveness; the offered
  prekey is only *consumed* if I completes a handshake against it).
- **I**, on a valid `Reject` (verify `Sig_R_reject` under the pinned `is_R`; verify `offered_prekey`'s own
  prekey signature; **refuse to store/continue on a last-resort unless I opts into FS-degraded** — surfaces
  H-3), retries the handshake **once** with the offered prekey (fresh `xe_I`, `ek_I`, `ct_pre`). One
  retry only (a second `Reject` is a hard fail → fall back to surfacing "ask for a fresh invite").
- On the retry's success, I persists the Msg2 `next_prekey` as usual. **Because R always has a current
  prekey to offer, the lockout cannot become permanent**: a stale `nextPrekey` self-heals in-band. This
  is the load-bearing fix for HIGH-1.

### 3. Reconnect DoS pre-gate `mac_R` (fixes MED-2a)

Reconnect's analogue of `mac_T`, keyed by a secret **both pinned peers already share from the prior
session** (no token needed):

- At **first_contact** completion, both sides derive + persist a per-contact **reconnect gate key**
  `RGK = HKDF(RK, SID, "dcs98-chat/reconnect-gate/v4", 32)` from that session. Stored in the contact row,
  encrypted at rest.
- Reconnect Msg1 carries `mac_R = HMAC(RGK, DS_MAC_R ‖ TH0 ‖ prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre)`. R
  verifies it with **one HMAC before any asymmetric op or prekey lookup**, bounding the asymmetric-work +
  sidecar-HOL DoS. **It is keyed over the Msg1 CLEARTEXT fields, NOT over TH1** — deliberately: TH1 binds
  R's prekey block, which is unavailable in the strand-recovery case (the prekey is consumed/gone), and
  the gate must run before R touches the prekey at all. The full transcript binding (incl. the prekey) is
  still provided by the signatures over TH1/TH3 later; `mac_R` is only the cheap DoS gate, so binding the
  Msg1 cleartext (which already fixes xe_I/ek_I/ct_pre/prekey_id/mode) is sufficient for its job.
- **RGK is STABLE (derived once at first_contact), NOT rotated per reconnect.** Rationale: a per-reconnect
  rotation desyncs on a half-completed reconnect (R rotates, I doesn't) → I's `mac_R` fails the gate → a
  *new* lockout, defeating the purpose. Both sides always agree on the first_contact RGK, so a stable key
  cannot desync. Security cost is acceptable: `mac_R` is NOT auth/confidentiality — only a cheap DoS gate
  (the signatures + chain still provide auth/secrecy). A leaked RGK lets an attacker pass only the gate
  (do asymmetric-work DoS), never authenticate. If stronger rotation is later wanted, rotate only on a
  *both-sides-confirmed* success (e.g. after the first post-reconnect app-ack), never on handshake
  completion alone.
- `mac_R` is NOT a key-confirmation or auth mechanism — it is only a cheap liveness/DoS gate, exactly as
  `mac_T` is for first_contact. **Gate failure ⇒ a different, cheap close** (not the recovery Reject of
  §2, which is reserved for a pre-gate-*authenticated* peer whose prekey is merely stale).

**Contact identification before asymmetric work (the keying chicken-and-egg).** `mac_R` is keyed per
contact (RGK), but R learns the peer identity only by decrypting `c_idI` (asymmetric). Like first_contact
(where `mac_T` is found via the cleartext `prekey_id` → prekey→token), R resolves the contact from the
**cleartext `prekey_id`**: when R mints a reconnect rotation prekey (`issueNext` during a handshake, where
R already knows the peer `cid`), it records a **non-secret issuance index** `prekey_id → cid`, retained
even after the one-time *secret* is FS-deleted on consume. On a reconnect Msg1, R resolves `prekey_id →
cid → RGK` from this index and verifies `mac_R` before any asymmetric op — and crucially this **still
works in the strand case** (secret consumed, index retained), so R can authenticate the stale-prekey peer
and send the recovery Reject. A truly unknown `prekey_id` (not in the index) can't be gated or identified
→ cheap close. Privacy: `prekey_id` is already cleartext in v3 Msg1 and R issues a fresh one each
reconnect, so there's no new cross-reconnect linkability (only a strand's own retries reuse one id,
bounded by the retry cap). The index is local + encrypted at rest, capped/TTL'd.

### 4. Transcript + downgrade (extends v3 H-5/H-3/G7)

`TH0 = H(PROTO ‖ suite_id ‖ mode)` (unchanged — binds mode). `hs_type` (§1) is folded into the responder
message's signed transcript: Msg2's `Sig_R` covers `DS_HS_RESP ‖ TH3` where TH3 now includes
`hs_type(MSG2)`; the Reject's `Sig_R_reject` covers `hs_type(REJECT)` implicitly via `DS_HS_REJECT`. The
two distinct DS prefixes (`DS_HS_RESP` vs `DS_HS_REJECT`) keep an accept and a reject from being
substituted for one another. `is_last_resort` stays signed (H-3) so a forced last-resort offer is
detectable on the retry.

### 5. Versioning

`SUITE_ID → dcs98-chat/v4/x25519+mlkem1024+ed25519`; new labels `DS_HS_REJECT`, `DS_MAC_R`,
`RECONNECT_GATE`. v3 reconnect interop is dropped (off-by-default beta; first_contact across versions is
unaffected since suite_id mismatch fails closed by design). `INVITE_VERSION` unchanged (invites are
first_contact only).

## Security goals (to be DISCHARGED, not assumed)

1. **Reconnect mutual auth / UKS / KCI** — same as first_contact (signatures over the transcript; pinned
   statics on reconnect). Must hold with `mode = reconnect`.
2. **Recovery soundness** — a `Reject` cannot (a) be forged/replayed by a network attacker (Sig_R_reject
   bound to TH1+offered_prekey under pinned is_R), (b) redirect I to an attacker-chosen prekey, or (c) be
   used to silently downgrade I to last-resort (is_last_resort signed + I-side policy).
3. **No new strand / no double-accept** — the offered prekey is consumed only on a completed retry; the
   reject path consumes nothing; one-retry cap prevents loops. R-auth-I injectivity preserved (single-use
   consumption unchanged for the prekey actually used).
4. **DoS pre-gate** — a party without the prior session's RGK cannot pass `mac_R`; forged reconnect Msg1
   rejected before asymmetric work. (PRF/SUF-CMA on HMAC.)
5. **Downgrade (G7)** — `mode` + `suite_id` in TH0 signed; `hs_type` bound; `is_last_resort` signed.

## Formal-verification scope (MED-2b + verifies HIGH-1 fix)

- **ProVerif** (`chat-handshake.pv` → add a reconnect variant): `mode = reconnect`, pinned-static hard
  check (no TOFU pin), `mac_R` pre-gate, the Reject/retry branch. Re-assert: injective agreement both
  directions, downgrade (no mode/last-resort/hs_type coercion), recovery soundness (a forged Reject can't
  make I complete with an attacker prekey), no-double-accept.
- **CryptoVerif**: the reconnect key schedule is the *same* chain (es/ee/se/ss_pre/ss_I), so the existing
  hybrid-secrecy / auth / KCI / FS proofs transfer; **add** the `mac_R` gate under a PRF/SUF-CMA-MAC
  assumption and model the Reject branch's signature (UF-CMA, already assumed). Confirm RGK secrecy
  (derived from the proven-secret RK by a ROM step).

## Implied code changes

- `constants.ts`: `SUITE_ID` v4; `DS_HS_REJECT`, `DS_MAC_R`, `RECONNECT_GATE` labels.
- `wire.ts` / `handshake.ts`: `hs_type` tag on the responder message; `mac_R` gen (initiator) + verify
  (responder, before asymmetric ops); the Reject emit (responder) + verify/retry-once (initiator);
  thread `RGK` in.
- `prekey-store.ts`: `offerCurrent()` → a fresh one-time prekey (or signed last-resort if exhausted) for
  the Reject, WITHOUT consuming anything.
- `session.ts` / `contact-store.ts`: derive `RGK` from RK/SID at handshake completion; persist + rotate
  per contact (encrypted).
- `engine.ts`: reconnect retry orchestration; on a final hard-fail, surface a clear, actionable status
  ("reconnect link expired — request a fresh invite") instead of a generic throw.
- Formal: the ProVerif reconnect variant + CryptoVerif MAC assumption; update
  `model-code-correspondence.md`.

## Verification

- Unit/integration: reconnect happy-path; **strand-recovery** (consume the stored prekey, drop, reconnect
  → Reject → retry → success, no fresh invite) — this is the HIGH-1 regression test; `mac_R` rejects a
  forged/stale reconnect Msg1 before asymmetric work; forged-`Reject` rejected; last-resort offer
  surfaced not silent; one-retry cap (second Reject hard-fails); downgrade attempts rejected.
- `pnpm typecheck` + full `pnpm test` green. ProVerif reconnect run + CryptoVerif re-run all green.
- Charter: no new egress; RGK encrypted at rest; deterministic.

## Open questions for the operator

1. **Last-resort on recovery:** when the one-time pool is exhausted, should the Reject offer the
   FS-degraded last-resort (auto, surfaced) or refuse and require a fresh invite (stricter FS, worse
   availability)? Spec default: offer last-resort, flagged + surfaced (availability-leaning), per v3's
   stance — but v3's Med-7 also says "MUST NOT silently fall to last-resort," so the surfacing is
   mandatory either way.
2. **Retry cap:** one retry (spec default) vs a small N. One is simplest and bounds loops; N tolerates a
   pool-rotation race but widens the surface.
3. **RGK lifetime:** the spec now defaults to a **stable** RGK from first_contact (rotation desyncs and
   reintroduces a lockout — see §3). If you want rotation for stronger DoS-gate hygiene, it must key off a
   *both-sides-confirmed* success (post-reconnect app-ack), not handshake completion. Confirm the stable
   default is acceptable, or specify the confirmed-rotation trigger.
