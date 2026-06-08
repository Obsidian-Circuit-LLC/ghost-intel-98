# Reconnect-Hardening (handshake v4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat reconnect path self-healing (no permanent prekey strand), DoS-pre-gated, and formally re-verified — closing audit findings HIGH-1 and MED-2.

**Architecture:** Bump the handshake suite to **v4**. Add (a) a reconnect DoS pre-gate `mac_R` keyed by a stable per-contact `RGK = HKDF(RK,SID,…)` derived at first_contact, resolved before asymmetric work via a retained non-secret `prekey_id → cid` issuance index; (b) an authenticated `prekey_unknown` **Reject** message (`hs_type` tag on the responder reply) + a single initiator retry against an offered fresh prekey, so a consumed/stale rotation prekey recovers in-band; (c) ProVerif reconnect variant + CryptoVerif `mac_R` assumption. Spec: `docs/superpowers/specs/2026-06-08-reconnect-hardening.md`.

**Tech Stack:** TypeScript (main-process chat stack), Node `crypto` + `@noble/curves`, ProVerif 2.05 / CryptoVerif 2.12 (`eval $(opam env)`), vitest.

---

## File structure

- `src/main/chat/constants.ts` — **modify**: `SUITE_ID`→v4; add `DS_HS_REJECT`, `DS_MAC_R`, `RECONNECT_GATE`.
- `src/main/chat/prekey-store.ts` — **modify**: retained `prekey_id → cid` issuance index (survives consume); `offerCurrent()` (fresh one-time, else signed last-resort, no consume); `identifyContact(prekeyId)`.
- `src/main/chat/contact-store.ts` — **modify**: `reconnectGateKey: Uint8Array | null` field + persist/get.
- `src/main/chat/handshake.ts` — **modify**: derive+return `RGK`; reconnect `mac_R` gen (I) / verify (R, pre-asymmetric); `hs_type` tag on the responder payload; Reject emit (R) + verify + one-retry (I); thread RGK + identification.
- `src/main/chat/engine.ts` — **modify**: persist RGK at first_contact; supply RGK + offer/identify hooks on reconnect; surface a clear hard-fail.
- `src/shared/post-mvp-types.ts` / `HandshakeResult` — **modify**: carry `reconnectGateKey`.
- `docs/superpowers/formal/chat-handshake.pv` — **modify**: reconnect variant. `docs/superpowers/formal/chat-handshake-macr.cv` — **create**: `mac_R` PRF gate.
- Tests: `test/chat-stores.test.ts`, `test/chat-handshake.test.ts`, `test/chat-engine.test.ts` — **modify**.

> **Sequencing note:** Phases 0–2 are pure store/handshake units (testable in isolation). Phase 3 wires the engine. Phase 4 re-verifies. Each task ends green + committed. Because this changes `SUITE_ID`, v3↔v4 reconnect interop drops by design (first_contact unaffected; suite mismatch fails closed).

---

## Phase 0 — constants, RGK, storage

### Task 0.1: v4 constants

**Files:** Modify `src/main/chat/constants.ts`

- [ ] **Step 1** — Bump suite + add labels:

```ts
export const SUITE_ID = tag('dcs98-chat/v4/x25519+mlkem1024+ed25519');
// ... existing DS_* ...
export const DS_HS_REJECT = tag('dcs98-chat/ds/hs-reject/v1');
export const DS_MAC_R = tag('dcs98-chat/ds/mac-r/v1');
export const RECONNECT_GATE = tag('dcs98-chat/reconnect-gate/v4');
```

- [ ] **Step 2** — `pnpm typecheck` (expect: SUITE_ID-dependent tests may now expect v4 — fix their literals in their own tasks). Commit: `feat(chat): handshake suite v4 constants (reconnect-hardening)`.

### Task 0.2: contact reconnect-gate key storage

