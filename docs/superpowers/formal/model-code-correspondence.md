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

**NOT yet covered (the gap that keeps "formally verified" from being claimable):**
1. ~~The full 5-step MixKey chain~~ — **DONE** (fullchain files).
2. ~~Computational mutual authentication / UKS / replay~~ — **DONE** (`chat-handshake-auth.cv`).
3. ~~KCI (key-compromise impersonation)~~ — **DONE** (`chat-handshake-kci-reveal{R,I}.cv`).
4. ~~Forward secrecy (computational, hybrid)~~ — **DONE** (`chat-handshake-fs-{classical,pq}.cv`).
5. **AEAD layer abstracted in the auth model** — Sig_I/Sig_R are modelled in clear; the c_idI/c_confR
   AEAD provides identity-confidentiality (G2′, symbolic-only so far) + key-confirmation, not auth. A
   single end-to-end model unifying auth + the AEAD/secrecy layer is the remaining consolidation.
Item 5, plus the **noble constant-time audit** (§3 residual), then an external audit + the FIPS module
build, remain before the banner can change. (The fuzzing harness — §3 — is **done**:
`test/chat-fuzz.test.ts`.)

## 3. Implementation audit (tools are blind to this)

**Constant time.** The two secret-dependent equality checks both use `constantTimeEqual`
(Node `crypto.timingSafeEqual`): the token-MAC pre-gate (`handshake.ts:256`) and the reconnect
pinned-identity check (`:283`). AEAD tag verification, HKDF, SHA-256, HMAC all run in Node native
(OpenSSL) code. No secret-dependent `===` / branch on key bytes found in the handshake path. **Clean**
for the symmetric/compare paths.

*Residual (documented limitations, not bugs):*
- **X25519 / Ed25519 via `@noble/curves`** (`crypto.ts:20,57-90`) run in V8 JIT; source-level constant
  time can be defeated by the JIT (the classical-leg analogue of the KyberSlash concern). ML-KEM itself
  is out-of-process in AWS-LC (constant-time-designed). A timing audit of the noble curve ops on the
  target build is open work.
- **Zeroization** (`crypto.ts:199`, used `handshake.ts:221,311`) is best-effort: V8 may keep
  un-wipeable copies of key material (GC'd buffers, immutable strings). Inherent JS limitation; the
  reason noble (Uint8Array end-to-end) is used over Node's JWK path (`crypto.ts:53-55`).

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
