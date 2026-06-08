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
| HIGH-1 | High | Reconnect-prekey strand: dial-on-demand reconnect (`engine.ts:131,155`) burns a one-time prekey; a drop after the responder durably `consume()`s it but before the initiator persists the new rotation prekey permanently locks out reconnect (`unknown or consumed prekey`), recoverable only by a fresh invite. **Reachable in normal use.** | **OPEN — needs protocol work (do NOT rush).** Confirmed real + reachable. The clean fix is the **spec-anticipated `prekey_unknown` recovery flow** (Med-7 in the construction spec): R sends a typed rejection + current prekey, I retries — a new wire message. NOTE: the initiator currently only sees a generic "stream closed" (R's reason isn't conveyed), so no safe initiator-side minimal patch exists. A "make the reconnect prekey reusable" hack would reopen the replay/double-accept window → rejected. **Scope with MED-2 as a reconnect-hardening workstream (recovery flow + DoS pre-gate + formal model), then re-verify.** |
| HIGH-2 | ~~High~~ → **Info** | *Claimed:* in-memory reservation lost on crash → replayed Msg1 served twice → `ss_pre` reuse. | **VERIFIED NOT EXPLOITABLE (audit over-stated).** `consume()` is a durable fsync delete at `handshake.ts:287` that runs BEFORE Msg2 (`:305`) and session establishment (`:309`). Case analysis: crash *before* consume ⇒ prekey survives but **no session was established** (a later replay/retry is the first completed use — one session); crash *after* consume ⇒ prekey durably gone ⇒ replay rejected. There is **no window where a session completes yet the prekey survives**, so no double-session across crashes. The in-memory reservation only needs to cover concurrent same-process replay (it does). **No change.** |
| MED-1 | Medium | **Silent pin-before-verify.** `handshake.ts:280` pins TOFU unconditionally; the auth proofs assume `is_R` is verified, but the shipped UX had no way to ever mark a contact verified. | **FIXED** (commit c243c4c): `chat.setVerified` + IPC + a prominent red UNVERIFIED banner with a confirm-gated "Mark as verified" (requires out-of-band safety-number comparison); shows "✔ verified" after. Shipped behaviour now matches the proofs' assumption. |
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

## Disposition (2026-06-08, after follow-up verification + fixes)

- **CRIT-1 — FIXED** (1e36a8b) with a red/green regression test.
- **MED-1 — FIXED** (c243c4c): unverified contacts are now surfaced + verifiable.
- **HIGH-2 — VERIFIED NOT EXPLOITABLE** and downgraded to Info: the durable-consume-before-completion
  ordering means a surviving prekey implies no completed session, so there is no cross-crash
  double-session. No change. (Lesson: a self-run audit's findings still need independent verification —
  this one was over-stated; an external auditor's fresh eyes remain the un-self-clearable gate.)
- **HIGH-1 — OPEN, real, reachable.** The correct fix is the spec's `prekey_unknown` recovery flow; it is
  protocol work and must be scoped + re-verified with reconnect mode (MED-2), not hot-patched.
- **MED-2/3, LOW-1..4, INFO — documentation / scoped protocol+model work** (see table).

## Bottom line

The cryptographic composition is sound; the one Critical was **plumbing around** the crypto (the
handshake→session frame handoff), now fixed with a regression guard, and the verification-UX gap (MED-1)
is closed. The one remaining substantive issue is **HIGH-1 reconnect availability**, whose correct fix is
the spec-anticipated recovery flow — protocol work to be done with the reconnect formal model, not
rushed. The earlier-claimed crash-window FS issue (HIGH-2) was **verified to be a non-issue**. None of the
findings is a confirmed cryptographic break of the shipped first_contact path. Honest verified scope:
**symbolic (first_contact) + computational (key-schedule, mutual auth, KCI, FS, unified KDF→AEAD, G2′);
reconnect mode, the keyed-MAC DoS gate, and the storage-level injectivity invariant remain unverified.**
The EXPERIMENTAL banner's *external* gates (independent audit, FIPS module) are unmet by definition; the
operator may drop "EXPERIMENTAL" on accepted internal-review risk using honest wording, but not the
words "externally audited" or "FIPS-validated."