**Files:** Modify `src/main/chat/contact-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — failing test** (add to the ContactStore describe):

```ts
it('persists and updates the reconnect gate key', async () => {
  const store = new ContactStore(await tmp('contacts.json'));
  const peer = generateIdentity().publicKeys;
  await store.pin(peer);
  const id = contactId(peer);
  const rgk = new Uint8Array(32).fill(7);
  await store.update(id, { reconnectGateKey: rgk });
  const c = await store.getById(id);
  expect(Array.from(c!.reconnectGateKey!)).toEqual(Array.from(rgk));
});
```

- [ ] **Step 2** — Run: `npx vitest run test/chat-stores.test.ts -t "reconnect gate"` → FAIL (field absent).
- [ ] **Step 3** — Add `reconnectGateKey?: Uint8Array | null` to the `Contact` + stored interfaces; include it in the `update` patch union and in the serialize/deserialize (base64) round-trip, mirroring how `nextPrekey` is stored.
- [ ] **Step 4** — Run the test → PASS. Full `npx vitest run test/chat-stores.test.ts` green.
- [ ] **Step 5** — Commit: `feat(chat): persist per-contact reconnect gate key`.

---

## Phase 1 — prekey-store: issuance index, offerCurrent, identify

### Task 1.1: retained issuance index `prekey_id → cid` (survives consume)

**Files:** Modify `src/main/chat/prekey-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — failing test:**

```ts
it('retains a prekeyId→contact index after the one-time secret is consumed', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  const pk = await store.issueNext('contact-abc'); // issueNext now records the recipient cid
  expect(await store.identifyContact(pk.prekeyId)).toBe('contact-abc');
  await store.consume(pk.prekeyId);                 // FS-deletes the secret…
  expect(await store.lookup(pk.prekeyId)).toBeNull();// …secret gone…
  expect(await store.identifyContact(pk.prekeyId)).toBe('contact-abc'); // …index retained
});
```

- [ ] **Step 2** — Run → FAIL (`issueNext` takes no cid; no `identifyContact`).
- [ ] **Step 3** — Change `issueNext(cid: string)` to record `{ pid → cid }` in a new `PrekeyFile.issued: Record<string,string>` (durable). Add `identifyContact(prekeyId): Promise<string | null>` reading `issued`. `consume()` deletes the secret from `oneTime` but **leaves `issued`** intact. Cap `issued` to the most-recent N (e.g. 256) on write to bound growth.
- [ ] **Step 4** — Run → PASS. `npx vitest run test/chat-stores.test.ts` green (update existing `issueNext` callers in the test to pass a cid).
- [ ] **Step 5** — Commit: `feat(chat): retained prekeyId→contact issuance index (reconnect recovery)`.

### Task 1.2: `offerCurrent()` — fresh prekey for a Reject, no consume

**Files:** Modify `src/main/chat/prekey-store.ts`; Test `test/chat-stores.test.ts`

- [ ] **Step 1 — failing test:**

```ts
it('offerCurrent returns a fresh one-time prekey without consuming anything; falls back to last-resort', async () => {
  const id = generateIdentity();
  const store = new PrekeyStore(await tmp('prekeys.json'), id);
  await store.ensurePool(1);
  const before = await store.remaining();
  const offered = await store.offerCurrent('cid-x');
  expect(verifyKemPrekey(offered.prekey, id.publicKeys.ed25519)).toBe(true);
  expect(await store.remaining()).toBe(before); // offering does NOT consume
  expect(await store.identifyContact(offered.prekey.prekeyId)).toBe('cid-x'); // indexed for the retry
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Add `offerCurrent(cid: string): Promise<KemPrekeyKeyPair>`: mint a fresh one-time prekey, push to `oneTime`, record `issued[pid]=cid`, write durably, return it (it is consumed normally if/when the retry completes). If the pool is at/over cap or minting is constrained, return the signed last-resort (`is_last_resort=true`). (Both paths reuse `mint`/`generateKemPrekey`.)
- [ ] **Step 4** — Run → PASS. Stores suite green.
- [ ] **Step 5** — Commit: `feat(chat): PrekeyStore.offerCurrent for reconnect recovery`.

---

## Phase 2 — handshake v4: RGK, mac_R gate, Reject + retry

### Task 2.1: derive + return RGK (both roles, first_contact)

**Files:** Modify `src/main/chat/handshake.ts`, `src/shared/post-mvp-types.ts` (or wherever `HandshakeResult` lives); Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing test:** drive a first_contact handshake over the in-memory pipe (reuse the existing test harness) and assert **both** sides return an identical 32-byte `reconnectGateKey`:

```ts
it('first_contact returns a matching reconnect gate key on both sides', async () => {
  const { iRes, rRes } = await runFirstContact(); // existing helper in the test file
  expect(iRes.reconnectGateKey).toHaveLength(32);
  expect(Array.from(iRes.reconnectGateKey!)).toEqual(Array.from(rRes.reconnectGateKey!));
});
```

- [ ] **Step 2** — Run → FAIL (`reconnectGateKey` undefined).
- [ ] **Step 3** — In both impls, **before** the `zeroize(...)` that wipes `rk`, compute `const reconnectGateKey = hkdf(rk, sid, RECONNECT_GATE, 32)` and include it in `HandshakeResult`. Add `reconnectGateKey?: Uint8Array` to the result type. (Only meaningful for first_contact; for reconnect it is recomputed-but-unused — fine.)
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): derive per-contact reconnect gate key (RGK) at handshake`.

