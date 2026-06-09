# DCS98 chat handshake — model-to-code correspondence (Gate 1)

**Purpose.** A formal proof certifies a *model*, not the shipped TypeScript. This document is the
bridge: it maps every element of the ProVerif/CryptoVerif models to the exact code that implements it,
states what the proofs do and do **not** cover, and records the implementation-side audit (constant
time, secret handling) that the symbolic/computational tools are structurally blind to. It is a living
Gate-1 artifact; **the EXPERIMENTAL banner stays until it is complete and an external audit has run.**

Code under review: `src/main/chat/{handshake,crypto,constants,identity,wire,invite}.ts` (read 2026-06-08).

## 1. Construction ↔ code map

| Construction element | Code (handshake.ts unless noted) | Model element |
|---|---|---|
| `TH0 = H(PROTO‖suite‖mode)` | I `:168`, R `:246` | `h((PROTO,SUITE,mode))` (pv) |
| `TH1` (binds is_R, xs_R, prekey, sig_pre, xe_I, ek_I, ct_pre) | I `:169-172`, R `:247-250` | `th1` (pv) |
| `es = DH(xe_I, xs_R)` | I `:175`, R `:261` | `expn` (pv) / DH leg `es` (cv) |
| `ss_pre = Encap/Decap(pk_pre)` | I encap `:165`, R decap `:260` | KEM (pv) / `ss` (cv kem leg) |
| MixKey chain CK0→CK2 (init,es,ss_pre) | I `:174-177`, R `:259-262` | nested `hkdf` (pv) / ROM (cv) |
| `hk1 = HKDF(CK2,TH1,DRV_HK1)` | I `:178`, R `:263` | `hk1` (pv) |
| `Sig_I = Sign(is_I, DS_HS_INIT‖TH1)` | sign I `:180`, verify R `:276` | `sign`/`checksign` (pv) |
| `c_idI = AEAD(hk1,nonce0,id‖Sig_I, aad=H(T))` | seal `:183`, open R `:268` | `aenc`/`adec` (pv) |
| `mac_T = HMAC(H(T), DS_MAC_T‖TH1)` | make `:184`, verify R `:255-256` | (pv: token pre-gate / cell) |
| MixKey chain CK3→CK5 (ee,se,ss_I) | I `:197-199`, R `:297-299` | nested `hkdf` (pv) |
| `Sig_R = Sign(is_R, DS_HS_RESP‖TH3)` | sign R `:302`, verify I `:210` | `sign`/`checksign` (pv) |
| `c_confR = AEAD(hk2,nonce0,Sig_R)` | seal R `:303`, open I `:205` | `aenc`/`adec` (pv) |
| `RK = HKDF(CK5,TH4,DRV_ROOT)` | I `:217`, R `:307` | `rk` (pv + cv goal) |
| one-time prekey consume (durable) | R `:287` `invites.consume` | consumable cell (pv) |
| verify-before-encap ordering | R: all checks `:255-287` precede Encap `:293` | process order (pv) |
| TOFU pin / reconnect pinned-check | R `:280` / `:282-285` | (operational) |

## 1b. Reconnect-hardening (v4) ↔ code map

Authored from `../specs/2026-06-08-reconnect-hardening.md` (rev 4). Models:
`chat-handshake-reconnect.pv` (symbolic, reconnect mode + Reject branch) and `chat-handshake-macr.cv`
(computational mac_R gate unforgeability). Code read on branch `feat/reconnect-hardening-v4`.

