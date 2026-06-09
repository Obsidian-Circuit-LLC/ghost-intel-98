# Reconnect-Hardening (handshake v4) Implementation Plan — rev 4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat reconnect path self-healing (no permanent prekey strand), DoS-gated, and formally re-verified — closing audit findings HIGH-1 and MED-2 — under the rev-4 spec that survived three adversarial-review passes.

**Architecture:** Bump the handshake suite to **v4**. Add (a) a reconnect DoS gate `mac_R` keyed by a stable per-contact `RGK = HKDF(RK,SID,…)` derived at the establishing handshake, with an **enforcement bootstrap** — I always *sends* `mac_R` once it holds RGK; R *enforces* it only after it has directly verified one valid `mac_R` from the contact (`rgkPeerConfirmed`), failing open (ungated, rate-limited) until then; resolved before asymmetric work via a **per-contact** `prekey_id → cid` issuance index; (b) an authenticated `prekey_unknown` **Reject** (`hs_type` tag on the responder reply, `Sig_R_reject` over the Msg1-cleartext transcript `TH_R0`) + a single initiator retry against an offered (re-offered, not minted-per-Reject) prekey, so a consumed/stale rotation prekey recovers in-band; (c) a **split + deduped** ungated-path rate-limit so a flood can't freeze legacy migrations; (d) ProVerif reconnect+Reject variant (modelled **before** the Reject code) + CryptoVerif `mac_R` assumption. Spec: `docs/superpowers/specs/2026-06-08-reconnect-hardening.md` (rev 4).

**Tech Stack:** TypeScript (main-process chat stack), Node `crypto` + `@noble/curves`, ProVerif 2.05 / CryptoVerif 2.12 (`eval $(opam env)`), vitest.

---

## Status of work already on `feat/reconnect-hardening-v4`

These were built against **rev 1** and committed. Two need **rework** to match rev 4 (the reviewers flagged exactly these):

- **Task 0.1 (v4 constants) — DONE** (75fdfb2). Still correct; Task 0.1b adds two labels.
- **Task 0.2 (RGK storage) — DONE** (d3faf88). Correct; Task 0.2b adds the `rgkPeerConfirmed` field.
- **Task 1.1 (issuance index) — DONE but WRONG shape** (2940c5a): built a *global* `issued: Record<pid,cid>` with `ISSUED_CAP=256` oldest-evict. Rev 4 goal 7 requires **per-contact** bounding. → **Task 1.1-R reworks it.**
- **Task 1.2 (offerCurrent) — DONE but WRONG behaviour** (75f7694): always mints. Rev 4 F-1 requires **re-offer newest unconsumed, mint only if none, per-cid mint cap**; the test that pins always-mint must be inverted. → **Task 1.2-R reworks it.**
- **Task 2.1 (derive RGK) — DONE** (7fbe9bd, mac_R-input corrected 9c0e212). Correct.

---

## File structure

- `src/main/chat/constants.ts` — `SUITE_ID`→v4 (done); add `DS_HS_REJECT`, `DS_MAC_R`, `RECONNECT_GATE` (done); add `HS_MSG2`/`HS_REJECT` tags; **fixed-width framing invariant** comment over the concatenated field sets.
- `src/main/chat/prekey-store.ts` — **per-contact** issuance index `{ current, recent[] }` (rework); `offerCurrent(cid)` re-offer-not-mint + per-cid mint cap (rework); `identifyContact(prekeyId)`.
- `src/main/chat/contact-store.ts` — `reconnectGateKey` (done) + **`rgkPeerConfirmed: boolean`**; both cleared atomically on identity re-pin.
- `src/main/chat/handshake.ts` — `mac_R` gen (I, always when RGK held) / verify (R, pre-asymmetric) + **enforcement-bootstrap gating** (require iff `rgkPeerConfirmed`); `hs_type` tag; `Sig_R_reject` over `TH_R0` (Msg1-cleartext); Reject emit + verify + one-retry; thread RGK + identification + the rate-limiter hook.
- `src/main/chat/reconnect-gate.ts` — **new**: the split + deduped, deterministic (injected-`now`) ungated-path rate-limiter + Msg1-fingerprint seen-set.
- `src/main/chat/engine.ts` — persist RGK on success; **set `rgkPeerConfirmed` on first valid `mac_R` verify**; call `invites.issueNext(cid)` WITH cid; reset RGK+flag on re-pin; reconnect orchestration; surface a clear hard-fail.
- `src/shared/post-mvp-types.ts` / `HandshakeResult` — carry `reconnectGateKey` (done) + `usedOfferedPrekey` + a `peerMacRVerified` signal for the engine to set the flag.
- `docs/superpowers/formal/chat-handshake.pv` — reconnect+Reject variant (**Task F-first, before 2.4**). `docs/superpowers/formal/chat-handshake-macr.cv` — new: `mac_R` PRF/SUF-CMA gate.
- Tests: `test/chat-stores.test.ts`, `test/chat-handshake.test.ts`, `test/chat-engine.test.ts`, `test/reconnect-gate.test.ts` (new).

