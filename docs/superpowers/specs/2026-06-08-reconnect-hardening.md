# DCS98 chat — reconnect-hardening spec (v4 of the handshake)

**Status:** DESIGN / FREEZE CANDIDATE — **rev 4** (post-third-adversarial-review). Pending formal
re-verification + operator sign-off. Refines the v3 construction
(`2026-06-06-p2p-chat-handshake-construction-v3.md`); supersedes its reconnect mode. NOT yet implemented.

**Rev 2 (2026-06-09) — first review pass:** F-1 `offerCurrent` re-offers the pending prekey instead of
minting per Reject + per-cid mint rate-limit (§2); F-3 v3→v4 migration is **lazy RGK establishment** (no
persisted RK to backfill from) with R-state-driven gating (§3, §6); F-5 `Sig_R_reject` binds `TH_R0`
(Msg1-cleartext) not `TH1` (§2, §4); F-8 DoS claim split into provable-qualitative-gate + engineering
rate-limit, engine gaps made explicit. ProVerif Reject branch modelled before the Reject code.

**Rev 3 (2026-06-09) — second review pass (crypto-auditor + skeptic CONVERGED):** the `prekey_id → cid`
issuance index must be **per-contact bounded with the most-recent id pinned**, never a global
oldest-evicting cap — else a quiet v4-established contact is silently demoted to ungated + unrecoverable
and an attacker gets an eviction lever (goal 7, §3). The no-mint-churn property rests on the **per-`cid`
bucket, not on cross-dial idempotency** (which does not hold) (§2, goal 3). The ungated-path rate-limit is
**split** into a reserved store-resolvable bucket + a tighter unresolvable bucket (N-3, §3). Plus
fixed-width framing (N-1), clock-free rate-limit (N-4), `PROTO_LABEL` stays v3 (N-5), anti-redirect
rationale (N-2). *(Rev 3 also introduced an app-ack gating-activation that rev 4 had to replace — see
below.)*

**Rev 4 (2026-06-09) — third review pass (crypto-auditor + skeptic CONVERGED AGAIN, on rev-3's own
fix):** rev-3's "gating-active on a both-sides app-ack" was itself asymmetric — R observes I's inbound
message, I observes R's returning ack one round-trip later, so a dropped ack leaves R enforcing against a
keyless I (the §6(c) lockout relocated, not closed — two-generals). **Replaced with an ENFORCEMENT
BOOTSTRAP:** RGK is deterministically derived by both sides (no exchange needed); I always *sends* `mac_R`
once it holds RGK; **R enforces `mac_R` only after directly verifying one valid `mac_R` from the contact**
(`rgkPeerConfirmed`), failing open until then. The confirming event is R's own verification — not a
droppable round-trip — so there is no R-leads-I asymmetry, an attacker can't forge a `mac_R` to force
premature enforcement, and suppressing `mac_R` only keeps the contact on the rate-limited ungated path,
never a lockout (§3, §6, goals 4–6). Also: the per-contact index **`recent[]` retention bound must be ≥
the per-`cid` mint cap** (pinning only `current` is insufficient — an older outstanding id can still be
held by I; goal 7, open-q 4/5 coupled); the reserved rate-limit bucket gets **per-Msg1 dedup** + a
**no-last-resort-id-on-reconnect** assert, and its prior consumption-bound claim is corrected (on-path
replay residual is operator-accepted, bounded + monotonically shrinking) (N-3, §3).

