# DCS98 chat handshake — internal adversarial audit (2026-06-08)

**Provenance (read this first).** This is an **in-house / simulated** adversarial cryptanalytic audit,
run by the project itself via three independent adversarial passes (red-team on the implementation,
crypto-audit on the construction + formal models, skeptic on the load-bearing assumptions) plus a full
re-run of the formal kit. It is **NOT an independent third-party external audit.** A simulated audit can
match a real one on *coverage* and *mechanization*, but it structurally cannot supply the one thing an
external audit exists for — **independence of the blind spot**: anything the authors didn't think to
model is, by construction, absent from both the code and the proof, and a self-run "red-team hat"
session shares the authors' ontology. (The PQXDH formal-analysis precedent — Bhargavan et al., USENIX
Security 2024 — is the empirical case in point: the tool authors found real spec flaws only by modelling
*someone else's* protocol with fresh eyes.) Therefore this report does **not** license the user-facing
claims "externally audited" or "FIPS-validated"; it licenses "formally verified (symbolic +
computational) + internal adversarial review, residual risk accepted by the operator."

**Method.** Re-ran the formal kit under ProVerif 2.05 / CryptoVerif 2.12: **11/11 CryptoVerif files
reproduce "All queries proved"**; ProVerif reproduces 4/5 (the R-auth-I injective query proves
non-injectively only — disclosed, structurally explained, and discharged computationally in
`chat-handshake-auth.cv` via single-use prekeys). Reviewed `handshake.ts`, `crypto.ts`, `constants.ts`,
`identity.ts`, `invite.ts`, `wire.ts`, `prekey-store.ts`, `contact-store.ts`, `session.ts`,
`connection.ts`, `engine.ts`, `services/mlkem-sidecar.ts`, `tools/mlkem-helper/mlkem-helper.c`.

## Findings