> **Sequencing (rev 4):** rework Phase 1 first (the stale index/offer are dependencies of everything downstream). Then Phase 2 handshake. **The ProVerif reconnect+Reject model (Task F.1) is a GATE on Task 2.4 — model the Reject branch before writing it.** Then the rate-limiter (2.5), engine (Phase 3), the rest of formal (F.2/F.3), regression (Phase 5). Each task ends green + committed. `SUITE_ID`=v4 → v3↔v4 reconnect interop drops by design (first_contact unaffected; suite mismatch fails closed).

---

## Phase 0 — constants + storage deltas

### Task 0.1b: hs_type tags + framing invariant comment

**Files:** Modify `src/main/chat/constants.ts`

- [ ] **Step 1** — Add the responder-reply discriminants and a binding-invariant comment:

```ts
export const HS_MSG2 = 0;   // responder reply: accept (Msg2)
export const HS_REJECT = 1; // responder reply: prekey_unknown recovery (Reject)
// FRAMING INVARIANT (spec §4, rev-4 N-1): mac_R, TH_R0, and Sig_R_reject concatenate
// prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre (and TH_R0 also offered_prekey ‖ is_last_resort) by RAW
// concatenation under a DS prefix. This is unambiguous ONLY because every field is fixed-width.
// Any future variable-width field MUST be length-prefixed before concatenation.
```

- [ ] **Step 2** — `pnpm typecheck`. Commit: `feat(chat): hs_type tags + framing invariant (reconnect v4)`.

### Task 0.2b: `rgkPeerConfirmed` enforcement-bootstrap flag

