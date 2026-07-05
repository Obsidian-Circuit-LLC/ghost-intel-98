# X/Twitter Collector — session-model refinement — design

**Status:** design (brainstorm complete, awaiting plan)
**Date:** 2026-07-05
**Origin:** GhostExodus field feedback (with a ChatGPT UX analysis he endorsed) — the credential model is ~85% right, the network-gate presentation is over-stateful, and there's no way to tell a good cookie pair from a dead one until a job fails.
**Boundary:** CORE (`/dcs98`). A Settings-UX + session-validation feature. Deliberately NOT a collector rewrite: the twscrape sidecar, `collector.ts`, the collection flow, and GhostScrape are untouched.

---

## 1. Purpose

Make the X collector's credential/session UX honest and self-verifying: one clear egress control instead of a two-flag maze, cookies stored as a matched atomic pair, and a **Test session** that validates the exact `auth_token`+`ct0` against X and reports the authenticated handle — so bad/expired cookies surface immediately, not when a harvest silently returns nothing.

## 2. Locked decisions (operator's calls, this brainstorm)

1. **Gate = UI-flow only.** Keep both settings flags (`x.networkEnabled`, `x.clearnetAcknowledged`) exactly as they are — GhostScrape's gate and the charter clearnet-quarantine boundary are untouched. Only the *presentation* becomes one control + a first-time acknowledgment modal.
2. **Test session = main-side authenticated request.** No sidecar rebuild (the twscrape sidecar has no whoami command). A single authenticated GET to X validates the exact cookie pair and returns the handle.

## 3. Architecture & scope

Concentrated, not sprawling:

| File | Change |
|------|--------|
| `src/renderer/modules/settings/SettingsModule.tsx` (X section) | Separate Acknowledge-button + gate-toggle → one **"Enable authenticated X collection"** control; add-account form → **"Add session"** (atomic, with Test & Save); account list → **"Stored sessions"** with status + Test/Remove. |
| `src/renderer/modules/x/x-settings-logic.ts` | Pure gate-decision function (effective-gate read, enable-triggers-modal). Unit-tested without the modal. |
| `src/main/x/session-test.ts` (new) | `testSession(creds) → { valid, handle } | { valid:false, reason }` via one authenticated GET through `safe-fetch`. |
| `src/main/x/sessions-store.ts` (new) | Non-secret session metadata (secure-fs, mirrors the scraping-cases stores), keyed by `accountId`. |
| IPC + preload | Add `x:testSession`, `x:testStoredSession`, `x:listSessions`, `x:addSession`, `x:removeSession` (supersede `addAccount`/`removeAccount`/`listAccounts`; `hasAccount`/`collect`/`listItems`/`rankItems` unchanged). |
| `src/renderer/modules/x/XCollectorModule.tsx` | Accounts picker shows label + status, sends `accountId` (copy + wiring only). |

**Settings schema unchanged** (`x.{networkEnabled, clearnetAcknowledged}` both stay). Untouched: the twscrape sidecar, `collector.ts`, the collection flow, GhostScrape, and keyring secret storage.

## 4. Gate UX (one control + first-time modal)

A single **"Enable authenticated X collection"** checkbox with a permanent sublabel — *"Uses your real clearnet IP — X has no Tor path."*

**The checkbox reflects the *effective* gate — `networkEnabled && clearnetAcknowledged`**, not one flag. So any legacy inconsistent state (e.g. `networkEnabled:true, acknowledged:false` from the old UI) renders **off**, and checking it repairs it.

- **Check, not yet acknowledged** → open the one-time IP-exposure modal (existing `CLEARNET_DIALOG_TEXT` via `confirmDialog`, unchanged). Confirm → atomic patch `{ clearnetAcknowledged:true, networkEnabled:true }`. Cancel → no change.
- **Check, already acknowledged** → set `networkEnabled:true` directly (no modal — consent is durable; re-prompting every toggle is nagging).
- **Uncheck** → `networkEnabled:false`; `clearnetAcknowledged` stays true so re-enabling is one click.

Only **off** and **on (enabled + acknowledged)** are reachable through this control; the confusing middle state is unrepresentable. Both flags persist in settings, so GhostScrape and the charter boundary are untouched. The decision logic lives in the pure `x-settings-logic.ts`.

## 5. Session model

A **"session"** is the human-facing unit, split between secret and non-secret storage:

- **Secrets** stay in keyring/secretStore under `x.accounts.<accountId>.{auth_token, ct0, username}` — untouched.
- **Non-secret metadata** in the new `sessions-store` keyed by `accountId`: `{ label, username?, status: 'valid'|'expired'|'untested', lastTestedAt?, handle? }`.
- **`accountId` becomes an internal UUID**, decoupled from the label (today it doubles as the typed name). The collector treats `accountId` as opaque, so collect is unaffected; the UI shows `label`, sends `accountId`. **Migration is non-destructive:** existing accounts keep their id and gain synthesized metadata `{ label:<old id>, status:'untested' }`.