| Construction element | Code (`src/main/chat/…`) | Model element |
|---|---|---|
| `mac_R` gate input (Msg1-cleartext, flattened under `DS_MAC_R`) | I make `handshake.ts:288-289`; R recompute `handshake.ts:472-473` | `macr_msg(...)` flattened input (macr.cv `:69`); `hmac(rgk,(DS_MAC_R,thR0))` (reconnect.pv `:265,322`) — folded (see 3a) |
| `mac_R` present-flag wire slot (1 byte + 32-byte tag) | I `handshake.ts:284-291,295`; R parse `handshake.ts:436-440` | (wire framing; not separately modelled) |
| Enforcement bootstrap: R enforces only when `rgkPeerConfirmed` | R gate block `handshake.ts:460-484` (enforce `:475-479`, bootstrap-observe `:480-483`); fail-closed guard `:470` | confirmed/ungated copies (reconnect.pv `:257-273,459-462`); `Raccept ⇒ Imacr` (macr.cv `:82-83`) |
| `rgkPeerConfirmed` flip on R verifying one valid `mac_R` | handshake returns `peerMacRVerified` `handshake.ts:478,482,622`; engine sets flag `engine.ts:386` | bootstrap (no separate event — modelled as the confirmed copy being reachable) |
| `getReconnectKey` / `isRgkConfirmed` (cid → RGK / confirm) | `contact-store.ts:127-128,133-134` | RGK as fresh shared key (reconnect.pv `:443`); `k_rgk` fresh secret (macr.cv `:109`) |
| Reject/recovery branch (R emits) | R emit `handshake.ts:516-534`; per-dial cap `MAX_REJECTS_PER_DIAL=2` `:422,521-523` | `responderR_reject*` (reconnect.pv `:277-303`); `R_sent_reject` event `:287` |
| `Sig_R_reject = Sign(is_R, DS_HS_REJECT‖TH_R0‖offered_prekey‖is_last_resort)` | R sign `handshake.ts:533`; I verify `:312-314` | `sign((DS_HS_REJECT,thR0,offered_prekey,LR_FALSE),isR)` (reconnect.pv `:286`); I verify `:363` |
| `TH_R0 = H(MIX_INIT‖TH0‖prekey_id‖xe_I‖ek_I‖ct_pre)` (Msg1-cleartext, NOT TH1) | I `handshake.ts:279`; R `:528` | `thR0` (reconnect.pv `:264,297,321,360`) |
| I retry-once-per-dial against offered prekey | I `handshake.ts:303-368,384-386`; one retry then hard-fail | `I_retry_with` event + retry process (reconnect.pv `:369-392`) |
| Per-contact issuance index (`current` pinned + bounded `recent[]`) | `prekey-store.ts:25-43,52-62,98-105`; `RECENT_CAP=MINT_CAP=4` `:58-61` | (operational; the index is what `identifyContact` resolves — not a crypto property) |
| `offerCurrent` re-offer-first, mint only when none | `prekey-store.ts:258-293` | offered current prekey, fresh (reconnect.pv `:277-288`) |
| `issueNext(cid)` populates per-contact index | `prekey-store.ts:228`; engine wiring drives the rotation path | next-prekey mint in accept tail (reconnect.pv `:241-244`) |
| Split + deduped rate-limiter (reserved/tighter buckets, Msg1-fp seen-set) | `reconnect-gate.ts:44-145`; responder wiring `handshake.ts:405-406,489-505` | (engineering bound — NOT modelled; see availability note) |
| One limiter, injected by the engine | `engine.ts:114` (single `ReconnectLimiter`), passed at `engine.ts:371` | (engineering) |
| RGK stable-per-epoch: engine writes RGK only on first_contact | `engine.ts:177-179,385` (write iff `mode==='first_contact'`); reconnect discards re-derived RGK `engine.ts:353-356` | RGK derived once, shared (reconnect.pv `:443`) — stable, not rotated |
| Epoch reset on re-pin (clear RGK + confirm) | `contact-store.ts:182-191` `resetReconnectEpoch`; engine calls it on fresh first_contact `engine.ts:162-177` | (epoch-bound flag invariant; spec §3) |
| `RECONNECT_GATE` label `RGK=HKDF(RK,SID,…)` | `handshake.ts:367,619` derive; `constants.ts` label | `RECONNECT_GATE` (reconnect.pv `:123,443`); RGK = one PRF step off RK (macr.cv `:17-26`) |

