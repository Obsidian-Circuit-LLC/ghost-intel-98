# DCS98 chat handshake — formal verification plan

**Status (2026-06-08): ProVerif model COMPLETED + RUN; CryptoVerif still TODO.** The symbolic model
(`chat-handshake.pv`) was completed from construction v3 and run under **ProVerif 2.05** — full output in
`proverif-output-2026-06-08.txt`. The computational (CryptoVerif) hybrid-IND proof has **not** been
authored/run yet. The construction therefore stays **EXPERIMENTAL / not formally verified**: the symbolic
layer is necessary but not sufficient, and an external audit + FIPS build remain separate external gates.

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

## CryptoVerif plan (`chat-handshake.cv` — TODO to author)

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