**Files:** Modify `src/main/chat/contact-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — failing test:**

```ts
it('persists rgkPeerConfirmed and defaults it false; clears RGK+flag on identity re-pin', async () => {
  const store = new ContactStore(await tmp('contacts.json'));
  const peer = generateIdentity().publicKeys;
  await store.pin(peer);
  const id = contactId(peer);
  expect((await store.getById(id))!.rgkPeerConfirmed).toBe(false);
  await store.update(id, { reconnectGateKey: new Uint8Array(32).fill(7), rgkPeerConfirmed: true });
  expect((await store.getById(id))!.rgkPeerConfirmed).toBe(true);
  // re-pin to a NEW identity epoch must clear both (epoch-bound flag, rev-4 §3)
  await store.resetReconnectEpoch(id);
  const c = await store.getById(id);
  expect(c!.reconnectGateKey).toBeNull();
  expect(c!.rgkPeerConfirmed).toBe(false);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Add `rgkPeerConfirmed: boolean` to `Contact`/`StoredContact` (default `false`; serialize as bool), include in the `update` patch union. Add `resetReconnectEpoch(id)` that atomically sets `reconnectGateKey = null` **and** `rgkPeerConfirmed = false` (one write). This is the epoch-bound invariant — called whenever RGK changes.
- [ ] **Step 4** — Run → PASS; full `npx vitest run test/chat-stores.test.ts` green.
- [ ] **Step 5** — Commit: `feat(chat): rgkPeerConfirmed enforcement-bootstrap flag + epoch reset`.

---

## Phase 1 — prekey-store rework (per-contact index, re-offer)

### Task 1.1-R: per-contact issuance index (replaces the global oldest-evicting cap — goal 7)

**Files:** Modify `src/main/chat/prekey-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — failing test** (the rev-4 retention + coupling regression):

```ts
const MINT_CAP = 4; // per-cid outstanding-unconsumed cap (spec open-q #4); recent[] >= MINT_CAP
it('per-contact index: a quiet contact resolves after heavy churn on OTHER contacts', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  const quiet = await store.issueNext('cid-quiet');           // the id our quiet peer will present
  for (let i = 0; i < 1000; i++) await store.issueNext(`cid-other-${i}`); // churn elsewhere
  expect(await store.identifyContact(quiet.prekeyId)).toBe('cid-quiet'); // NOT evicted
});
it('per-contact index retains >= MINT_CAP recent ids per contact (coupling invariant)', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  const ids = [];
  for (let i = 0; i < MINT_CAP; i++) ids.push((await store.issueNext('cid-strand')).prekeyId);
  for (const pid of ids) expect(await store.identifyContact(pid)).toBe('cid-strand'); // all resolve
});
```

- [ ] **Step 2** — Run → FAIL (current global cap evicts `cid-quiet` after 256 other issuances).
- [ ] **Step 3** — Replace `issued: Record<pid,cid>` + global `trimIssued`/`ISSUED_CAP` with a **per-cid** structure: `issued: Record<cid, { current: string; recent: string[] }>` and a reverse `pidToCid: Record<pid,cid>` for O(1) `identifyContact`. On `issueNext(cid)`: demote the cid's old `current` into `recent[]`, set `current = pid`, trim `recent[]` to `RECENT_CAP` (= `MINT_CAP`, the coupling invariant — assert `RECENT_CAP >= MINT_CAP` at module load), and when an id falls off `recent[]` delete its `pidToCid` entry. `identifyContact(pid)` reads `pidToCid`. `consume()` still deletes only the secret from `oneTime`, never the index. (No global cap: bounded as #contacts × (1 + RECENT_CAP).)
- [ ] **Step 4** — Run → PASS; full stores suite green (adjust any rev-1 global-index test to the per-cid shape).
- [ ] **Step 5** — Commit: `fix(chat): per-contact issuance index, recent[] >= mint cap (goal 7)`.

### Task 1.2-R: `offerCurrent(cid)` re-offers, does not mint per call (F-1)

**Files:** Modify `src/main/chat/prekey-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — invert the stale test + add the re-offer test:**

```ts
it('offerCurrent re-offers the newest unconsumed issued prekey WITHOUT minting', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  const pending = await store.issueNext('cid-x');        // the prior rotation, unconsumed
  const before = await store.remaining();
  const offered = await store.offerCurrent('cid-x');
  expect(offered.prekey.prekeyId).toEqual(pending.prekeyId); // re-offer, not a fresh mint
  expect(await store.remaining()).toBe(before);              // nothing minted, nothing consumed
});
it('offerCurrent mints only when the contact has no unconsumed issued prekey; per-cid mint cap', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  const first = await store.offerCurrent('cid-y');         // none yet → mint one
  expect(await store.identifyContact(first.prekey.prekeyId)).toBe('cid-y');
  // exceed the per-cid outstanding cap → cheap fail, not unbounded mint
  for (let i = 0; i < MINT_CAP; i++) await store.issueNext('cid-y');
  await expect(store.offerCurrent('cid-y')).rejects.toThrow(/mint cap|rate/i);
});
```