### 3a — the folded-vs-flattened `mac_R` abstraction (documented, NOT a code bug)

The two models input the **same field set** to `mac_R` two different ways:

- **ProVerif** (`chat-handshake-reconnect.pv:264-265,322`) folds the fields through an intermediate hash
  `TH_R0 = H(MIX_INIT‖TH0‖prekey_id‖xe_I‖ek_I‖ct_pre)` and computes `mac_R = HMAC(RGK, DS_MAC_R‖TH_R0)`.
- **The implementation** (`handshake.ts:288,472`) and **CryptoVerif** (`chat-handshake-macr.cv:9,69,92`)
  **flatten** the identical fields directly under the domain prefix:
  `mac_R = HMAC(RGK, DS_MAC_R‖TH0‖prekey_id‖xe_I‖ek_I‖ct_pre)`.

These are **equivalent under the symbolic-HMAC / PRF abstraction**: HMAC is applied to an *injective
encoding of the same field set under the same `DS_MAC_R` domain prefix* (every field is fixed-width —
spec §4 framing invariant — so both encodings are injective and carry identical information), and an
extra collision-resistant hash layer (the `TH_R0` fold) does not change what the keyed function commits
to. The ProVerif and CryptoVerif proofs therefore transfer to the shipped flattened form. This is a
**deliberate modelling choice** — the `.cv` matches the code byte-for-byte for the computational gate
proof; the `.pv` reuses `TH_R0` because the symbolic model already needs that hash for `Sig_R_reject`. It
is documented here (and in both model headers, `macr.cv:11-15` / `reconnect.pv:9-19`) so a later reader
does not mistake it for drift.

**Note the asymmetry:** only `mac_R` differs between the two encodings. `Sig_R_reject` uses `TH_R0`
identically in BOTH the model (`reconnect.pv:286,363`) and the code (`handshake.ts:312-314,533`) — there
is no folded/flattened divergence on the reject signature.

### 3b — what reconnect verification covers, with the honest caveats

The reconnect models exercise (citing the recorded outputs):

- **Symbolic (`proverif-reconnect-2026-06-09.txt`)** — 8 RESULT lines:
  - I-authenticates-R: **injective agreement proved** (`inj-event(I_commit_R_rc) ⇒ inj-event(R_running_I_rc)` is true; output `:13`/`:1463`). TH3 folds R's fresh `xe_R` + `hs_type(MSG2)`, pinning the accept branch.
  - R-authenticates-I: **non-injective proved; injective CANNOT be proved** (`:10-12`/`:1255-1257`). This is the **expected** outcome — identical to first_contact (`chat-handshake.pv`): no R-fresh nonce in TH1, so injectivity rests on durable one-time-prekey consumption and is lifted in CryptoVerif, not ProVerif. Stated exactly as the tool reports it; **not** rounded up.
  - Recovery soundness: `I_retry_with ⇒ R_sent_reject` **true** (`:14`/`:1556`) — I only ever retries against a prekey the honest R genuinely offered; no forged/synthesised Reject can redirect I.
  - Secrecy: `s_id`, `s_rk`, `s_retry` **all not-attacker (true)** (`:15-17`/`:1631,1706,1781`) — identity payload, reconnect root key, and the retry-completion sentinel are all secret on the reconnect chain (incl. the Reject-driven retry). Downgrade / `Sig_R↔Sig_R_reject` non-substitution is discharged *constructively* by these holding with the cross-mode first_contact signer reachable (reconnect.pv `:181-188,401-424`), not by a separate query.
- **Computational (`cryptoverif-macr-2026-06-09.txt:247`)** — `event(Raccept(m)) ⇒ event(Imacr(m))`
  **proved**, "All queries proved", up to `Pmac` (the SUF-CMA advantage on the HMAC). I.e. R's gate
  accepts only messages the honest party actually MAC'd ⇒ a party without RGK triggers **zero**
  asymmetric work. This is the *qualitative* gate property, **bounded by `Pmac`** — not unconditional.