**Add session (atomic pairing):** **Local label** (required) · **X username** (optional) · **auth_token** (required) · **ct0** (required) → **Test & Save**. Both cookies required together, so you always paste a matched pair from one browser session — the "mix Session-A token + Session-B ct0" footgun is gone. No partial-field edit; updating a session re-enters both (a **Replace** action opens the same two-field form). Save generates the UUID and writes secrets→keyring + metadata→store atomically.

**Stored sessions** list — each row: **Label** · @handle (authoritative, from the last Test; falls back to the username hint) · **status badge** (Valid ✓ green / Expired ✗ red / Untested • grey) · **Last tested** (relative time) · **[Test]** · **[Remove]**. Test re-validates + updates the row; Remove deletes secrets + metadata.

**Status is advisory** — it reflects the *last* test (a session can expire afterward), which is why `lastTestedAt` is shown. `untested` is the honest default (including migrated accounts). The authoritative `@handle` comes from X during Test, not the username hint.

## 6. Test-session mechanism

**`session-test.ts`** — one authenticated GET to `https://api.x.com/1.1/account/settings.json` through the host-pinned `safe-fetch`, with `authorization: Bearer <public web-app bearer>` (a known public constant, not a secret), `x-csrf-token: <ct0>`, and `cookie: auth_token=…; ct0=…`. Carries an `AbortSignal` timeout. Result mapping:
- `200 + screen_name` → `{ valid:true, handle }`
- `401`/`403` → `{ valid:false, reason:'expired' }`
- `429` → `{ valid:false, reason:'rate-limited' }`
- network/timeout → `{ valid:false, reason:'network' }`

It's a real clearnet request (same IP exposure as a collect), so it's **gated behind the enable flag**. No secrets logged; the response is untrusted → only `screen_name` is read, length/charset-guarded before display.

**Two entry points**, same core:
- **`x.testSession(creds)`** — pre-save, from the Add-session form (the renderer already holds the just-typed cookies).
- **`x.testStoredSession(accountId)`** — re-test; reads secrets **main-side** (renderer never re-reads secrets), tests, writes `status`/`lastTestedAt`/`handle` to the store.

**Flows:**
- **Test & Save:** valid → save as `valid` with `@handle`, show *"✓ Session valid — authenticated as @handle"*. Definitive `expired`/`invalid` → **don't save**, show *"✗ Session invalid or expired — paste a fresh auth_token + ct0"*, keep the form open. Inconclusive `rate-limited`/`network` → offer **"Save without testing"** (stored `untested`) so a transient failure doesn't trap a user with good cookies.
- **Test** (stored row) → `testStoredSession` → updates the badge + last-tested inline.

With the enable flag off, Test actions are disabled with the same "enable X collection first" reason as collect.

## 7. Testing

**Pure units:** `x-settings-logic` gate decision across every flag combo (incl. the legacy `networkEnabled:true, ack:false` → renders **off**); `session-test` result mapping (200/401/403/429/throw), request carries bearer+`x-csrf-token`+cookie, **no cookie value in any thrown/logged output**, malicious `screen_name` guarded.

**Main-side (dependency-light, mirroring the x/report IPC tests):** `x:testSession` gated on `networkEnabled`; `x:testStoredSession` reads secrets main-side + writes store metadata (renderer gets no secrets); `sessions-store` put/list/remove round-trip + non-destructive migration; `addSession`/`removeSession` atomic secrets+metadata.

**Component (jsdom + mocked `window.api`):** Settings X section — gate control (check→modal→both flags; cancel→no-op; acknowledged→direct; legacy→off); Add-session (valid→save+"✓ @handle"; invalid→no-save+error; inconclusive→"Save without testing"→untested); Stored-sessions (badge/@handle/last-tested; Test updates row; Remove deletes). **Renderer↔main seam guard** (`[[socmint-collect-path-wiring-v3.24.2]]`): the collect request carries the selected `accountId`; `testStoredSession` reads the right secret keys.

**Charter/security:** secrets never logged/echoed; untrusted `screen_name` sanitized before render; bearer is a public constant; `safe-fetch` confines egress to X hosts; Test gated behind the enable flag; a guard that GhostScrape's `canScrape` still requires **both** flags (the gate change didn't weaken the shared boundary). No `Date.now` in pure logic — `lastTestedAt` uses an injected `now` at the store boundary.

## 8. Out of scope

- Any twscrape sidecar change / rebuild (Test session is main-side).
- Broadening what the sidecar authenticates with (auth_token+ct0+username is what it already uses; `password` re-login stays as-is).
- GhostScrape UI (reads the same flags; unaffected).
- Collector/harvest logic, ranking, save-to-case.
- Auto-retesting sessions on a schedule (v1 tests on demand: at save + the Test button).
