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

**NOT yet covered (the gap that keeps "formally verified" from being claimable):**
1. ~~The full 5-step MixKey chain~~ — **DONE** (fullchain files above).
2. **Computational authentication** (mutual auth / KCI / UKS) — only symbolic so far. *Now the largest
   remaining piece.*
3. The **transcript binding + signatures + AEAD key-confirmation** inside a computational model (Sig_I /
   Sig_R over TH1/TH3, c_idI/c_confR), i.e. a PQXDH-grade end-to-end model.
4. **Forward secrecy** computational bounds (the ee/ss_I legs after static-key compromise).
This is the end-to-end CryptoVerif model — the substantial remaining Gate-1 work (multi-session).

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

**Untrusted-input parsers (fuzz targets, look robust on read):** `FrameDecoder.push` (`wire.ts:86`,
validates version + known-type + length-cap *before* buffering), `decodeKemPrekey` (`identity.ts:171`,
length + flag checked), `Cursor.take` (`handshake.ts:133`, bounds-checked). A fuzzing harness over these
is open Gate-1 work.

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
