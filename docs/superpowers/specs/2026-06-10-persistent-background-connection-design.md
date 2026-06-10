# `persistent-background-connection` — Design Spec

**Status:** design — to be red-teamed, then operator-reviewed, before any plan.
**Date:** 2026-06-10
**Author:** Desirae Stark (with Claude)
**Part of:** Platform v1.1, capability 2 of 2 (public MIT core). Sibling `authorized-target-egress` is merged.

**Goal:** A plugin capability that lets a signed first-party plugin (the OSINT plugin's bundled Telegram collector) hold a **durable, credentialed, non-anonymous** outbound connection — distinct from the SSRF-gated `egress` and the scope-gated `authorized-target-egress` — routed through an **isolated Tor circuit** by default, with its own secret category, operator-consented session lifecycle, and loud disclosure.

**Architecture:** Thin platform. The platform provides a `BackgroundConnectionManager` (tracks/teardown), a Tor-routed credentialed lane (isolated circuit), a distinct vault secret category, and a consent/disclosure + LIVE-status surface. The plugin (subsystem 2) owns the Telethon CPython subprocess, the phone→OTP→session auth flow, channel selection, and message ingestion (via the *existing* `case-storage`/`timeline`/`entity-registry` capabilities). **The platform never learns MTProto.**

**Threat model & honest framing:** A Telegram account is tied to a registered phone number — it is **pseudonymous, never anonymous** to Telegram. Tor (isolated circuit) hides the operator's IP/location/network identity from Telegram and keeps the Telegram pseudonym unlinkable to DCS98's other Tor usage; it does **not** anonymize the account. This is disclosed at every session start. The connection is first-party signed code; the platform's job is to make the connection **consented, compartmented, credentialed-safely, and reliably torn down** — not to sandbox a malicious plugin (the plugin signature is that boundary).

---

## 1. Components (platform, main process, under `src/main/bgconn/`)

- **`BackgroundConnectionManager`** — the single authority for live credentialed connections. `register(worker)`, `start(connId)` (consent-gated), `stop(connId)`, `stopAll(reason)`, `list()` (for the LIVE status surface). Holds, per connection: `{ connId, pluginId, routing, startedAt, stopFn }`.
- **`BackgroundLane`** — resolves the routing for a connection: the bundled Tor SOCKS address with a **per-connection isolation credential** (so each connection gets its own circuit), or `direct`. Exposed to the plugin so it configures its subprocess.
- **`BgConnSecrets`** — a namespaced view over the existing `secretStore`, category `bgconn:<pluginId>:<connId>:<field>`, kept apart from transform/BYO-key secrets.
- **Consent gate + LIVE status** — IPC + a confirmation surface; an always-visible "Telegram monitor: LIVE (<routing>)" indicator while any connection is active.

The plugin registers a worker `{ connId, routing, start(): Promise<void>, stop(): Promise<void> }`. `start()` spawns/connects Telethon; `stop()` tears it down. The manager owns *when* those are called.

---

## 2. Tor-routed credentialed lane + compartmentation

- **Default: Tor, on an isolated circuit.** Route through the bundled Tor SOCKS, but with a **per-connection SOCKS username/password** so Tor's `IsolateSOCKSAuth` gives this connection a *distinct circuit/exit* from the P2P-chat onion and any other Tor usage. The Telegram pseudonym is therefore **unlinkable** (by exit IP / circuit) to other DCS98 Tor activity. (Verify the bundled `torrc` keeps `IsolateSOCKSAuth` default-on, which it is; the lane just supplies distinct SOCKS creds per connection.)
- **Per-connection `direct` opt-out** — exposes the operator's IP to Telegram; only via an explicit, disclosed choice (§5).
- This lane **deliberately bypasses** the off-by-default SSRF `egress` gate — it is a separate, explicitly-granted, credentialed lane. A plugin's *other* egress still goes through the normal gated path. A plugin without `persistent-background-connection` has no access to this lane.

---

## 3. Secret category

A distinct namespace in the existing `secretStore`: `bgconn:<pluginId>:<connId>:{apiId, apiHash, phone, session}`. The **`session` string** is the sensitive long-lived credential (a live authenticated Telegram session) and is written **only after** the plugin completes auth. The platform stores/retrieves through `BgConnSecrets`; the plugin's Telethon flow produces the values. Listing/clearing a connection's credentials is a platform operation (so the operator can revoke a session from DCS98 without hunting through the plugin).

---

## 4. Lifecycle (operator-started session)

The plugin registers its worker. On operator **start**:
1. Consent gate (§5) — declined → no connection.
2. Manager records the live connection, resolves the lane (§2), hands the plugin the lane + credentials, calls `worker.start()`, and shows LIVE.
3. **Auto-reconnect while the session is active** is the plugin's responsibility (Telethon reconnect); the manager just keeps the session marked live.

**The session SURVIVES:** module navigation/close, **and vault lock / screen-away** (operator decision — locking the screen must not drop the monitor).

**The manager force-tears-down** (`worker.stop()`) only on: **operator explicit stop**, **app quit**, and **plugin disable**. A connection can never outlive the app or the plugin, but it *does* survive a lock.

**Vault-lock consequence (honest):** the connection stays up while locked (the session string is already in the running subprocess — no vault read needed to keep the socket alive). But the plugin's message **ingestion writes to the encrypted case store are vault-gated**, so while locked, newly-received messages **buffer in the subprocess's bounded in-memory queue and flush on unlock**. Bound the buffer (drop-oldest with a logged high-water mark) so a long lock can't exhaust memory. This is the plugin's ingestion concern; the platform documents the contract and exposes "vault locked" state to the worker so it can buffer rather than error.

---

## 5. Consent & disclosure

At **each session start**, a loud modal:
> Start a **NON-ANONYMOUS** Telegram connection as `<phone/account>` via **`<Tor (isolated circuit)` | `DIRECT — your IP is exposed to Telegram>`**? Telegram will see this account active. [Confirm] [Cancel]

Explicit confirm required; the consent (account, routing, time) is recorded to the case timeline. **Re-consent** is required if the credentials or the routing change (bound to a hash of `{phone, routing}`). Mirrors the offensive per-scan confirm pattern. No silent start, ever.

---

## 6. Capability wiring

- Add `'persistent-background-connection'` to `CAPABILITIES` (`src/shared/plugin-types.ts`).
- Context surface on `PluginContext`: `bgConn?: { registerWorker(w: BgWorker): void; lane(connId): { socks?: string; direct: boolean }; secrets: BgConnSecretsView; setVaultLockedHook(cb): void }`. Granted only when the plugin **declares** the capability AND `deps.bgConn` is supplied (two-gate, like `attackEgress`).
- The live `BackgroundConnectionManager` is a shared singleton (mirroring the offensive controller singleton) referenced by both the IPC layer and `buildContextDeps`, so the capability is delivered live.
- IPC `bgconn:{ list, start, stop, configure, clearCredentials, status }` via `safeHandle`; preload `window.api.bgconn.*`.

---

## 7. Invariants (the opsec/security spine)

- **Compartmentation:** each connection gets a distinct Tor circuit via per-connection `IsolateSOCKSAuth` creds → the Telegram pseudonym is unlinkable (exit IP/circuit) to the chat onion or other Tor usage.
- **Lifetime bounded by consent + app/plugin:** teardown on operator-stop / app-quit / plugin-disable. **Survives** vault lock and module navigation (operator decision).
- **Non-anonymous, never silent:** disclosed and consented at every session start; re-consent on credential/routing change; LIVE indicator while active.
- **Credentials in the encrypted vault**, distinct `bgconn:` category; session string written only post-auth; revocable from the platform.
- **No telemetry.** The lane is the only added egress and it is explicitly consented; all other plugin egress stays on the gated path.

---

## 8. Out of scope (subsystem 2 / the plugin)

The Telethon CPython subprocess + bundling; the phone→OTP→session auth flow (interactive); channel selection + scraping policy (FloodWait handling); message ingestion + the bounded buffer during vault lock (uses existing `case-storage`/`timeline`/`entity-registry`). Also out: app-lifetime auto-start (operator chose operator-started sessions); any second concrete consumer (the capability is generic-ish but Telegram is its only planned user — no speculative generalization).

---

## 9. Error handling & testing

Fail-closed: no credentials / consent declined / manager teardown in progress / plugin lacks the capability → no connection; `lane()` for an unstarted/unknown connection → throws.

Tests (platform, with a **mock** worker — no real Telegram): consent gate blocks an unconfirmed start and allows a confirmed one; `stopAll('quit'|'disable')` calls `worker.stop()` for every live connection; a connection **survives** a simulated vault-lock event (NOT torn down) and the vault-locked hook fires so the worker can buffer; `start` after `stop` requires fresh consent; the lane returns the isolated SOCKS creds (distinct per connection) vs `direct`; `BgConnSecrets` namespaces under `bgconn:<plugin>:<conn>:` and is isolated from other secrets; a worker cannot remain live after teardown. Telethon integration + the auth flow are subsystem-2 + manual.
