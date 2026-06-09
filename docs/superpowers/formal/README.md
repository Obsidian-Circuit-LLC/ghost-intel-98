# DCS98 chat handshake — formal verification plan

**Status (2026-06-09): first_contact ProVerif symbolic COMPLETE; CryptoVerif hybrid secrecy (full chain)
+ mutual auth + KCI + FS + unified + G2′ PROVED; reconnect mode ADDED — symbolic reconnect+Reject model
and computational `mac_R` gate proof both reproduced (see the reconnect-hardening section below).** Under
**CryptoVerif 2.12** (first_contact): the hybrid IND bound on the key
schedule (2-input core `chat-handshake-hybrid-*.cv` and the **actual 5-step chain**
`chat-handshake-fullchain-*.cv`), **injective mutual authentication** (`chat-handshake-auth.cv`) — both directions under Ed25519 UF-CMA, no
replay / no UKS, R-authenticates-I injectivity shown to rest on single-use prekeys (the TOCTOU fix); **KCI resistance** (`chat-handshake-kci-reveal{R,I}.cv`) — each party still authenticates its peer with
its OWN long-term key revealed; and **hybrid forward secrecy** (`chat-handshake-fs-{classical,pq}.cv`) —
RK secret under full long-term-key compromise if either the ephemeral DH (`ee`) or the ephemeral KEM
(`ss_I`) survives; and the **unified KDF→AEAD model** (`chat-handshake-unified.cv`) — RK stays secret in
the presence of the chain-derived AEAD encryptions (c_idI/c_confR), so the layers compose; and
**computational G2′** (`chat-handshake-g2prime.cv`) — the c_idI identity payload is confidential under
IND$-CPA with the chain-derived (secret) AEAD key. The symbolic model (`chat-handshake.pv`,
`proverif-output-2026-06-08.txt`) was completed and run under ProVerif 2.05.

**In-house Gate 1 — verified + internally audited.** Proved (see `model-code-correspondence.md`):
symbolic (first_contact) + computational secrecy (hybrid, full 5-step chain), mutual auth, KCI, forward
secrecy, unified KDF→AEAD, **computational G2′** (`chat-handshake-g2prime.cv`), with the model-to-code
correspondence, fuzz harness, and constant-time audit. An **internal adversarial audit**
(`internal-audit-2026-06-08.md`) then found + **fixed a Critical** handshake→session handoff bug, and
recorded open HIGH/MEDIUM items (reconnect-prekey strand; crash-window injectivity; silent
pin-before-verify UX).

**Reconnect-hardening (v4) added 2026-06-09 — reconnect mode now verified (symbolic + computational).**
Two new artifacts, both reproduced on branch `feat/reconnect-hardening-v4` (see the per-artifact verdicts
below and §1b/3b of `model-code-correspondence.md`):

- `chat-handshake-reconnect.pv` → `proverif-reconnect-2026-06-09.txt` — symbolic reconnect mode + the
  authenticated-Reject recovery branch. **8 RESULT lines, all as expected:** I-auth-R **injective proved**;
  R-auth-I **non-injective proved, injective cannot be proved** (the expected outcome — no R-fresh nonce in
  TH1, same as first_contact, lifted via single-use prekey consumption); recovery soundness
  `I_retry_with ⇒ R_sent_reject` **true**; `s_id`/`s_rk`/`s_retry` secrecy **all true**. Downgrade /
  `Sig_R↔Sig_R_reject` non-substitution is discharged constructively (cross-mode first_contact signer
  reachable), not by a separate query.
- `chat-handshake-macr.cv` → `cryptoverif-macr-2026-06-09.txt` — computational `mac_R` DoS-gate
  unforgeability. **"All queries proved"**: `event(Raccept(m)) ⇒ event(Imacr(m))` up to `Pmac` (SUF-CMA on
  the HMAC) — a party without RGK triggers zero asymmetric work. This is the *qualitative* gate property
  only; the quantitative amplification bound is the rate-limiter engineering constant, NOT a theorem.

This **closes HIGH-1** (reconnect strand → permanent lockout, fixed by the in-band Reject/retry recovery +
the RGK-stable fix) and **MED-2** (reconnect had no model + no DoS pre-gate) from the internal audit. Two
honest caveats carry: the **availability** property (unconfirmed-R-never-blocks / no-worse-than-HIGH-1) is
an **argued liveness** property, not a tool theorem; and the **on-path-replay reserved-bucket** residual
(audit N-3) is an **operator-accepted** degraded-migration-availability residual, not a lockout/break.