### Task 2.2: reconnect `mac_R` pre-gate (initiator gen, responder verify pre-asymmetric)

**Files:** Modify `src/main/chat/handshake.ts`; extend `ResponderInviteStore`/`ContactPinStore`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing test:** a reconnect handshake where the initiator has the correct RGK succeeds; one with a wrong RGK is rejected **before** any decap (assert via a spy/throw ordering, or simply that it fails with a gate error):

```ts
it('reconnect rejects a wrong mac_R at the pre-gate (before asymmetric work)', async () => {
  await expect(runReconnect({ initiatorRGK: new Uint8Array(32).fill(9) /* wrong */ }))
    .rejects.toThrow(/mac_R|reconnect gate/i);
});
it('reconnect with the correct RGK completes', async () => {
  const { iRes } = await runReconnect({ /* correct RGK from prior first_contact */ });
  expect(iRes.session).toBeTruthy();
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — `mac_R` is keyed over the Msg1 CLEARTEXT (NOT th1 — th1 needs R's prekey, which is gone in the strand case; see spec §3). Define the gate input once on both sides: `macRInput = concatBytes(DS_MAC_R, th0, prekeyId, xeI.publicKey, ekI.publicKey, enc.cipherText)` (initiator) / the parsed equivalents (responder). Initiator (reconnect): `const macR = hmacSha256(rgk, macRInput)`; include `macR` in Msg1 in the same 32-byte slot first_contact uses for `macT`. Responder: parse `mode` + the Msg1 cleartext fields; if reconnect, resolve `cid = await invites.identifyContact(prekeyId)` (works even when the prekey is consumed); `const rgk = await contacts.getReconnectKey(cid)`; verify `constantTimeEqual(macR, hmacSha256(rgk, macRInput))` **before** `lookup`/`mlkemDecapsulate`/ECDH; on mismatch/no-cid/no-rgk → `HandshakeError('reconnect gate failed')` (cheap close). Extend `ResponderInviteStore` with `identifyContact` and `ContactPinStore` with `getReconnectKey(cid)`.
- [ ] **Step 4** — Run → PASS. `npx vitest run test/chat-handshake.test.ts` green.
- [ ] **Step 5** — Commit: `feat(chat): reconnect mac_R DoS pre-gate (verified before asymmetric ops)`.

### Task 2.3: `hs_type` tag on the responder reply

**Files:** Modify `src/main/chat/handshake.ts`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing test:** assert Msg2 now begins with `HS_MSG2 = 0` and the initiator parses it; a reply with an unknown `hs_type` is rejected:

```ts
it('initiator rejects an unknown hs_type in the responder reply', async () => {
  await expect(runReconnectWithTamperedReply((b) => { b[0] = 0x7f; return b; }))
    .rejects.toThrow(/hs_type|unexpected reply/i);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Prepend `Uint8Array.of(HS_MSG2)` to the responder's Msg2 payload; the initiator reads `hs_type = cursor.byte()` first and branches (`HS_MSG2` → existing Msg2 parse; `HS_REJECT` → Task 2.4; else throw). Fold `hs_type` into `th3` (so Msg2's `Sig_R` covers it). Constants `HS_MSG2 = 0`, `HS_REJECT = 1`.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): typed responder reply (hs_type) for Msg2/Reject`.

### Task 2.4: authenticated Reject + one-retry recovery (fixes HIGH-1)

**Files:** Modify `src/main/chat/handshake.ts`; Test `test/chat-handshake.test.ts`

- [ ] **Step 1 — failing test (the HIGH-1 regression):** reconnect where R's stored prekey was consumed → R sends a Reject → I retries against the offered prekey → success, no fresh invite; and a forged Reject (bad `Sig_R_reject`) is rejected:

```ts
it('reconnect self-heals when the rotation prekey was already consumed (Reject→retry)', async () => {
  const { iRes } = await runReconnectWithConsumedPrekey();
  expect(iRes.session).toBeTruthy();      // recovered in-band
  expect(iRes.usedOfferedPrekey).toBe(true);
});
it('initiator rejects a forged Reject (bad Sig_R_reject)', async () => {
  await expect(runReconnectWithForgedReject()).rejects.toThrow(/reject signature|invalid/i);
});
it('a second Reject is a hard fail (one-retry cap)', async () => {
  await expect(runReconnectDoubleReject()).rejects.toThrow(/reconnect failed|fresh invite/i);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Responder: when `mode=reconnect`, the gate passed, but `invites.lookup(prekeyId)` is null (consumed/unknown-but-identified) → `const offered = await invites.offerCurrent(cid)`; `const sigReject = ed25519Sign(concatBytes(DS_HS_REJECT, th1, encodeKemPrekey(offered.prekey)), ed25519Pair(identity))`; send `concatBytes(Uint8Array.of(HS_REJECT), encodeKemPrekey(offered.prekey), sigReject)`; return/abort this attempt **without consuming** anything. Initiator: on `HS_REJECT`, verify `sigReject` under pinned `is_R` over `(DS_HS_REJECT ‖ th1 ‖ offered)`; verify `offered`'s prekey signature; if `offered.isLastResort` surface/flag (don't silently proceed unless allowed); then **retry once** from Msg1 with the offered prekey (fresh `xe_I`/`ek_I`/`ct_pre`); a second `HS_REJECT` → `HandshakeError('reconnect failed — request a fresh invite')`. Set `usedOfferedPrekey` on the result.
- [ ] **Step 4** — Run → PASS. `npx vitest run test/chat-handshake.test.ts` green.
- [ ] **Step 5** — Commit: `fix(chat): in-band reconnect recovery via authenticated Reject + one retry (HIGH-1)`.

---

## Phase 3 — engine wiring

### Task 3.1: persist RGK at first_contact; supply gate/offer/identify on reconnect

**Files:** Modify `src/main/chat/engine.ts`; Test `test/chat-engine.test.ts`

- [ ] **Step 1 — failing test:** after first_contact, the contact row has a `reconnectGateKey`; a subsequent dial-on-demand reconnect succeeds end-to-end (message routes):

```ts
it('persists RGK on first contact and reconnects on demand', async () => {
  const { a, b, cidA_onB, cidB_onA } = await pair({});
  // force B's live connection closed, then send → triggers reconnect
  await b.dropConnections();            // test hook closing live conns
  await b.send(cidA_onB, 'after reconnect');
  await flush(40);
  expect(/* A received it */).toBe(true);
});
```

- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — `acceptInbound`/`connect`: on a first_contact result, `await contacts.update(cid, { reconnectGateKey: res.reconnectGateKey })`. On reconnect, read `contacts.getReconnectKey(cid)` → pass to `initiatorHandshake` (initiator `mac_R`). Wire the responder side: `ResponderOpts.invites` already routes to `PrekeyStore` (now has `identifyContact`/`offerCurrent`); ensure `ResponderOpts.contacts` exposes `getReconnectKey`. Add the `dropConnections` test hook (close live conns) if not present.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): wire reconnect gate + recovery through the engine`.

### Task 3.2: surface the final hard-fail

**Files:** Modify `src/main/chat/engine.ts` (+ event type if needed); Test `test/chat-engine.test.ts`

- [ ] **Step 1 — failing test:** when reconnect ultimately fails (double-reject), `send` rejects with an actionable message and the contact status reflects it (not a silent generic throw).
- [ ] **Step 2** — Run → FAIL.
- [ ] **Step 3** — Catch the `reconnect failed — request a fresh invite` error in `connect`/`send`; emit `onContactStatus(cid, 'offline')` (or a new `needs-reinvite` status if the DTO allows) and rethrow a typed, user-readable error.
- [ ] **Step 4** — Run → PASS.
- [ ] **Step 5** — Commit: `feat(chat): actionable reconnect-failure surfacing`.

---

## Phase 4 — formal re-verification (MED-2b + verify HIGH-1 fix)

### Task 4.1: ProVerif reconnect variant

**Files:** Modify `docs/superpowers/formal/chat-handshake.pv`

- [ ] **Step 1** — Add a `mode=reconnect` process: pinned-static equality (no TOFU pin), `mac_R` modelled as a keyed MAC under `RGK` (a fresh secret shared by I and R), the `hs_type`-tagged reply, and the Reject branch (R emits a signed `DS_HS_REJECT ‖ TH1 ‖ offered` with a fresh prekey; I verifies + retries once).
- [ ] **Step 2** — Add/extend queries: injective agreement both directions for reconnect; downgrade (no mode / hs_type / last-resort coercion); **recovery soundness** (a Reject not signed by the pinned `is_R` cannot make I complete against an attacker prekey); no-double-accept.
- [ ] **Step 3** — Run: `eval $(opam env) && proverif docs/superpowers/formal/chat-handshake.pv`. Expected: the reconnect auth/downgrade/recovery queries prove (R-auth-I injectivity again rests on single-use consumption, as in first_contact). Save output to `proverif-reconnect-<date>.txt`.
- [ ] **Step 4** — Commit: `docs(formal): ProVerif reconnect variant (auth/downgrade/recovery)`.

### Task 4.2: CryptoVerif `mac_R` gate assumption

**Files:** Create `docs/superpowers/formal/chat-handshake-macr.cv`

- [ ] **Step 1** — Model `mac_R = MAC(RGK, DS_MAC_R‖TH1)` under a SUF-CMA / PRF MAC assumption (default.cvl has MAC macros); RGK a secret random (discharged by the chain models — it's a ROM step off RK). Prove: a party without RGK cannot produce a verifying `mac_R` (gate unforgeability). Note in the header that the reconnect key schedule is the same chain, so the hybrid/auth/KCI/FS proofs transfer unchanged.
- [ ] **Step 2** — Run: `eval $(opam env) && cryptoverif docs/superpowers/formal/chat-handshake-macr.cv` → "All queries proved." Save output.
- [ ] **Step 3** — Commit: `docs(formal): CryptoVerif mac_R gate unforgeability (reconnect DoS pre-gate)`.

### Task 4.3: update correspondence + audit + banner-scope docs

**Files:** Modify `docs/superpowers/formal/{model-code-correspondence,README,internal-audit-2026-06-08}.md`

- [ ] **Step 1** — Mark HIGH-1 and MED-2 **closed** (with the new files + line refs); move "reconnect mode / keyed-MAC DoS gate" from "NOT verified" into the verified scope; keep external-audit + FIPS as the only remaining gates. Commit: `docs(formal): reconnect mode + recovery now verified; close HIGH-1/MED-2`.

---

## Phase 5 — full regression + release gate

### Task 5.1: full suite + typecheck + proofs

- [ ] **Step 1** — `pnpm typecheck` clean.
- [ ] **Step 2** — `eval $(opam env) && npx vitest run` → all green (incl. the new reconnect/recovery/gate/stores tests).
- [ ] **Step 3** — Re-run the whole formal kit (`for f in docs/superpowers/formal/*.cv; do cryptoverif $f; done` + the .pv) → all reproduce.
- [ ] **Step 4** — Commit any doc/test count updates: `chore(chat): reconnect-hardening v4 — full green`.

> Release: fold v4 into the next chat release notes (SUITE_ID change → v3 reconnect interop dropped; first_contact unaffected). Banner stays EXPERIMENTAL until the external gates (independent audit + FIPS) — unchanged by this workstream.

---

## Self-review (done)

- **Spec coverage:** recovery flow (Task 2.4), mac_R pre-gate (2.2) + keying/identification (1.1), offerCurrent/last-resort (1.2 + 2.4), hs_type/downgrade (2.3), RGK stable from first_contact (2.1 + 3.1), formal reconnect + mac_R (4.1/4.2), engine wiring + surfacing (3.1/3.2), versioning (0.1). All spec sections map to a task.
- **Open-question defaults applied:** stable RGK (2.1), last-resort offered+surfaced (1.2/2.4), one-retry cap (2.4).
- **Type consistency:** `reconnectGateKey` (contact + result), `identifyContact`/`offerCurrent`/`getReconnectKey` used consistently across Phases 1–3; `HS_MSG2`/`HS_REJECT`, `DS_MAC_R`/`DS_HS_REJECT`/`RECONNECT_GATE` defined in 0.1 and used thereafter.