**Argued, NOT a theorem (stated so no over-claim is read in):**
- The **availability** property — "an unconfirmed R never blocks a keyless I" / "no worse-than-HIGH-1
  lockout" — is a **liveness argument** (spec §3/§6), not a trace-safety property ProVerif/CryptoVerif
  decides. The `.pv` models the bootstrap faithfully (confirmed + unconfirmed responder copies both run,
  reconnect.pv `:459-462`) and asserts only the *safety* consequence that IS expressible (the fail-open
  ungated path still authenticates + keeps secrecy). Liveness itself is argued, not machine-checked.
- The **quantitative DoS-amplification bound** is the rate-limiter engineering constant
  (`reconnect-gate.ts` window sizes; spec open-q #4), **not** a CryptoVerif theorem. `chat-handshake-macr.cv`
  proves only the qualitative gate (no asymmetric work without RGK); the absolute amplification factor is
  an operational parameter.

## 2. What the proofs cover — and what they do NOT

**ProVerif (`chat-handshake.pv`, symbolic, perfect primitives):** the full message choreography and the
protocol logic. Proved: I-authenticates-R injective agreement, c_idI identity-payload secrecy, RK
secrecy. R-authenticates-I: non-injective proved; injectivity rests on durable one-time-prekey
consumption (the C-2/TOCTOU property, `:287`).

**CryptoVerif — key-schedule, two granularities:**
- `chat-handshake-hybrid-{dhleg,kemleg}.cv`: the collapsed core `RK = ROM(es, ss)`.
- `chat-handshake-fullchain-{dhleg,kemleg}.cv`: the **actual implemented 5-step MixKey chain**
  (`handshake.ts:174-217`), `es→ss_pre→ee→se→ss_I→RK`. Both legs proved: RK ≈ random if **either**
  X25519 (CDH) or ML-KEM (IND-CCA2) survives, with **every** other mixed secret handed to the adversary
  — the dual-PRF "one good secret saturates the chain" property over the real chain. ✓

**Computational authentication (`chat-handshake-auth.cv`):** **injective agreement both directions**
proved under Ed25519 UF-CMA — R-authenticates-I and I-authenticates-R, i.e. mutual authentication with
**no replay and no UKS** (each accept maps 1:1 to a matching peer run on the session-unique ephemerals).
Identities are pinned (the TOFU safety-number model). Notably, R-auth-I injectivity is proved to rest on
**single-use prekeys**: with the prekey replicated it fails (replayable Msg1); with single-use (the
durable `consume()`, `:287`) it holds — the computational counterpart of the ProVerif finding and the
TOCTOU fix. ✓

**KCI resistance (`chat-handshake-kci-reveal{R,I}.cv`):** compromising a party's OWN long-term signing
key does not let the adversary impersonate the peer to them. Proved both directions: with skR revealed,
R-authenticates-I still holds (rests on skI); with skI revealed, I-authenticates-R still holds (rests on
skR). Each is the injective query of the surviving direction. ✓

**Forward secrecy (`chat-handshake-fs-{classical,pq}.cv`):** RK stays secret under **full long-term-key
compromise** (statics handed to the adversary) because the chain mixes secrets that used deleted
ephemerals. Hybrid, both legs proved: classical FS via `ee` (ephemeral-ephemeral DH, CDH) with all
statics + ML-KEM revealed; PQ FS via `ss_I` (ML-KEM to the deleted ephemeral ek_I, IND-CCA2 + decap
oracle) with all X25519 incl. `ee` revealed. FS holds if EITHER ephemeral primitive survives. ✓

**Unified KDF→AEAD model (`chat-handshake-unified.cv`):** the AEAD keys (hk1, hk2) are derived from the
same KDF chain key CK as RK, and c_idI/c_confR are emitted under them. Proves **RK stays secret in the
presence of those AEAD encryptions** (the bound carries the AEAD `Penc` term) — the KDF→AEAD layers
compose; deriving the AEAD keys from the chain doesn't compromise the root key. ✓ (classical leg)

**NOT yet covered (the gap that keeps "formally verified" from being claimable):**
1. ~~The full 5-step MixKey chain~~ — **DONE** (fullchain files).
2. ~~Computational mutual authentication / UKS / replay~~ — **DONE** (`chat-handshake-auth.cv`).
3. ~~KCI (key-compromise impersonation)~~ — **DONE** (`chat-handshake-kci-reveal{R,I}.cv`).
4. ~~Forward secrecy (computational, hybrid)~~ — **DONE** (`chat-handshake-fs-{classical,pq}.cv`).
5. ~~Unified KDF→AEAD secrecy composition~~ — **DONE** (`chat-handshake-unified.cv`).
6. ~~Computational G2′ (c_idI identity confidentiality)~~ — **DONE** (`chat-handshake-g2prime.cv`):
   modelling the AEAD as **IND$-CPA** (ciphertext ≈ random — faithful to ChaCha20-Poly1305) and taking
   hk1 as the secret random the chain models discharge, `secret idsecret` is proved. Composition:
   {hk1 secret (chain/unified models)} + {IND$-CPA hides a fixed-length plaintext (this)} ⇒ G2′,
   computationally. (Symbolic G2′ also holds: `chat-handshake.pv`, `not attacker(s_id)`.)
**In-house Gate 1 — completed with an internal adversarial audit** (`internal-audit-2026-06-08.md`).
The audit (red-team + crypto-audit + skeptic + full re-verification) found one **Critical** —a
handshake→session frame-handoff bug that dropped the first message— now **FIXED** (commit 1e36a8b, with
a regression test). It also recorded HIGH/MEDIUM items that are NOT closed and NOT cryptographic breaks
of the shipped first_contact path: reconnect-prekey strand (availability), a narrow crash-window FS
degradation in storage-level injectivity, and the **silent pin-before-verify** UX gap (shipped behaviour
weaker than the proofs' pinning assumption). See the audit report for status + recommendations.

**Honest verified scope** (updated 2026-06-09, reconnect-hardening v4): **symbolic (first_contact AND
reconnect incl. the Reject branch) + computational (key-schedule full chain, mutual auth, KCI, forward
secrecy, unified KDF→AEAD, G2′, AND the reconnect `mac_R` DoS-gate unforgeability).** The reconnect key
schedule is the SAME chain as first_contact (es/ee/se/ss_pre/ss_I), so the existing computational
secrecy/auth/KCI/FS proofs transfer unchanged; the reconnect work ADDS the symbolic reconnect+Reject
model and the computational `mac_R` gate proof on top of that established secrecy. Precise caveats:
symbolic reconnect proves I-auth-R **injective**, R-auth-I **non-injective** (injectivity lifted via
single-use prekey consumption, as first_contact), recovery soundness, and `s_id`/`s_rk`/`s_retry`
secrecy; computational proves `mac_R` unforgeability up to `Pmac`; **availability is argued, not a
theorem**, and the **quantitative DoS bound is an engineering constant, not a proof** (see §1b/3b).

NOT yet verified: the first_contact **`mac_T` keyed-MAC DoS property** (modelled as a plain hash in
`chat-handshake.pv`; LOW-1 in the audit — note the *reconnect* `mac_R` gate IS now computationally
proved, but `mac_T` is a separate, still-unmodelled gate), and the **storage-level injectivity
invariant** (the models assume single-use; the durable guarantee lives in `prekey-store.ts`, with a
crash window).

**Remaining gates are EXTERNAL and cannot be self-cleared:** an independent third-party **audit** and the
**FIPS-validated module build**. A *simulated/in-house* audit (this report) does not satisfy the external
gate — it lacks blind-spot independence — so user-facing text must not claim "externally audited" or
"FIPS-validated." The operator may drop "EXPERIMENTAL" on accepted internal-review risk with honest
wording: e.g. "formally verified (symbolic + computational), internally adversarially reviewed; not
independently audited; not FIPS-validated."

## 3. Implementation audit (tools are blind to this)

**Constant time.** The two secret-dependent equality checks both use `constantTimeEqual`
(Node `crypto.timingSafeEqual`): the token-MAC pre-gate (`handshake.ts:256`) and the reconnect
pinned-identity check (`:283`). AEAD tag verification, HKDF, SHA-256, HMAC all run in Node native
(OpenSSL) code. No secret-dependent `===` / branch on key bytes found in the handshake path. **Clean**
for the symmetric/compare paths.

**`@noble/curves` constant-time audit (classical leg) — FINDING, LOW severity.** `@noble/curves` **2.2.0**
backs X25519/Ed25519 (`crypto.ts:20,57-90`). Its own README is explicit: *"Field operations are not
constant-time"* and it targets only *algorithmic* constant time, noting JIT + GC make real
constant-timeness "extremely hard." So noble makes **no constant-time guarantee**. The secret-dependent
call sites are: `x25519.getSharedSecret` (ECDH, `:69`), `ed25519.sign` (`:83`), and the `getPublicKey`
scalar-mults (`:62,79`). This is a residual **timing side-channel on the classical leg**.
*Severity LOW for DCS98's threat model:* the handshake runs these once per session over high-latency,
noisy **Tor** (remote timing impractical); a local co-resident attacker can read process memory anyway;
and the PQ leg (the harvest-now-decrypt-later concern) is ML-KEM in **out-of-process AWS-LC**
(constant-time-designed C), unaffected.
*Recommendation (operator):* to close it symmetrically, route X25519/Ed25519 through the **same AWS-LC
sidecar** as ML-KEM (constant-time-designed C), or accept the residual under the threat model. Either way
it is a documented residual, not a correctness bug. A hardware-timing measurement on the shipped Windows
build is the remaining empirical step (cannot be done from source review).

*Other residual:* **zeroization** (`crypto.ts:199`, used `handshake.ts:221,311`) is best-effort — V8 may
keep un-wipeable copies (GC'd buffers, immutable strings); inherent JS limit (the reason noble's
Uint8Array-end-to-end API is used over Node's JWK path, `crypto.ts:53-55`).

**Untrusted-input parsers — FUZZED (`test/chat-fuzz.test.ts`, ~7.5k seeded inputs).** `FrameDecoder.push`
(`wire.ts:86`), `decodeKemPrekey` (`identity.ts:171`), `decodeIdentityPublic` (`identity.ts:83`), and
`parseInvite` (`invite.ts:94`): for any input each either returns a canonical result or throws **only its
declared error type** — no unexpected exception, no OOM on a hostile declared length, split-invariant for
the streaming decoder, strict-canonical round-trip. **No findings** — the parsers validate
version/known-type/length-cap *before* buffering and reject non-canonical encodings. `Cursor.take`
(`handshake.ts:133`) is bounds-checked and exercised via the handshake's truncation handling (internal;
not separately exported).

## 4. Doc↔code drift found + fixed (2026-06-08)

- `handshake.ts:11` said "ML-KEM-768" — code is 1024. **Fixed.**
- `crypto.ts:4-5` header claimed X25519/Ed25519 come from "Node's built-in crypto" — they use
  `@noble/curves` (the later note `:53-55` explains why; header wasn't updated). **Fixed.**
- `constants.ts:11` SUITE_ID correctly reads `mlkem1024` — no drift.

## 5. Gate-1 remaining roadmap

1. **End-to-end CryptoVerif model** (§2 items 1–4) — the big lift; extends the two leg files toward the
   full handshake with computational auth + secrecy + FS.
2. **Model↔code correspondence** kept in sync as the model grows (this doc).
3. **Fuzzing harness** over the §3 parsers.
4. **Constant-time audit** of the noble curve ops on the shipped build.
Only when 1–4 land (plus an external audit + the FIPS module build, both outside Gate 1) should the
banner wording change — and that flip is the operator's call.