**Verified scope (updated 2026-06-09):** symbolic (first_contact AND reconnect incl. Reject) +
computational (key-schedule full chain, mutual auth, KCI, FS, unified KDF→AEAD, G2′, reconnect `mac_R`
gate). The reconnect chain is the same chain as first_contact, so secrecy/auth/KCI/FS transfer unchanged.
**Still NOT verified:** the first_contact `mac_T` keyed-MAC DoS property (the *reconnect* `mac_R` gate IS
now proved; `mac_T` is a separate, still-unmodelled gate) and the storage-level injectivity invariant.

**This does NOT clear the EXPERIMENTAL banner.** The remaining gates are **external** and not
self-clearable: an **independent** third-party audit and the **FIPS-validated module build**. A simulated
in-house audit does not substitute for the independence an external audit provides — so user-facing text
must not say "externally audited" or "FIPS-validated." The operator may drop "EXPERIMENTAL" on accepted
internal-review risk with honest wording ("formally verified (symbolic + computational), internally
reviewed; not independently audited; not FIPS-validated"); the flip is the operator's call.

### CryptoVerif results (2026-06-08, hybrid key-schedule core, ROM key derivation)

The headline G2 property — *RK is indistinguishable from random if **either** the X25519 leg **or** the
ML-KEM leg survives* — is the one thing symbolic ProVerif cannot express. CryptoVerif proves it as two
independent legs (each models the worst case for the other primitive):

| Leg | Assumption | Adversary additionally given | Result |
|---|---|---|---|
| DH  | CDH (X25519) | the ML-KEM shared secret `ss` | **`secret rk` proved**, ≤ `2·qH·pCDH` |
| KEM | IND-CCA2 (ML-KEM) | the X25519 secret `es` + a decap oracle | **`secret rk` proved**, ≤ `2·qH/|kemss| + 2·Penc` |

Either leg alone suffices, so RK stays secret unless **both** primitives break — the hybrid guarantee.
The KDF/MixKey chain is abstracted as a 2-input random oracle (the dual-PRF property of the fixed MixKey
arg roles); the parameter (ML-KEM-1024 vs 768) does not enter the proof, only the concrete `Penc` bound.

**Full-chain refinement (2026-06-08, `chat-handshake-fullchain-{dhleg,kemleg}.cv`).** The two leg files
above collapse the schedule to `RK = ROM(es, ss)`. The full-chain files model the **actual implemented
5-step chain** (`handshake.ts:174-217`): `CK1=MixKey(es,CK0) → ss_pre → ee → se → ss_I → RK`. Both legs
re-proved with **every** non-surviving secret handed to the adversary (DH leg ≤ `(20+10·qHmix)/|bits| +
2·qHes·pCDH`; KEM leg ≤ `(12+8·qHmix)/|bits| + 2·qHpre/|kemss| + 2·Penc`) — confirming the dual-PRF
saturation holds over the real chain, not just the collapsed core. (Authentication and the full
transcript/signature/AEAD layer remain symbolic-only; the end-to-end computational model is the next
Gate-1 step — see `model-code-correspondence.md`.)

### ProVerif results (2026-06-08, first_contact mode, perfect-primitive symbolic model)

| Goal | Query | Result |
|---|---|---|
| G1b — I authenticates R | `inj-event(I_commit_R) ==> inj-event(R_running_I)` | **proved (injective)** |
| G1a — R authenticates I | `inj-event(R_commit_I) ==> inj-event(I_running_R)` | **non-injective proved; injective not proved** |
| G2′ — identity-payload secrecy | `not attacker(s_id)` | **proved** |
| RK secrecy (perfect primitives) | `not attacker(s_rk)` | **proved** |

The one gap is informative, not a tooling artifact: in a 1-RTT design R contributes no fresh nonce into
`TH1` before Msg1, so R's **no-double-accept** cannot come from the signed transcript alone — it rests on
**durable one-time-prekey consumption** (modelled here as a consumable private-channel cell; this is the
formal counterpart of the C-2 / TOCTOU property patched in `prekey-store.ts`). `preciseActions` did not
lift the injective proof, confirming the dependency is structural.

These artifacts were authored from construction v3
(`../specs/2026-06-06-p2p-chat-handshake-construction-v3.md`). `handshake.ts` is already implemented; the
remaining computational proof is what would let the EXPERIMENTAL banner be reconsidered.

This follows the PQXDH precedent (Bhargavan et al., USENIX Security 2024), which used **both**
ProVerif (symbolic) and CryptoVerif (computational) — neither alone is sufficient.

## Tool split — and why both are required

| Property (v3 goal) | Tool | Why |
|---|---|---|
| Mutual auth / injective agreement (G1) | ProVerif | symbolic correspondence assertions |
| UKS, KCI (G1) | ProVerif | selective key-reveal oracles + agreement queries |
| Replay / no-double-accept (G6) | ProVerif | injective events + one-time `T`/prekey tables |
| Downgrade (G7) | ProVerif | `suite_id`/`mode` parameter agreement |
| Identity-payload secrecy of `c_idI` (G2′) | ProVerif | secrecy under perfect primitives |
| **Hybrid confidentiality of `RK` (G2)** | **CryptoVerif** | symbolic can't express "secure if EITHER X25519 OR ML-KEM holds" — that's a computational reduction |
| Classical + PQ forward secrecy (G3, G4) | both | ProVerif phases for the trace; CryptoVerif for the bound |

ProVerif treats primitives as perfect, so it proves the **protocol logic** (auth, replay, the message
choreography, secrecy-given-perfect-crypto). The whole reason this design is *hybrid* — that it
survives one primitive breaking — is a **computational** statement only CryptoVerif can make.

## `chat-handshake.pv` (ProVerif) — what's drafted vs TODO

Drafted: primitive equational theory (X25519 DH, ML-KEM as a perfect KEM, Ed25519, hash, HKDF/MixKey,
MAC, AEAD), domain-separation constants, the auth events, and the injective-agreement queries.

TODO before it runs/proves anything:
1. Fill the `initiatorI` / `responderR` process bodies (message parse/build, the exact MixKey chain,
   `mac_T` pre-gate, AEAD with `H(T)` AAD, the verify-before-encap ordering).
2. Model the **one-time token + prekey consumption** as ProVerif tables (`insert`/`get`) to get the
   atomic one-time semantics; assert no-double-accept.
3. Add **reveal oracles** (`out(net, …)` of selected long-term keys, gated by `phase`) for KCI/UKS:
   reveal R's `is_R,xs_R,preSk` and query that I-impersonation-to-R is unreachable.
4. Add the `reconnect` mode variant (pinned-static check, no token).
5. Wire `query secret RK` (publish RK through a `secret` declaration or a sentinel reachability test).

### Forward secrecy (phases)
- `phase 0`: honest handshake completes; ephemerals (`xe_I, xe_R, ek_I`) and the **consumed one-time**
  `preSk` are dropped (model deletion-on-consumption — this is the C-2 durability obligation made
  formal).
- `phase 1`: reveal all *static* keys + any *unconsumed* prekeys. Query: secrecy of phase-0 `RK` still
  holds → G3 (via `ee`) and G4 R→I (via deleted `ek_I`).
- Separate **negative** query for the last-resort path: reveal the reused last-resort `preSk` with a
  harvested `ct_pre`; secrecy of that `ss_pre` must **FAIL** — confirming the documented FS
  degradation rather than hiding it. A model that "proves" last-resort FS is a wrong model.

## CryptoVerif approach (realized as two leg files — see results table above)

The plan below was realized as `chat-handshake-hybrid-dhleg.cv` + `chat-handshake-hybrid-kemleg.cv`
(key-schedule core). A full end-to-end computational model of the whole handshake remains future work.


Goal: `RK` is indistinguishable from random under `IND-CCA(ML-KEM-1024) ∨ GapDH(X25519)` (the shipped
parameter; the proof structure is parameter-independent — 1024 only changes the concrete bound).
- Model `MixKey` as HKDF with the **fixed arg roles** (secret = IKM, CK = salt) — this is what makes
  the extract a dual-PRF so one good secret saturates the chain (crypto-audit H-1). Encode HKDF-Extract
  as a `ROM`/PRF and prove the chain pseudorandom if any mixed secret is unknown.
- Two reductions composed: (a) drop the X25519 terms via GapDH, KEM terms intact; (b) drop the ML-KEM
  terms via IND-CCA, DH terms intact. Either reduction alone yields IND of `RK`.
- Add the dedicated **G2′** query: secrecy of the `c_idI` plaintext (the value protected only by
  `es`+`ss_pre`, no `ee`/`se`), with the last-resort phase showing its degraded bound.

## How to run (once completed)

```
proverif docs/superpowers/formal/chat-handshake.pv
cryptoverif docs/superpowers/formal/chat-handshake.cv   # after authoring
```

Record outputs (and the exact tool versions) alongside this README. Tabulate the **which-compromise-
breaks-which-property** matrix from the reveal-oracle runs (the operator's β-Oracle-style table) as the
verification's headline artifact. Only when ProVerif discharges G1/G6/G7/G2′ and CryptoVerif discharges
G2 (+ the FS phases) is the construction cleared to freeze and `handshake.ts` to be written.