(Delete/replace the rev-1 `offerCurrent returns a fresh one-time prekey ... remaining = before + 1` test — it pinned the F-1 bug.)

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Rewrite `offerCurrent(cid)`: look up the cid's newest **unconsumed** issued prekey (its `current`, else scan `recent[]` for one whose secret is still in `oneTime`); if found, return it (no mint, no consume). If none and the cid's outstanding-unconsumed count `< MINT_CAP`, mint one, index it under cid, return it. If the count is `>= MINT_CAP`, throw a cheap `PrekeyError('mint cap')`. Last-resort fallback (signed, `isLastResort=true`) only when the one-time pool is globally exhausted.
- [ ] **Step 4** — Run → PASS; stores suite green.
- [ ] **Step 5** — Commit: `fix(chat): offerCurrent re-offers pending prekey, per-cid mint cap (F-1)`.

---

## Phase 2 — handshake v4: mac_R + bootstrap, hs_type, Reject

### Task 2.2: `mac_R` gate + enforcement bootstrap (I sends when RGK held; R enforces only when confirmed)

**Files:** Modify `src/main/chat/handshake.ts`; extend `ResponderInviteStore`/`ContactPinStore`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing tests** (bootstrap semantics):

```ts
it('I sends mac_R whenever it holds RGK; an unconfirmed R accepts it ungated and confirms', async () => {
  const { rConfirmedAfter } = await runReconnect({ correctRGK: true, rStartsConfirmed: false });
  expect(rConfirmedAfter).toBe(true);   // R set rgkPeerConfirmed on the valid mac_R
});
it('a CONFIRMED R rejects a wrong/missing mac_R at the pre-gate (before asymmetric work)', async () => {
  await expect(runReconnect({ correctRGK: false, rStartsConfirmed: true }))
    .rejects.toThrow(/mac_R|reconnect gate/i);
});
it('an UNCONFIRMED R does NOT require mac_R (fail open): a keyless I still completes ungated', async () => {
  const { iRes } = await runReconnect({ initiatorHasRGK: false, rStartsConfirmed: false });
  expect(iRes.session).toBeTruthy();    // no lockout — the rev-4 bootstrap safety property
});
it('an attacker cannot flip rgkPeerConfirmed with a forged mac_R', async () => {
  const { rConfirmedAfter } = await runReconnect({ forgedMacR: true, rStartsConfirmed: false });
  expect(rConfirmedAfter).toBe(false);  // forged mac_R fails verify → flag stays false
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — `mac_R` is keyed over the Msg1 CLEARTEXT (spec §3): `macRInput = concatBytes(DS_MAC_R, th0, prekeyId, xeI.publicKey, ekI.publicKey, enc.cipherText)`. **Initiator (reconnect):** if it holds an RGK for the contact, set `macR = hmacSha256(rgk, macRInput)` in Msg1's gate slot; always send it when RGK held. **Responder:** parse mode + Msg1 cleartext; if reconnect, `cid = await invites.identifyContact(prekeyId)`; `rgk = cid && await contacts.getReconnectKey(cid)`; `confirmed = cid && await contacts.isRgkConfirmed(cid)`.
  - If `rgk && confirmed`: **require** `constantTimeEqual(macR, hmacSha256(rgk, macRInput))` **before** `lookup`/`mlkemDecapsulate`/ECDH; mismatch/absent → `HandshakeError('reconnect gate failed')` (cheap close).
  - Else (no rgk, or not yet confirmed): **do not require** `mac_R`; take the ungated path (rate-limited — Task 2.5). If `rgk` and a `mac_R` is present, verify it cheaply; on success signal `peerMacRVerified=true` in the result so the engine sets `rgkPeerConfirmed` (Task 3.1).
  Extend `ResponderInviteStore` with `identifyContact`; `ContactPinStore` with `getReconnectKey(cid)` + `isRgkConfirmed(cid)`.
- [ ] **Step 4** — Run → PASS; `npx vitest run test/chat-handshake.test.ts` green.
- [ ] **Step 5** — Commit: `feat(chat): mac_R gate + enforcement bootstrap (rev-4 §3)`.

### Task 2.3: `hs_type` tag on the responder reply

**Files:** Modify `src/main/chat/handshake.ts`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing test:**

```ts
it('initiator rejects an unknown hs_type in the responder reply', async () => {
  await expect(runReconnectWithTamperedReply((b) => { b[0] = 0x7f; return b; }))
    .rejects.toThrow(/hs_type|unexpected reply/i);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Prepend `Uint8Array.of(HS_MSG2)` to the responder Msg2 payload; initiator reads `hs_type = cursor.byte()` first and branches (`HS_MSG2` → existing parse; `HS_REJECT` → Task 2.4; else throw). Fold `hs_type` into `th3` so Msg2's `Sig_R` covers it.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): typed responder reply (hs_type) for Msg2/Reject`.

### Task F.1 (GATES Task 2.4): ProVerif reconnect + Reject model FIRST

> Spec §Formal: the accept-vs-reject branch is the canonical self-audit blind spot; model it before writing it.

**Files:** Modify `docs/superpowers/formal/chat-handshake.pv`

- [ ] **Step 1** — Add a `mode=reconnect` process: pinned-static equality (no TOFU pin); `mac_R` as a keyed MAC under a fresh `RGK` shared by I and R, **enforced only after R has seen one valid `mac_R`** (model the bootstrap as a flag set on first verify); the `hs_type`-tagged reply; the **Reject branch** — R emits `Sig_R_reject` over `DS_HS_REJECT ‖ TH_R0 ‖ offered ‖ is_last_resort` where **`TH_R0` is the Msg1-cleartext transcript** (NOT TH1); I verifies + retries once.
- [ ] **Step 2** — Queries: injective agreement both directions (reconnect); downgrade (no mode/hs_type/last-resort coercion; no `Sig_R`↔`Sig_R_reject` substitution across the DS prefixes); **recovery soundness** (a Reject not signed by pinned `is_R` cannot make I complete against an attacker prekey; a Reject can't be replayed onto a different Msg1 since `TH_R0` binds this Msg1's cleartext); no-double-accept; **no worse-than-HIGH-1 lockout** is an availability property — assert at least that an unconfirmed R never blocks on the gate.
- [ ] **Step 3** — Run: `eval $(opam env) && proverif docs/superpowers/formal/chat-handshake.pv`. Save `proverif-reconnect-<date>.txt`. **If a query fails, fix the DESIGN (and this plan) before implementing 2.4.**
- [ ] **Step 4** — Commit: `docs(formal): ProVerif reconnect+Reject model (gates the impl)`.

### Task 2.4: authenticated Reject + one-retry recovery (fixes HIGH-1) — only after F.1 proves

**Files:** Modify `src/main/chat/handshake.ts`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing tests (HIGH-1 regression + F-5):**

```ts
it('reconnect self-heals when the rotation prekey was already consumed (Reject→retry)', async () => {
  const { iRes } = await runReconnectWithConsumedPrekey();
  expect(iRes.session).toBeTruthy();
  expect(iRes.usedOfferedPrekey).toBe(true);
});
it('initiator rejects a forged Reject (bad Sig_R_reject)', async () => {
  await expect(runReconnectWithForgedReject()).rejects.toThrow(/reject signature|invalid/i);
});
it('a Reject is bound to THIS Msg1 (TH_R0): replaying it onto a different Msg1 is rejected', async () => {
  await expect(runReplayRejectOntoDifferentMsg1()).rejects.toThrow(/reject signature|invalid/i);
});
it('a second Reject in one dial is a hard fail (one-retry-per-dial cap)', async () => {
  await expect(runReconnectDoubleReject()).rejects.toThrow(/reconnect failed|fresh invite/i);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Responder: `mode=reconnect`, gate satisfied, but `invites.lookup(prekeyId)` null while `identifyContact` resolved the cid → `offered = await invites.offerCurrent(cid)`; compute `THR0 = sha256(concatBytes(MIX_INIT, th0, prekeyId, xeI.publicKey, ekI.publicKey, ctPre))`; `sigReject = ed25519Sign(concatBytes(DS_HS_REJECT, THR0, encodeKemPrekey(offered.prekey), Uint8Array.of(offered.isLastResort?1:0)), ed25519Pair(identity))`; send `concatBytes(Uint8Array.of(HS_REJECT), encodeKemPrekey(offered.prekey), Uint8Array.of(offered.isLastResort?1:0), sigReject)`; abort this attempt **without consuming**. Initiator: on `HS_REJECT`, recompute `THR0` from its own Msg1 cleartext, verify `sigReject` under pinned `is_R`; verify `offered`'s prekey signature; if `isLastResort` surface/flag (don't silently proceed unless allowed); **retry once per dial** with the offered prekey (fresh `xe_I`/`ek_I`/`ct_pre`); a second `HS_REJECT` → `HandshakeError('reconnect failed — request a fresh invite')`. Set `usedOfferedPrekey`.
- [ ] **Step 4** — Run → PASS; handshake suite green.
- [ ] **Step 5** — Commit: `fix(chat): in-band reconnect recovery, Sig_R_reject over TH_R0 (HIGH-1, F-5)`.

### Task 2.5: split + deduped ungated-path rate-limiter (N-3) + last-resort-on-reconnect reject + offerCurrent re-offer-first (#40)

**Files:** Create `src/main/chat/reconnect-gate.ts`; modify `handshake.ts`, `prekey-store.ts`; Test `test/reconnect-gate.test.ts`, `test/chat-stores.test.ts`

- [ ] **Step 0 — offerCurrent re-offer-FIRST refinement (#40, spec §2 fidelity).** The shipped 1.2-R `offerCurrent` checks the per-cid count cap BEFORE re-offering, so a legit stranded peer at ≥cap unconsumed prekeys is refused recovery — contradicting spec §2 ("first returns the newest unconsumed"). Rework `offerCurrent(cid)` to: **(1) re-offer** the newest unconsumed issued prekey for `cid` (current, else newest unconsumed in recent[]) — return it, never throw, no mint, no consume; **(2) mint** only when the cid has NO unconsumed issued prekey; **(3) remove the in-store `PrekeyError('mint cap')` throw** entirely — the mint bound now lives in re-offer-first (≤1 outstanding offerCurrent-mint per cid) + the per-dial responder reject cap (Task 2.4, already shipped) + the rate-limiter below. Rewrite the 1.2-R cap-throw test: replace the `rejects.toThrow(/mint cap|rate/i)` case with one asserting re-offer-first never throws when an unconsumed prekey exists (issue N>cap, all unconsumed → offerCurrent returns the newest, no throw, remaining unchanged). Keep the "mint only when none unconsumed" + "re-offer without minting" tests. Commit this as its own step: `fix(chat): offerCurrent re-offers first, drop in-store mint-cap throw (#40, spec §2)`.

- [ ] **Step 1 — failing tests:**

```ts
it('reserved bucket (store-resolvable ids) is not starved by an unresolvable-id flood', () => {
  const rl = new ReconnectRateLimiter({ now: () => tick });
  for (let i=0;i<1000;i++) rl.admit({ resolvable:false, fp:`g${i}` }); // garbage flood
  expect(rl.admit({ resolvable:true, fp:'legit' }).allowed).toBe(true); // migration still passes
});
it('dedup: a replayed identical Msg1 fingerprint does not reuse reserved capacity', () => {
  const rl = new ReconnectRateLimiter({ now: () => tick });
  const a = rl.admit({ resolvable:true, fp:'same' });
  const b = rl.admit({ resolvable:true, fp:'same' });
  expect(a.allowed).toBe(true); expect(b.allowed).toBe(false); // deduped
});
it('seen-set is sized >= reserved window (no eviction out-pacing the bucket)', () => {
  const rl = new ReconnectRateLimiter({ now: () => tick });
  expect(rl.seenSetSize).toBeGreaterThanOrEqual(rl.reservedWindow);
});
it('handshake rejects a reconnect Msg1 carrying a last-resort prekey_id (kind check)', async () => {
  await expect(runReconnectWithLastResortId()).rejects.toThrow(/last-resort|prekey kind/i);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — `ReconnectRateLimiter`: two token buckets (reserved for `resolvable:true`, tighter for `false`), each sized by concurrency (semaphore count) + a caller-stamped logical tick (`now()` injected, **no internal `time()`**) — defaults from spec open-q #4 (reserved ≤8 conc/32-per-window; tight ≤2/8). Reserved admission first checks a bounded Msg1-fingerprint seen-set (size `>= reservedWindow`); a repeat fingerprint → `{allowed:false}`. In `handshake.ts`, on the **ungated** responder branch, call `rl.admit({ resolvable: !!prekeySecretPresent, fp: sha256(macRInput) })` before any asymmetric op; `!allowed` → cheap close. Reject any reconnect Msg1 whose `prekeyId` resolves to the **last-resort** kind (assert before admission).
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): split+deduped reconnect rate-limit; reject last-resort id on reconnect (N-3)`.

---

## Phase 3 — engine wiring

### Task 3.1: persist RGK; set rgkPeerConfirmed on valid mac_R; issueNext(cid); epoch reset

**Files:** Modify `src/main/chat/engine.ts`; Test `test/chat-engine.test.ts`

- [ ] **Step 1 — failing tests:**

```ts
it('persists RGK on establishing handshake and reconnects on demand', async () => {
  const { a, b, cidA_onB } = await pair({});
  await b.dropConnections();
  await b.send(cidA_onB, 'after reconnect');
  await flush(40);
  expect(await aReceived('after reconnect')).toBe(true);
});
it('sets rgkPeerConfirmed only after verifying a valid mac_R; next reconnect is gated', async () => {
  const { b, cidA_onB } = await pair({});
  await b.dropConnections(); await b.send(cidA_onB, 'm1'); await flush(40); // bootstrap dial
  expect(await b.isConfirmed(cidA_onB)).toBe(true);
});
it('issueNext is called WITH the cid (issuance index populated for legit reconnect)', async () => {
  const { responderStore, cid } = await pairAndInspect();
  expect(await responderStore.identifyContact(/* the minted rotation pid */)).toBe(cid);
});
it('a fresh re-pin clears RGK + rgkPeerConfirmed (epoch reset)', async () => { /* drives resetReconnectEpoch */ });
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — `acceptInbound`/`connect`: on a successful handshake, `await contacts.update(cid, { reconnectGateKey: res.reconnectGateKey })`; if `res.peerMacRVerified`, also `{ rgkPeerConfirmed: true }`. On the responder rotation path, call `invites.issueNext(cid)` **with the cid** (change the `ResponderInviteStore.issueNext` signature to require `cid`). On reconnect, read `getReconnectKey`/`isRgkConfirmed` → pass into the handshake; construct the `ReconnectRateLimiter` (one per engine, injected `now = this.d.now`). On an identity re-pin (the `pin()` mismatch path / fresh invite), call `contacts.resetReconnectEpoch(cid)`. Add the `dropConnections` test hook if absent.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): wire RGK persist + bootstrap-confirm + issueNext(cid) + epoch reset`.

### Task 3.2: surface the final hard-fail

**Files:** Modify `src/main/chat/engine.ts` (+ event type if needed); Test `test/chat-engine.test.ts`

- [ ] **Step 1 — failing test:** when reconnect ultimately fails (double-reject / mint-cap / link expired), `send` rejects with an actionable message and the contact status reflects it (not a silent generic throw).
- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Catch the `reconnect failed — request a fresh invite` (and mint-cap/gate) errors in `connect`/`send`; emit `onContactStatus(cid, 'needs-reinvite')` (or `'offline'` if the DTO can't carry it) and rethrow a typed, user-readable error.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): actionable reconnect-failure surfacing`.

---

## Phase 4 — remaining formal + docs (F.1 already done before 2.4)

### Task F.2: CryptoVerif `mac_R` gate unforgeability

**Files:** Create `docs/superpowers/formal/chat-handshake-macr.cv`

- [ ] **Step 1** — Model `mac_R = MAC(RGK, DS_MAC_R ‖ Msg1-cleartext)` under SUF-CMA / PRF MAC (default.cvl macros); RGK a secret random (ROM step off the proven-secret RK). Prove a party without RGK cannot produce a verifying `mac_R` (the qualitative DoS-gate property of goal 4 — NOT the quantitative bound, which is the rate-limit constant). Header note: reconnect uses the same key chain, so hybrid/auth/KCI/FS proofs transfer.
- [ ] **Step 2** — Run: `eval $(opam env) && cryptoverif docs/superpowers/formal/chat-handshake-macr.cv` → "All queries proved." Save output.
- [ ] **Step 3** — Commit: `docs(formal): CryptoVerif mac_R gate unforgeability`.

### Task F.3: correspondence + audit + banner-scope docs

**Files:** Modify `docs/superpowers/formal/{model-code-correspondence,README,internal-audit-2026-06-08}.md`

- [ ] **Step 1** — Map the new elements (mac_R/bootstrap, Reject/TH_R0, per-contact index, rate-limit) → handshake/store lines. Mark HIGH-1 + MED-2 **closed** (new files + line refs); move "reconnect mode / keyed-MAC DoS gate" into verified scope; keep external-audit + FIPS as the only remaining external gates; record the on-path-replay reserved-bucket residual as operator-accepted. Commit: `docs(formal): reconnect verified; close HIGH-1/MED-2`.

---

## Phase 5 — full regression + release gate

### Task 5.1: full suite + typecheck + proofs

- [ ] **Step 1** — `pnpm typecheck` clean.
- [ ] **Step 2** — `eval $(opam env) && npx vitest run` → all green (incl. new reconnect/recovery/bootstrap/stores/rate-limit tests).
- [ ] **Step 3** — Re-run the whole formal kit (`for f in docs/superpowers/formal/*.cv; do cryptoverif $f; done` + the .pv) → all reproduce.
- [ ] **Step 4** — Commit doc/test-count updates: `chore(chat): reconnect-hardening v4 — full green`.

> Release: fold v4 into the next chat release notes (SUITE_ID change → v3 reconnect interop dropped; first_contact unaffected). Banner stays EXPERIMENTAL until the external gates (independent audit + FIPS) — unchanged by this workstream.

---

## Self-review (rev 4)

- **Spec coverage:** recovery/Reject+TH_R0 (2.4 + F.1), mac_R gate + enforcement bootstrap (2.2), per-contact index + coupling (1.1-R), offerCurrent re-offer + mint cap (1.2-R), split+deduped rate-limit + last-resort reject + framing (2.5 + 0.1b), rgkPeerConfirmed + epoch reset (0.2b + 3.1), hs_type/downgrade (2.3), RGK derive/persist (2.1 done + 3.1), formal reconnect-first + mac_R (F.1/F.2), engine wiring + surfacing (3.1/3.2). Every rev-4 §/goal maps to a task.
- **Rev-4 deltas vs the already-built rev-1 code are explicit reworks:** 1.1-R (per-contact index), 1.2-R (re-offer), and the bootstrap/TH_R0 changes to 2.2/2.4. The rev-1 tests that pinned the wrong behaviour are explicitly inverted.
- **Ordering invariant:** F.1 (ProVerif Reject model) is a GATE on 2.4 — stated in the sequencing note and as the task ordering.
- **Open-question defaults applied:** stable RGK (2.1), enforcement bootstrap (2.2), one-retry-per-dial (2.4), last-resort offered+surfaced (1.2-R/2.4), rate-limit + recent[]/mint coupling constants (2.5/1.1-R).
- **Type consistency:** `reconnectGateKey`+`rgkPeerConfirmed` (contact), `usedOfferedPrekey`+`peerMacRVerified` (result), `identifyContact`/`offerCurrent`/`getReconnectKey`/`isRgkConfirmed`/`resetReconnectEpoch` used consistently across Phases 1–3; `HS_MSG2`/`HS_REJECT`/`DS_MAC_R`/`DS_HS_REJECT`/`RECONNECT_GATE` defined in Phase 0 and used thereafter; `TH_R0`/`MIX_INIT` consistent between 2.4 and F.1/F.2.