**Rev 4 review outcome (2026-06-09):** both independent reviewers cleared it — crypto-auditor
**READY-TO-BUILD** (enforcement bootstrap sound across all five adversarial probes; N-3 closed; goal-7
coupling adequate), skeptic **HONEST-ENOUGH-TO-BUILD** (prior finding closed *not relocated*; no
overclaim; bootstrap assumption sound + stated). The only carried items were two **build-time**
guard-rails, now folded in: the epoch-bound `rgkPeerConfirmed` invariant + its test (§3, Verification),
and the dedup-seen-set sizing constraint (open-q #4). No further design rev required; the remaining gates
are the formal re-verification (Phase 4 of the plan) and operator sign-off.

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

Reconnect is **self-healing for v4-established contacts** (a consumed/stale rotation prekey recovers
in-band, no fresh invite; legacy contacts inherit this after one establishing v4 handshake — §6),
**DoS-gated** (a forged reconnect Msg1 against a confirmed-enforcing contact is rejected by one HMAC
before any asymmetric op; legacy/unknown traffic bounded by a split, deduped rate-limit that a *garbage*
flood cannot use to freeze migrations, with an honestly-scoped on-path replay residual — §3),
**downgrade-safe** (no silent first_contact↔reconnect, one-time↔last-resort, accept↔reject, or
gated↔ungated coercion — incl. no index-eviction downgrade lever; a forged or replayed rejection cannot
redirect I), **migration-safe** (lazy RGK establishment with an **enforcement bootstrap** — R enforces
only after directly verifying one `mac_R`, no droppable round-trip — causes no mass lockout, no exploitable
downgrade, and no worse-than-HIGH-1 strand lockout; §6), and **formally re-verified** (ProVerif reconnect
run with the Reject branch modelled first + CryptoVerif assumptions extended); `SUITE_ID`→v4; the
**issuance index is per-contact bounded with `recent[]` ≥ mint cap** (goal 7), the engine **persists
`RGK`, sets `rgkPeerConfirmed` on the first valid `mac_R` verify, and calls `issueNext(cid)`** so the gate
actually functions; typecheck + full suite green incl. new reconnect/recovery/pre-gate/migration/
bootstrap/index-retention/split-rate-limit tests; the engine no longer hard-fails reconnect on a consumed
prekey.

## Design

### 1. Message-type tag on the responder→initiator handshake message (wire change)

Today Msg2 is positional with no discriminant. To let R answer Msg1 with either **Msg2** (accept) or a
**Reject** (recover), prepend a 1-byte `hs_type ∈ {MSG2 = 0, REJECT = 1}` to every responder→initiator
handshake payload. Bound into the transcript so it can't be flipped (see §4). Msg1 is unchanged in
shape except for the reconnect pre-gate field (§3).

### 2. In-band recovery: authenticated `prekey_unknown` rejection + bounded retry (fixes HIGH-1)

When R, on a `reconnect` Msg1 whose `prekey_id` it can **identify as one it issued to this contact**
(via the issuance index, §3) but cannot **resolve to a live secret** (already consumed / stale) **after**
the pre-gate (§3) passes:

- R does NOT close. R selects a **current prekey** to offer via `offerCurrent(cid)`:
  - **Re-offer FIRST, mint only when none (fixes F-1).** `offerCurrent` **first** returns the contact's
    **newest already-issued, still-unconsumed one-time prekey** (typically the very rotation prekey R
    minted in the prior aborted Msg2 — the one I never received), looked up through the per-contact
    issuance index (§3); it mints a **new** one-time prekey **only when the contact has no unconsumed
    issued prekey at all**. It does **NOT** itself throw on a per-cid count cap — re-offer must never be
    refused when an unconsumed prekey exists, else a legitimate stranded peer at a high outstanding count
    is denied recovery (the rev-4 §2-fidelity correction to the earlier cap-first ordering). This re-offer
    is idempotent across the retries *within a single dial* that did not reach R's `issueNext`; across
    multiple dials a fresh mint can occur (a dial whose retry itself strands), so churn is bounded **not**
    by an in-store throw but by three composed limits: (i) re-offer-first caps each cid to **≤1
    offerCurrent-minted outstanding prekey** at a time (the next call re-offers it, no new mint until it is
    consumed); (ii) the **per-dial responder reject cap** (§2 / Task 2.4: at most a small fixed number of
    Rejects — hence offerCurrent calls — per dial); and (iii) the **global ungated-path rate-limit** (§3 /
    Task 2.5) bounding how often a reconnect (hence offerCurrent) can be reached across dials. The per-cid
    mint *frequency* therefore lives at the rate-limiter (Task 2.5) + the per-dial cap, not as an
    outstanding-count throw inside the store. **Dependency:** this lookup only works if F-8's
    `issueNext(cid)` populates the per-contact index (so the pending rotation maps to this `cid`); F-1 and
    F-8 land together.
  - When the one-time pool is genuinely exhausted, offer the rotating last-resort (`is_last_resort =
    true`, signed) — surfaced to I per H-3, never silent.
- R sends `Reject = hs_type(REJECT) ‖ offered_prekey(signed) ‖ is_last_resort ‖ Sig_R_reject`, where
  `Sig_R_reject = Sign(is_R, DS_HS_REJECT ‖ TH_R0 ‖ offered_prekey ‖ is_last_resort)` and
  **`TH_R0 = H(MIX_INIT ‖ TH0 ‖ prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre)` is the Msg1-CLEARTEXT transcript** —
  the same fields `mac_R` covers, **deliberately NOT `TH1`** (fixes F-5: TH1 binds R's prekey block,
  which is consumed/gone in the strand case, so a TH1-bound reject is uncomputable exactly when it is most
  needed; `TH_R0` is computable by both sides from Msg1 alone). The signature binds the rejection to
  *this* Msg1 (anti-replay), to the offered prekey (anti-redirect), and to the last-resort flag
  (anti-downgrade), under the pinned `is_R`, so it cannot be forged, replayed onto another exchange, used
  to redirect I to an attacker-chosen prekey, or used to silently coerce a last-resort.
- R discards this aborted attempt (no state consumed — the pre-gate already proved liveness; the offered
  prekey is only *consumed* if I completes a handshake against it).
- **I**, on a valid `Reject` (verify `Sig_R_reject` over the reconstructed `TH_R0` under the pinned
  `is_R`; verify `offered_prekey`'s own prekey signature; **refuse to store/continue on a last-resort
  unless I opts into FS-degraded** — surfaces H-3), retries the handshake **once per dial** with the
  offered prekey (fresh `xe_I`, `ek_I`, `ct_pre`). The cap is **one retry per connection attempt**: a
  second `Reject` within the same dial is a hard fail → surface "ask for a fresh invite." It is NOT a
  per-contact-lifetime cap — a later fresh dial re-enters recovery from the top (so a retry that itself
  drops is recovered by the next dial, not permanently lost).
- On the retry's success, I persists the Msg2 `next_prekey` as usual. **Because R always has a current
  prekey to offer (the pending rotation, else a minted/last-resort one), the lockout cannot become
  permanent for a v4-established contact**: a stale `nextPrekey` self-heals in-band. This is the
  load-bearing fix for HIGH-1. (Legacy v3 contacts reach this self-heal only after their first successful
  v4 handshake establishes the gate + index — see §6.)

### 3. Reconnect DoS pre-gate `mac_R` (fixes MED-2a)

Reconnect's analogue of `mac_T`, keyed by a secret **both pinned peers already share from the prior
session** (no token needed):

- At a successful handshake's completion, both sides derive + persist a per-contact **reconnect gate key**
  `RGK = HKDF(RK, SID, "dcs98-chat/reconnect-gate/v4", 32)` from that session. Stored in the contact row,
  encrypted at rest.
- **ENFORCEMENT BOOTSTRAP: R requires `mac_R` for a contact only after it has observed one VALID `mac_R`
  from that contact; it fails OPEN until then (fixes the rev-2 §6(c) lockout AND the rev-3 app-ack
  asymmetry — the convergent rev-3 finding).** RGK is *deterministically derived* by both sides from the
  shared RK/SID at handshake completion, so no exchange is needed to agree on its value; what must be
  bootstrapped is only *when R starts enforcing*. The rule, designed so the **enforcer (R) activates LAST
  and the gate fails open under any uncertainty**:
  - **I** always includes `mac_R` on a reconnect Msg1 as soon as it holds an RGK for the contact (it
    derived + persisted RGK at the prior handshake's completion). Sending it is cheap and harmless even
    before R enforces.
  - **R** keeps a per-contact `rgkPeerConfirmed` flag, set the **first time R verifies a valid `mac_R`**
    from that `cid` (positive proof that I holds the gate key). While `rgkPeerConfirmed` is false, R does
    **not** require `mac_R` — it takes the ungated (rate-limited) path even though it holds an RGK; if a
    `mac_R` is present it verifies it cheaply and, on success, sets the flag. Once `rgkPeerConfirmed` is
    true, R **requires** a valid `mac_R` before any asymmetric op (the gate of §3).
  - Why this is lockout-free: R never enforces against a peer it hasn't already seen pass the gate, so the
    rev-2 §6(c) "gated-against-a-keyless-I" case cannot arise (a mid-handshake strand leaves R
    *unconfirmed* → ungated next dial). And unlike the rev-3 app-ack, the confirming event (`mac_R`
    verification) is observed **directly by the enforcer itself**, not inferred from a droppable
    round-trip, so there is no R-leads-I asymmetry: the rev-3 hole is closed, not relocated.
  - Why an attacker can't weaponize it: a valid `mac_R` requires RGK (HMAC SUF-CMA), which only the real I
    and R hold, so an attacker can neither forge a `mac_R` to push R into premature enforcement against the
    real I, nor strip `mac_R` to gain anything (stripping just keeps the contact on the ungated,
    rate-limited path = v3 behaviour, never a lockout). Suppressing all of I's `mac_R`-bearing Msg1s is
    indistinguishable from blocking the connection outright — not a gate-specific vector.
  - `rgkPeerConfirmed` SHOULD persist (encrypted, in the contact row) for gate continuity across restarts,
    but losing it is *safe*: R simply re-bootstraps (fails open until it next sees a valid `mac_R`).
  - **`rgkPeerConfirmed` is EPOCH-BOUND, not cid-bound — code invariant (both rev-3 reviewers).** It MUST
    be cleared atomically with any RGK change (a fresh first_contact re-pin → new RK/SID → new RGK epoch).
    The bootstrap's lockout-freedom rests on R never enforcing a `mac_R` under an epoch I might not yet
    hold; since both sides derive a new epoch's RGK at the *same* re-pin handshake completion, clearing the
    flag on the RGK write guarantees R re-confirms under the new epoch before enforcing it. If a future
    change ever rotated RGK (deferred — open-q #3) while leaving the flag set, it would reopen exactly the
    lockout this design closes — hence the invariant is stated here and tested (Verification).
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
bounded by the retry cap). The index is local + encrypted at rest.

**The index must be PER-CONTACT bounded, never a global oldest-evicting cap (fixes the rev-2 convergent
finding).** Both the DoS gate (this §) and in-band recovery (§2) gate on `prekey_id → cid` resolution
succeeding; if a *v4-established* contact's relevant `prekey_id` is evicted, that contact silently (a)
falls to the ungated asymmetric path despite holding a valid RGK — breaking goal 4's "v4-established"
guarantee — and (b) loses in-band strand recovery, regressing to HIGH-1. Worse, an attacker who can
induce ~`GLOBAL_CAP` issuances (each completed handshake's `issueNext`, each recovery `offerCurrent`)
across the contact set can *drive* eviction of a chosen quiet contact's entry, then hit it on the ungated
path — an eviction lever the threat model must not grant. The shipped `prekey-store.ts` index is exactly
this hazard: a single global `ISSUED_CAP = 256` map, oldest-evicted by `trimIssued`. **Required change:**
re-key the index per `cid` and guarantee that **every still-resolvable id a peer might legitimately
present is retained as long as the contact exists** (e.g. `issued: Record<cid, { current: pid; recent:
pid[] }>`, `current` pinned, only the bounded `recent[]` tail trimmed per-cid). Then no contact's churn
can evict another's resolution, and a quiet contact's `current` always resolves. **Retention-coupling
invariant (rev-3 finding):** because a contact may hold up to the per-`cid` mint cap (open question #4) of
*outstanding unconsumed* issued ids — and across interleaved strands I may still hold an older one of them
— the `recent[]` retention bound MUST be **≥ the per-`cid` outstanding-mint cap** (open question #5), so
every id the mint bucket permits to be outstanding stays resolvable. Pinning only the singular `current`
is *not* sufficient on its own; the two knobs are coupled, not independently tunable. (Residual at
pathological strand depth beyond the cap: a superseded id can age out of `recent[]`, costing in-band
recovery *for that one dial* — it degrades to "the next fresh dial recovers from the pinned `current`,"
never to HIGH-1, since RGK is intact and `current` resolves.) The *qualitative* gate property (goal 4) and
self-heal (§2) hold for v4-established contacts only under this per-contact retention + coupling invariant
— it is load-bearing, not storage hygiene.

**Gating policy is driven by R's stored state, never by attacker input (closes the F-3 forceable-bypass
half).** Whether `mac_R` is *required* is decided by what R holds, not by what the Msg1 claims:

- If R resolves `prekey_id → cid`, holds a non-null `RGK` for that `cid`, **and `rgkPeerConfirmed` is true**
  (R has already seen a valid `mac_R` from this contact — the enforcement bootstrap above), `mac_R` is
  **mandatory**: a missing or invalid `mac_R` ⇒ cheap close, *before* any asymmetric op. An attacker
  therefore cannot strip `mac_R` to force a confirmed-gated contact onto the expensive path — the
  requirement is R-side state the attacker can't flip (and the attacker cannot have *caused* the flip, since
  it would have needed a valid RGK-keyed `mac_R` to do so).
- If R **cannot** resolve `prekey_id` to a known `cid` (truly unknown id), or resolves a `cid` whose `RGK`
  is null (legacy v3 contact) **or whose `rgkPeerConfirmed` is still false** (RGK held but the peer has not
  yet been seen to pass the gate — see the enforcement-bootstrap bullet above), there is no enforceable
  gate yet. R falls to the **ungated asymmetric path** (verifying any present `mac_R` cheaply to *set* the
  confirmation flag, but not requiring it) —
  exactly v3 behaviour, no lockout, no regression. This residual path is the only asymmetric work a
  forged Msg1 can ever induce, and it is bounded not by `mac_R` but by a token-bucket rate-limit on
  ungated-path handshake attempts.

**The ungated-path rate-limit must reserve capacity for store-resolvable traffic, or it becomes a
migration-freeze DoS (fixes rev-2 finding N-3).** A single global bucket on *all* ungated traffic is
itself an availability target: an attacker flooding garbage Msg1s with random `prekey_id`s (which resolve
to nothing) saturates the same bucket every legitimate legacy first-v4-reconnect must pass, freezing the
entire not-yet-migrated population on the ungated/strand-vulnerable path indefinitely (on Tor there is no
source identity to per-key the bucket by). Mitigation: **split the ungated bucket by a cheap, non-asymmetric
discriminator** — does the `prekey_id` resolve to a *live prekey secret in R's prekey store*? A genuine
legacy contact presents a v3-issued prekey whose secret R still holds (it just isn't in the v4 issuance
*index*); a flood presents random ids that resolve to no secret. So: a **reserved sub-bucket** for
`prekey_id`s that hit a live prekey secret (legacy-legit + recognizable), and a **separate, tighter
bucket** for ids that resolve to nothing (likely flood). The store lookup is cheap (a map hit, no
asymmetric op) and happens before any decap, preserving the "one cheap check before asymmetric work"
posture. This keeps a *garbage* (unresolvable-id) flood from starving real migrations.

**Reserved-bucket admission must be deduped + scoped, because store-resolvable ≠ legitimate (rev-3
findings, both reviewers).** Two leaks make "resolves to a live secret" broader than "legitimate legacy
traffic": (i) **on-path replay** — a v3 one-time prekey is consumed only on a *completed* handshake, but
the bucket is hit *before* decap, so an on-path/relay observer who captured legacy Msg1s (whose prekeys
strand-window-survive unconsumed) can replay them into the reserved bucket; the earlier rev's claim that
this is "bounded by the prekey already being consumed" was **wrong** (consumption is post-completion, the
bucket is pre-decap). (ii) **the shared last-resort id** resolves to a live secret for every contact, so
a known last-resort `prekey_id` would be an off-path reserved-bucket flood. Required hardening:
  - **Per-Msg1 dedup on reserved admission:** key a small bounded, deterministic seen-set on the full Msg1
    fingerprint (`prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre` hash). A replayed *identical* Msg1 is dropped cheaply;
    a genuine reconnect mints fresh ephemerals so it is never a false-positive. This bounds the on-path
    replayer to *distinct* captured Msg1s (≈ what actually leaked), not unbounded reuse.
  - **Reconnect Msg1 MUST NOT carry a last-resort `prekey_id` at the gate stage** (last-resort is offered
    only inside a recovery Reject, §2, and used only on the immediate retry; a reconnect is *initiated*
    with a one-time/rotation id). So last-resort ids never enter the reserved-bucket discriminator. Assert
    this in the responder's prekey-kind check.
  - **Honest residual (operator-accept):** after dedup, an on-path observer can still occupy reserved
    capacity up to the number of *distinct* unconsumed legacy prekeys it has observed (bounded by the
    not-yet-migrated population's wire traffic during the migration window); on Tor there is no source
    identity to throttle it further. This is a *degraded migration-availability under a sustained on-path
    flood*, not a correctness/lockout break (gated contacts are unaffected; the tighter bucket still caps
    pure garbage), and it shrinks monotonically as the population migrates. Concrete bucket sizes are open
    question #4.

The downgrade an attacker *can* force (legacy contact → ungated path) grants nothing, because such a
contact has no gate to bypass yet anyway; and that window self-closes the moment the first v4 handshake
establishes + confirms its `RGK` (§6).

### 4. Transcript + downgrade (extends v3 H-5/H-3/G7)

`TH0 = H(PROTO ‖ suite_id ‖ mode)` (unchanged — binds mode). `hs_type` (§1) is folded into both signed
responder paths: Msg2's `Sig_R` covers `DS_HS_RESP ‖ TH3` where TH3 now includes `hs_type(MSG2)`; the
Reject's `Sig_R_reject` covers `DS_HS_REJECT ‖ TH_R0 ‖ offered_prekey ‖ is_last_resort` (§2), where
`TH_R0` is the Msg1-cleartext transcript (NOT TH1 — F-5). The `hs_type(REJECT)` discriminant is bound
implicitly by the distinct `DS_HS_REJECT` prefix: the two prefixes (`DS_HS_RESP` vs `DS_HS_REJECT`) keep
an accept and a reject from being substituted for one another (an attacker cannot lift a `Sig_R` onto a
Reject frame or vice-versa). `is_last_resort` is both a signed field of the Reject and re-checked by I's
policy (H-3) so a forced last-resort offer is detectable on the retry.

**Anti-redirect rests on prekey_id ∈ TH_R0 + per-dial ephemeral freshness, not on offered_prekey ∈ TH_R0
(rev-2 clarification N-2).** `TH_R0` deliberately omits the prekey block (the F-5 fix) but *does* bind the
dead `prekey_id` the Reject is "about" plus I's per-dial ephemerals `xe_I/ek_I/ct_pre`. So a Reject
cannot be replayed onto a different Msg1 (different `prekey_id` or ephemerals → different `TH_R0` → sig
fails), and the offered prekey is pinned by the signature itself (and independently verified by I against
its own prekey signature). The offered prekey need not be in `TH_R0`.

**Fixed-width framing is a binding requirement (rev-2 finding N-1).** Both `mac_R` (§3) and `TH_R0` use
raw concatenation of `prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre` under a domain-separation prefix, and
`Sig_R_reject` concatenates `… ‖ offered_prekey ‖ is_last_resort`. This is unambiguous **only because
every one of those fields is fixed-width** — `prekey_id`/`xe_I`/`ek_I`/`ct_pre` (positional parse, equal
pub/ct widths — see the audit's "fixed-width 1024 parse"), `offered_prekey` (a fixed-size public key +
prekey signature), and `is_last_resort` (a fixed 1 byte). Any future field of variable width MUST be
length-prefixed before concatenation, or the field-boundary becomes ambiguous. State this as an invariant
in `constants.ts`/`wire.ts` (covering all five concatenated field sets above) so it is not silently
violated by a later prekey-size change.

### 5. Versioning

`SUITE_ID → dcs98-chat/v4/x25519+mlkem1024+ed25519`; new labels `DS_HS_REJECT`, `DS_MAC_R`,
`RECONNECT_GATE`. v3 reconnect interop is dropped (off-by-default beta; first_contact across versions is
unaffected since suite_id mismatch fails closed by design). `INVITE_VERSION` unchanged (invites are
first_contact only). **`PROTO_LABEL` intentionally stays `…/handshake/v3`** (it identifies the wire-format
*generation*, whose shape is v3-derived; `SUITE_ID` identifies the cipher suite). Both are bound into TH0
so the mismatch is harmless; it is called out here (rev-2 finding N-5) so a later reader does not "fix"
PROTO_LABEL to v4 and silently break the transcript hash.

### 6. Migration: v3 contacts have no RGK (fixes F-3)

The root key is **not persisted** — `Session` consumes `rootKey`/`sessionId` as ephemeral inputs
(`session.ts:348`) and `ContactStore` stores no RK/SID (forward secrecy by design). So there is **nothing
to backfill `RGK` from** for a contact pinned under v3: an `RGK` can only be derived while RK/SID are live
in memory at a handshake's completion. The migration is therefore **lazy establishment, not backfill**:

- **`RGK` is derived + persisted at the first successful v4 handshake of a contact** — whether
  first_contact or reconnect. `handshake.ts` already returns `reconnectGateKey = HKDF(RK, SID,
  RECONNECT_GATE, 32)` from the live RK/SID; the engine MUST persist it to the contact row on success
  (this is also the F-8 impl gap — see below). R does not *enforce* the gate for the contact until it has
  observed one valid `mac_R` from it (the §3 **enforcement bootstrap**); I starts *sending* `mac_R` as soon
  as it holds RGK. So a contact becomes `mac_R`-gated from the first reconnect on which I presents a valid
  `mac_R` — typically the first reconnect after the establishing handshake, since I has RGK by then.
- **A legacy v3 contact's *first* v4 reconnect runs ungated** (null `RGK` / not-yet-confirmed ⇒ the §3
  gating policy falls to the ungated asymmetric path, identical to v3 — no mass lockout). That handshake
  establishes the `RGK` and (for the rotation prekey it mints with `cid`) the per-contact issuance-index
  entry; from the next reconnect I presents `mac_R`, R confirms + enforces, and the contact is gated +
  strand-recoverable. The migration window is **one establishing handshake per contact**.
- **Strand during the migration window (safe — closed by the enforcement bootstrap, NOT by an app-ack).**
  If a legacy contact's first v4 reconnect is *itself* a strand (drops after R consumes the v3-issued
  prekey, before anything is confirmed), R has persisted RGK but **`rgkPeerConfirmed` is false** (it never
  verified a `mac_R` from I), so R does NOT require `mac_R` from I on the next dial — the
  gated-against-a-keyless-peer lockout the rev-3 app-ack approach risked is gone, and because the
  confirming event is R's own direct `mac_R` verification (not a droppable round-trip), there is no
  R-leads-I asymmetry. R still cannot offer *in-band recovery* for that specific dial (the v3-issued
  `prekey_id` is not in the v4 index, and once its secret is consumed R can't prove it was R's, so R
  cheap-closes rather than offer recovery to an unidentifiable peer); that one contact falls back to a
  **fresh out-of-band invite** — exactly the pre-v4 (HIGH-1) behaviour, for one window only, not a
  regression, and no *worse*-than-HIGH-1 gating lockout. The honest scope claim is: *self-heal is
  guaranteed for v4-established (confirmed) contacts; legacy contacts inherit it after one establishing v4
  handshake.*
- **No forceable downgrade.** Per §3, R enforces the gate only for a contact whose `rgkPeerConfirmed` is
  true, and the attacker cannot have *caused* that flip (it requires a valid RGK-keyed `mac_R`) nor strip
  `mac_R` afterward (⇒ cheap close, I re-dials). The only downgrade an attacker can force (not-yet-confirmed
  contact → ungated) targets a contact with no enforced gate to bypass yet, and is bounded by the split
  ungated-path rate-limit (§3).

## Security goals (to be DISCHARGED, not assumed)

1. **Reconnect mutual auth / UKS / KCI** — same as first_contact (signatures over the transcript; pinned
   statics on reconnect). Must hold with `mode = reconnect`.
2. **Recovery soundness** — a `Reject` cannot (a) be forged/replayed by a network attacker (Sig_R_reject
   bound to **TH_R0** — the Msg1-cleartext transcript, §2/§4 — plus offered_prekey + is_last_resort under
   pinned is_R; binding TH_R0 not TH1 is the F-5 fix and is *required* for the reject to be computable in
   the strand case), (b) redirect I to an attacker-chosen prekey, or (c) be used to silently downgrade I to
   last-resort (is_last_resort signed + I-side policy).
3. **No new strand / no double-accept** — the offered prekey is consumed only on a completed retry; the
   reject path consumes nothing. `offerCurrent` **re-offers first** (never refuses a re-offer when an
   unconsumed prekey exists — §2) and mints only when none exist. The no-mint-churn property rests on three
   composed limits — (i) re-offer-first ⇒ ≤1 offerCurrent-minted outstanding prekey per cid at a time;
   (ii) the per-dial responder reject cap (Task 2.4); (iii) the global ungated-path rate-limit (Task 2.5) —
   **not** on an in-store count-throw and **not** on cross-dial idempotency (which does not hold).
   One-retry-per-dial (initiator) cap prevents the initiator looping. R-auth-I injectivity preserved
   (single-use consumption unchanged for the prekey actually used).
4. **DoS gate (qualitative, provable) + amplification bound (engineering, not a theorem).** *Provable:* a
   party without a contact's RGK cannot produce a valid `mac_R` (SUF-CMA on HMAC), so R does **zero**
   asymmetric work for a forged Msg1 against a **confirmed-enforcing v4 contact** (`rgkPeerConfirmed` true,
   §3 bootstrap) **whose issuance index entry is present** (goal 7). *Not a CryptoVerif theorem (F-8):* the
   absolute amplification factor
   — an engineering bound from the **split ungated-path rate-limit** (§3: reserved sub-bucket for
   store-resolvable ids, tighter bucket for unresolvable ones), which caps residual asymmetric work for
   legacy-first and unknown-`prekey_id` traffic *and* prevents a garbage flood from freezing migrations
   (N-3). The spec claims the qualitative gate property in the proof and the quantitative bound as a stated
   rate-limit constant, not a proof obligation.
5. **Downgrade (G7)** — `mode` + `suite_id` in TH0 signed; `hs_type` bound by distinct DS prefixes;
   `is_last_resort` signed. Plus **gate-downgrade resistance** (§3): R enforces `mac_R` only for a
   `rgkPeerConfirmed` contact, an attacker can neither cause that flip (needs a valid RGK-keyed `mac_R`)
   nor strip `mac_R` afterward to any benefit — *provided* goal 7 holds (otherwise index eviction is itself
   a downgrade lever).
6. **Migration soundness (F-3)** — lazy RGK establishment (§6) introduces no mass lockout (legacy
   reconnect falls to the v3-equivalent ungated path), no exploitable downgrade (goal 5), and — via the
   **enforcement bootstrap** (R enforces only after directly verifying one `mac_R`; the confirming event is
   not a droppable round-trip — §3) — **no worse-than-HIGH-1 gated-against-keyless lockout** in the
   migration-strand window (closes both the rev-2 §6(c) hole and the rev-3 app-ack asymmetry). The only
   residual cost is a one-establishing-handshake window in which a legacy contact lacks in-band strand
   recovery, matching pre-v4 behaviour.
7. **Index-retention invariant (rev-2 convergent finding) + retention coupling (rev-3)** — the
   `prekey_id → cid` issuance index is **per-contact bounded**, never a global oldest-evicting cap, with
   `current` pinned **and** the `recent[]` retention bound **≥ the per-`cid` outstanding-mint cap** (so
   every id the mint bucket permits to be outstanding stays resolvable — pinning only `current` is
   insufficient). Goals 2 (self-heal) and 4 (DoS gate) hold for v4 contacts *only* under this invariant; a
   global cap silently demotes quiet contacts to ungated + unrecoverable and hands an attacker an eviction
   lever, so this is a security goal, not storage hygiene.

## Formal-verification scope (MED-2b + verifies HIGH-1 fix)

**Model the Reject/Msg2 branch FIRST, before implementing the Reject code (§2 / Phase 2.4).** The
accept-vs-reject branch is the canonical self-audit blind spot (a forged Reject silently substituted for
a Msg2, or a `Sig_R` lifted onto a Reject frame): proving it in the symbolic model before writing the
branch keeps the implementation honest to a checked design rather than the reverse. This reorders the
build — the ProVerif reconnect+Reject model is a *gate on* Task 2.4, not a follow-up to it.

- **ProVerif** (`chat-handshake.pv` → add a reconnect variant): `mode = reconnect`, pinned-static hard
  check (no TOFU pin), `mac_R` pre-gate, the Reject/retry branch with `Sig_R_reject` over `TH_R0`
  (Msg1-cleartext). Re-assert: injective agreement both directions, downgrade (no mode/last-resort/hs_type
  coercion; no `Sig_R`↔`Sig_R_reject` substitution across the distinct DS prefixes), recovery soundness
  (a forged Reject can't make I complete with an attacker prekey; a Reject can't be replayed onto another
  Msg1 since `TH_R0` binds this Msg1's cleartext), no-double-accept.
- **CryptoVerif**: the reconnect key schedule is the *same* chain (es/ee/se/ss_pre/ss_I), so the existing
  hybrid-secrecy / auth / KCI / FS proofs transfer; **add** the `mac_R` gate under a PRF/SUF-CMA-MAC
  assumption (this discharges the *qualitative* DoS-gate property of goal 4 — zero asymmetric work without
  RGK — NOT the quantitative amplification bound, which is the rate-limit constant) and model the Reject
  branch's signature (UF-CMA, already assumed). Confirm RGK secrecy (derived from the proven-secret RK by
  a ROM step).

## Implied code changes

- `constants.ts`: `SUITE_ID` v4; `DS_HS_REJECT`, `DS_MAC_R`, `RECONNECT_GATE` labels.
- `wire.ts` / `handshake.ts`: `hs_type` tag on the responder message; `mac_R` gen — **I sends it whenever
  it holds RGK** (initiator) — + verify (responder, before asymmetric ops); **enforcement-bootstrap gating
  policy** (§3 — R *requires* `mac_R` iff it resolves the cid, holds RGK, AND `rgkPeerConfirmed` is true;
  else ungated path, verifying any present `mac_R` cheaply to *set* the flag); **per-Msg1 dedup seen-set**
  on the reserved rate-limit path (N-3 anti-replay); `Sig_R_reject` over `TH_R0` (Msg1-cleartext, NOT TH1
  — F-5); the Reject emit (responder) + verify/retry-once-per-dial (initiator); thread `RGK` in.
- `prekey-store.ts`: **re-key the `issued` index per `cid` with the most-recent id pinned** (replace the
  global `ISSUED_CAP`/`trimIssued` oldest-evict with per-contact bounding — goal 7); `offerCurrent(cid)` →
  the contact's **newest already-issued, unconsumed** one-time prekey via that index (no mint), minting a
  new one only when none exist, **per-cid mint rate-limit** (F-1); signed last-resort iff the pool is
  exhausted; consumes nothing. The `ResponderInviteStore.issueNext` interface signature
  (`handshake.ts:61`) must change to accept the `cid`.
- **Split ungated-path rate-limit** (F-8 bound + N-3 anti-freeze): two token buckets guarding the
  asymmetric handshake path for traffic that misses the enforced gate — a **reserved** bucket for
  `prekey_id`s that resolve to a *live prekey secret in R's store* (legacy-legit/recognizable) and a
  **tighter** bucket for ids resolving to nothing (likely flood); excess ⇒ cheap close. The store lookup
  is cheap (map hit, no asymmetric op) and runs before decap. Reserved admission is **deduped by a bounded
  Msg1-fingerprint seen-set** (`hash(prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre)`) so a replayed identical Msg1
  can't reuse capacity (N-3); reconnect Msg1 **must not carry a last-resort `prekey_id`** (assert the
  prekey-kind), so the shared last-resort secret can't be a reserved-bucket flood vector. **Buckets +
  seen-set are clock-free/deterministic** (N-4): sized by concurrency (a semaphore) + a caller-stamped
  logical tick injected like `engine.now()`, never an internal `time()`. Lives where reconnect Msg1 is
  dispatched (`handshake.ts`/`engine.ts`).
- `contact-store.ts`: `RGK` field already added; **the engine MUST persist the `reconnectGateKey` returned
  by `handshake.ts`** (F-8 impl gap — currently dropped) and track a per-contact **`rgkPeerConfirmed`**
  flag (encrypted), set the first time R verifies a valid `mac_R` from the contact (§3 enforcement
  bootstrap); R requires `mac_R` only for confirmed contacts. Losing the flag is safe (re-bootstraps).
- `engine.ts`: (a) persist `RGK` on handshake success; **set `rgkPeerConfirmed` when R verifies a valid
  `mac_R`** (the confirming event is R's own direct verification — no app-ack round-trip, closing the
  rev-3 asymmetry); I sends `mac_R` whenever it holds RGK; (b) call `invites.issueNext(cid)` **WITH the
  cid** on the rotation path so the per-contact index populates — without this the gate fails closed for
  legit reconnects (F-8 impl gap); (c) reconnect retry orchestration; (d) on a final hard-fail, surface a
  clear, actionable status ("reconnect link expired — request a fresh invite") instead of a generic throw.
- Formal: the ProVerif reconnect variant (Reject branch modelled **first**, gating Task 2.4) +
  CryptoVerif MAC assumption; update `model-code-correspondence.md`.

## Verification

- Unit/integration: reconnect happy-path; **strand-recovery** (consume the stored prekey, drop, reconnect
  → Reject → retry → success, no fresh invite) — the HIGH-1 regression test; **`offerCurrent` re-offers
  the pending prekey within a dial (no new mint), and the per-`cid` mint bucket caps the outstanding set
  across dials** — F-1 (note: the existing `chat-stores.test.ts` test that pins the always-mint behaviour
  must be inverted); **per-contact index retention** — a contact whose id would have been globally evicted
  (simulate > old-cap issuances on *other* contacts) still resolves + stays gated + stays recoverable —
  goal 7; **`recent[]` retention ≥ mint cap** — with mint cap = K, a contact holding K outstanding issued
  ids still resolves the *oldest* of them after churn on other contacts (coupling invariant) — goal 7;
  **enforcement bootstrap** — R does NOT require `mac_R` until it has verified one valid `mac_R` from the
  contact; the first post-establishment reconnect (I presents `mac_R`) flips `rgkPeerConfirmed` and is
  accepted ungated, the *next* is gated — §3; `mac_R` rejects a forged reconnect Msg1 before asymmetric
  work for a **confirmed** contact; **gate-downgrade attempt** (strip `mac_R` from a confirmed contact ⇒
  cheap close, not ungated) — goal 5; **bootstrap lockout-freedom** — a strand before confirmation leaves
  `rgkPeerConfirmed` false so the next (keyless-w.r.t.-this-epoch) dial is accepted ungated, NEVER
  cheap-closed on a mandatory gate (the rev-3 app-ack-asymmetry regression test) — goal 6; **migration**
  (null/unconfirmed-RGK contact reconnects ungated, no lockout; RGK persisted on success; confirmed on
  first valid `mac_R`; next reconnect gated) — F-3; **engine persists `reconnectGateKey`** + sets
  `rgkPeerConfirmed` on valid-`mac_R` verify, and **`issueNext` is called with cid** — F-8; **split
  rate-limit** (garbage unresolvable-id flood does not starve the reserved store-resolvable bucket —
  migrations still pass) + **reserved-bucket dedup** (replayed identical Msg1 is dropped, doesn't reuse
  capacity) + **last-resort id rejected on reconnect Msg1** — N-3; **epoch-bound flag** — a fresh
  first_contact re-pin clears `rgkPeerConfirmed` atomically with the RGK change, so R does not enforce a
  new-epoch `mac_R` before re-confirming (the rev-4 (e) edge) — §3 invariant; forged-`Reject` rejected; **replayed
  `Reject` onto a different Msg1 rejected** (TH_R0 binding) — F-5; last-resort offer surfaced not silent;
  one-retry-per-dial cap (second Reject in a dial hard-fails); downgrade attempts rejected.
- `pnpm typecheck` + full `pnpm test` green. ProVerif reconnect run (Reject branch first) + CryptoVerif
  re-run all green.
- Charter: no new egress; RGK encrypted at rest; deterministic — the rate-limit and index use
  caller-stamped logical ticks/counts (injected `now()`), **no `time()` inside the crypto/gate path**
  (N-4).

## Open questions for the operator

The post-review rev resolves #2 and #3 as spec defaults (rationale below); #1 remains a genuine
availability-vs-FS policy choice; #4 is new (rate-limit tunables). None blocks the build — the defaults
are implementable and safe — but #1 is worth an explicit call before freeze.

1. **Last-resort on recovery (genuine choice):** when the one-time pool is exhausted, should the Reject
   offer the FS-degraded last-resort (auto, surfaced) or refuse and require a fresh invite (stricter FS,
   worse availability)? Spec default: offer last-resort, flagged + surfaced (availability-leaning), per
   v3's stance — and v3's Med-7 mandates the surfacing either way (never silent).
2. **Retry cap — RESOLVED as one-retry-per-dial.** Bounds loops simply; a pool-rotation race is recovered
   by the *next* dial re-entering recovery (not lost), so a small-N per-dial cap buys little. (§2.)
3. **RGK lifetime — RESOLVED as stable from first establishment.** Per-reconnect rotation desyncs a
   half-completed reconnect and reintroduces a lockout (§3). Note enforcement *activation* is separate from
   RGK *rotation*: activation uses the enforcement bootstrap (R enforces after directly verifying one
   `mac_R` — §3), not a rotation. Rotation, if ever wanted, is out of scope for v4.
4. **Rate-limit constants (tunable, not blocking):** the **split** ungated-path buckets (F-8/N-3/§3) need
   concrete N-concurrent / M-per-logical-tick values. Proposed conservative defaults: **reserved**
   store-resolvable bucket ≤ 8 concurrent / 32 per window; **tighter** unresolvable-id bucket ≤ 2
   concurrent / 8 per window (so a garbage flood throttles fast without starving recognizable legacy
   migrations); the **per-dial responder reject cap** (Task 2.4) = 2. The **reserved-bucket dedup seen-set
   MUST be sized ≥ the reserved bucket's window** so its eviction can't out-pace the bucket it protects
   (else an attacker cycling ≥ seen-set-size distinct captures could re-admit evicted ones — stays within
   the stated distinct-capture residual, but the sizing keeps it tight). `offerCurrent` does **not** carry
   its own count-throw (re-offer-first + the per-dial cap + these buckets bound minting — §2/goal 3).
   Engineering knobs, adjustable post-deploy without a wire change.
5. **Per-contact index bound (tunable):** goal 7 requires per-`cid` retention with `current` pinned; the
   `recent[]` tail length is a knob. The **retention-coupling invariant** requires `len(recent[]) ≥` the
   max plausible outstanding-unconsumed prekeys per contact, so every outstanding-permitted id stays
   resolvable. Proposed: `recent[] = 4` (matches the prior per-cid mint-cap intent of 4).