| # | Sev | Finding | Status |
|---|---|---|---|
| CRIT-1 | **Critical** | Handshake→session handoff dropped the peer's first post-handshake message and desynced the ratchet: `acceptInbound`/`connect` `await`ed `contacts.update` before `attach()`, the transport doesn't buffer for late subscribers, and `HandshakeIO` stayed subscribed and swallowed the frame. | **FIXED** (commit 1e36a8b): attach synchronously before any await; `HandshakeIO.detach()` on success; reproducing regression test (red/green verified). |
| HIGH-1 | High | Reconnect-prekey strand: a stream drop after the responder durably `consume()`s the one-time reconnect prekey but before the initiator persists the new rotation prekey permanently locks out reconnect (`unknown or consumed prekey`), recoverable only by a fresh out-of-band invite. | **DEFERRED — design decision.** Rec: keep the previous reconnect prekey valid one extra round, OR have the initiator fall back to a fresh invite flow on `prekey_unknown` instead of hard-failing. Don't durably consume until Msg2 send is confirmed. |
| HIGH-2 | High→Med | Injective R-auth-I rests on durable single-use consumption, but the lookup→consume reservation is **in-memory only**; a crash in that window leaves the one-time prekey on disk with the reservation gone, so a replayed Msg1 can be served twice → reused `ss_pre` → PQ-FS degradation for those sessions. (Narrow crash window + requires a captured-Msg1 replay → effectively Medium.) | **DEFERRED — design decision.** Rec: make the reservation durable (WAL), OR fold an R-contributed fresh nonce into TH1 so injectivity comes from the transcript (wire change → bump SUITE_ID, re-run proofs). |
| MED-1 | Medium | **Silent pin-before-verify.** `handshake.ts:280` `contacts.pin(peer)` on first contact unconditionally; the session is fully usable before any safety-number comparison. Every auth/KCI proof *assumes* `is_R` is pinned-as-verified; shipped UX makes verification optional. This is the place shipped behaviour is weaker than the proofs assume. | **OPEN — operator/UX decision.** Rec: surface `contact.verified` (the field exists) — mark unverified contacts loudly and/or gate first send until the safety number is compared; OR narrow the claim to "authenticated **given** out-of-band verification." Fixable without touching a proof. |
| MED-2 | Medium | Reconnect mode is covered by **no** formal model (all .pv/.cv are first_contact) and has **no cheap pre-gate** (the `mac_T` gate is first_contact-only) → asymmetric-work / KEM-pipe-HOL DoS amplification on forged reconnect Msg1. | **DEFERRED.** Rec: add reconnect to `chat-handshake.pv` (pinned-static, mode=reconnect, re-assert downgrade + agreement); add a reconnect pre-gate (MAC under a key both sides share from the prior session). Until then, drop reconnect from "verified." |
| MED-3 | Medium | `chat-handshake-unified.cv` derives hk1, hk2, RK from one chain key; the code derives **hk1 at the intermediate CK2** (es+ss_pre only) and hk2/RK at CK5. The model's collapse is a *sound over-approximation* for RK secrecy but misrepresents what protects c_idI. | **DOC** — annotate the model; the conclusion (RK secret through the AEAD layers) stands. |
| LOW-1 | Low | `mac_T` token pre-gate modelled as a plain hash (`chat-handshake.pv`), not a keyed MAC → its DoS-resistance (C-1) is not formally covered. AEAD AAD=`H(T)` provides a second token check, so not exploitable. | DOC / optional MAC model. |
| LOW-2 | Low | "No UKS" proved in a two-honest-party model with no adversary-registered key. Defensible for TOFU-pinned 1:1, but the claim is stronger than the model. | DOC — soften to "no UKS given correct pinning," or add a dishonest registrant. |
| LOW-3 | Low | `@noble/curves` 2.2.0 classical leg is **not constant-time** (its README says so); secret-dependent sites `crypto.ts:62,69,79,83`. Timing samples on the *long-term* `xs_I`/`is_I` accumulate across sessions (not just once). Tor latency/noise → impractical remotely; severity rests on an **unmeasured** assumption. | **ACCEPTED residual** (operator). Rec: route X25519/Ed25519 through the AWS-LC sidecar to match the PQ leg, or take the hardware-timing measurement on the shipped build to confirm LOW. |
| LOW-4 | Low | SID derived from the same secret CK as RK but never modelled; publishing SID is ROM-safe but unchecked. | DOC / add SID output to the unified model. |
| INFO | Info | Cosmetic model↔code mismatches: c_confR AAD is empty in code vs `MIX_INIT` in `.pv`; the `.pv` re-emits the G2′ sentinel inside c_confR (plumbing artifact). No security effect. | DOC. |

## What held up (explicitly)

AEAD nonce handling (NONCE0 reused only across **distinct** keys hk1/hk2; session ratchet uses
counter-nonces with no (key,nonce) reuse), the prekey **concurrent** double-consume guard
(reserve-on-lookup), fixed-width 1024 parse (equal pub/ct widths safe via positional parsing + size
re-checks), verify-before-encap ordering, transcript binding completeness, the sidecar fail-closed
posture (no-provider/ hash-mismatch/ oversize/ timeout all fail closed; secrets `OPENSSL_cleanse`d), and
the hybrid structure (each leg hands the other primitive to the adversary). The dual-PRF MixKey arg
roles (secret=IKM, CK=salt) are implemented correctly and match the models.

## Bottom line

The cryptographic composition is sound; the one Critical was **plumbing around** the crypto (the
handshake→session frame handoff), now fixed with a regression guard. The remaining findings are
**availability** (HIGH-1), a **narrow crash-window FS degradation** (HIGH-2), a **deployment-vs-proof
gap in verification UX** (MED-1), and **model-fidelity/coverage** items (MED-2/3, LOW-*) — none is a
confirmed cryptographic break of the shipped first_contact path. Honest verified scope:
**symbolic (first_contact) + computational (key-schedule, mutual auth, KCI, FS, unified KDF→AEAD, G2′);
reconnect mode, the keyed-MAC DoS gate, and the storage-level injectivity invariant remain unverified.**
The EXPERIMENTAL banner's *external* gates (independent audit, FIPS module) are unmet by definition; the
operator may drop "EXPERIMENTAL" on accepted internal-review risk using honest wording, but not the
words "externally audited" or "FIPS-validated."
