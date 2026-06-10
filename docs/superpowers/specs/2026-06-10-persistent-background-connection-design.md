# `persistent-background-connection` — Design Spec (v2, post-red-team)

**Status:** design — revised after an adversarial red-team pass (3 critical / 4 high / 3 medium) that verified the v1 claims against the codebase and found several FALSE. v2 enforces what v1 asserted. Awaiting operator review before writing-plans.
**Date:** 2026-06-10
**Author:** Obsidian Circuit (with Claude)
**Part of:** Platform v1.1, capability 2 of 2 (public MIT core).
**Red-team:** opus `red-teamer`, 2026-06-10 — v1 verdict "does not hold up; the two properties it names as the whole point are asserted, not enforced." This v2 closes the must-fix list. **Operator decisions:** Tor enforcement = best-effort + fail-closed + disclose (consistent with offensive §3.1); survive-lock = bounded by an operator-set idle-teardown.

**Goal:** A plugin capability for the OSINT plugin's bundled Telegram collector to hold a **durable, credentialed, non-anonymous** outbound connection — on a **separately-instanced, isolated Tor circuit** by default — with its own vault secret category, operator-consented session lifecycle, **enforced** teardown, and loud disclosure. Plugin owns Telethon/auth/ingestion; platform never learns MTProto.

**Threat model:** A Telegram account is tied to a phone number — **pseudonymous, never anonymous** to Telegram. The properties that matter and that v2 must *enforce* (not assert): (1) **compartmentation** — the Telegram pseudonym is unlinkable (circuit/exit/guard) to the chat onion and other Tor usage; (2) **no silent direct fallback** — best-effort + fail-closed (operator decision); (3) **enforced teardown** — a live non-anonymous connection cannot outlive consent/app/plugin/idle-lock. Malicious-plugin code is out of model (PQ signature is that boundary); the concern is a *first-party-but-buggy* plugin breaking an invariant.

---

## 1. Components (platform, main, under `src/main/bgconn/`)

- **`BgconnTor`** — a **separate Tor instance** (own `DataDirectory`, `SocksPort`, `ControlPort`, own guards), spawned/managed independently of the chat transport's Tor (red-team Finding 1, 8 — sharing the chat instance is a guard-level compartmentation hazard). Its generated `torrc` sets **`SocksPort 127.0.0.1:<port> IsolateSOCKSAuth IsolateDestAddr`** explicitly and a `SocksPolicy accept *` for public destinations (Tor rejects RFC1918/loopback CONNECT by default; pin it). `isBootstrapped()` for the fail-closed gate.
- **`BackgroundLane`** — per connection, generates a **cryptographically-distinct SOCKS `username:password`** (so `IsolateSOCKSAuth` yields a distinct circuit/exit), and resolves routing to either that isolated SOCKS endpoint or `direct`. The lane is the single authority for SOCKS auth (the platform's existing no-auth SOCKS client is irrelevant here — the subprocess's own SOCKS client uses the lane's creds).
- **`BackgroundConnectionManager`** — single authority for live connections: `register(worker)`, `start(connId)` (consent + Tor-bootstrap gated), `stop(connId)`, `stopAll(reason)`, `list()`, plus reconnect/idle policy enforcement (§4). Holds `{connId, pluginId, routing, startedAt, lastLockAt, reconnects, stopFn, killProc}`.
- **`BgConnSecrets`** — namespaced view over `secretStore`, category `bgconn:<pluginId>:<connId>:<field>`.
- **Consent gate, LIVE status, lock-screen control surface** (§5, §6).

The plugin registers a worker `{ connId, routing, channelSetHash, start(lane, secrets): Promise<{ pid, kill }>, stop(): Promise<void> }`. The manager owns *when* start/stop fire and holds the `kill` handle for forced teardown.

---

## 2. Tor enforcement — best-effort + fail-closed (operator decision)

- **Before `start()` on a Tor-routed session**, the manager calls `BgconnTor.isBootstrapped()`; if Tor isn't up/bootstrapped, **refuse to start** (fail-closed in *platform* code — Finding 2). No "start anyway, hope Tor comes up."
- The subprocess is handed **only** the isolated SOCKS endpoint + creds; the platform does not give it a direct-network helper. Our Telethon config (subsystem 2, but a platform-stated contract) **must disable any direct fallback** — `connection_retries` over the proxy only, never `proxy=None` retry.
- **Honest enforcement level (disclosed):** the platform *verifies Tor is up* and *only provides the SOCKS lane*, but does **not** OS-jail the subprocess, so a first-party reconnect bug could in principle attempt direct egress — the same accepted residual as the offensive raw-socket case (§3.1 there). The disclosure (§5) states "Tor-routed (verified up); not OS-enforced." **Structural OS-jail (netns/WFP) is a deferred shared increment** for both this and the offensive subprocess.
- This lane **bypasses** the off-by-default SSRF `egress` gate (it's a separate credentialed lane). **Invariant (Finding 7):** the SOCKS endpoint string is delivered *only* to the manager-spawned subprocess and is **never** accepted as a destination/proxy by `ctx.egress`/`rawFetch`; a bgconn-capable plugin's `ctx.egress.fetch` to any loopback/`socks://` URL still throws (negative test in §9).

---

## 3. Secret category + session-string handoff (Finding 5)

- Distinct namespace `bgconn:<pluginId>:<connId>:{apiId, apiHash, phone, session}` in `secretStore`. The **`session` string** (full account access) is written only after the plugin completes auth, and is **revocable from the platform** (`bgconn:clearCredentials`).
- **Handoff contract (platform-enforced, never delegated):** the session string is passed to the subprocess via **child `stdin` (write then close)** or an inherited anonymous fd — **NEVER argv or env** (those leak to `ps`/Task Manager/`/proc/<pid>/cmdline`/crash dumps). Spawn with `stdio: ['pipe','pipe','pipe']`. **Disable core dumps** for the subprocess (`RLIMIT_CORE=0` / Windows WER opt-out). **Scrub the session** from any captured stderr/logs.

---

## 4. Lifecycle — operator-started session, ENFORCED teardown

Operator **start** → consent gate (§5) → Tor-bootstrap gate (§2) → manager records the live connection, resolves the lane, hands the worker `(lane, secrets)`, calls `worker.start()` (which returns `{pid, kill}`), shows LIVE.

**Survives:** module navigation/close, and **vault lock / screen-away** — **bounded** by the operator-set idle-teardown (below).

**Manager force-tears-down (calls `worker.stop()` AND `kill` the subprocess) on:**
- **operator explicit stop** (works even while locked — §6);
- **app quit** — `bgConnManager.stopAll('quit')` is wired into `before-quit` **before** the bounded race, and the subprocess kill is **awaited** (spawned in a **Windows job object** / `detached:false` with `taskkill /T` + SIGKILL escalation) so it can't orphan (Finding 3 — the historical `tor.exe` orphan bug must not recur);
- **plugin disable** — a real `disablePlugin(id)` path is added to the plugin loader (it currently has none) that invokes registered teardowns synchronously; the manager subscribes. (Shared infra: the offensive subsystem-2 scanner needs the same teardown framework.)
- **idle-teardown (operator decision):** while locked, the manager tracks `lockedSince`; after the operator-set `idleTeardownAfter` (default **2h**, adjustable, or `'never'`), it tears the connection down. Reconciles "don't drop the monitor when I lock for lunch" with "don't keep a live foreign-account session on a machine seized overnight."

**Reconnect policy (manager-owned, Finding 6):** auto-reconnect is allowed *within* an active session but **bounded** — max retries and a **max-session-age**; after N reconnects or T elapsed, the manager pauses and requires **re-consent** so "live" can never silently become a perpetual always-on connection.

**Vault-lock ingestion consequence (honest):** the connection survives lock (session string already in subprocess memory); ingestion writes are vault-gated, so new messages **buffer in a bounded in-memory queue and flush-and-zero on unlock**. On any drop, the **platform records a durable, visible timeline marker** on unlock — `"N messages dropped during lock window [t0,t1]"` — so the case record never has a silent evidentiary gap (Finding 9).

---

## 5. Consent & disclosure

At **each session start**, a loud modal:
> Start a **NON-ANONYMOUS** Telegram connection as `<phone/account>`, monitoring `<N channels>`, via **`<Tor — isolated circuit, verified up (not OS-enforced) | DIRECT — your IP is exposed to Telegram>`**? Telegram will see this account active. [Confirm] [Cancel]

Explicit confirm; consent (`{phone, routing, channelSetHash}`, time) recorded to the case timeline. **Re-consent required** if the phone, the routing, **or the channel set** changes (Finding 6) — and **any switch to `direct` always re-prompts loudly** (it flips IP exposure). Mirrors the offensive per-scan confirm.

---

## 6. Capability wiring + lock-screen reconciliation (Finding 4)

- `'persistent-background-connection'` in `CAPABILITIES`; context surface `ctx.bgConn?: { registerWorker(w), lane(connId), secrets, onVaultLocked(cb), onVaultUnlocked(cb) }`, two-gated (declared + supplied), delivered live via a shared `BackgroundConnectionManager` singleton (mirroring the offensive controller singleton — *with* the quit hook the offensive one is missing).
- IPC `bgconn:{ list, start, stop, configure, clearCredentials, status }` via `safeHandle`.
- **Lock-screen contradiction fix:** add **`bgconn:status` and `bgconn:stop`** to `GATE_EXEMPT` (with their own internal state checks, like the `auth` namespace) so that while the vault is locked the operator can still **see** the LIVE monitor and **emergency-stop** it. The `LockScreen` renders a **LIVE indicator + emergency-stop control** (the only bgconn controls available while locked; start/configure/clearCredentials remain gated). This makes "survives lock" honest: visible and stoppable, not invisible-and-unstoppable.

---

## 7. Invariants — labeled by enforcement level (honest)

- **ENFORCED — compartmentation:** separate Tor instance + explicit `IsolateSOCKSAuth`/`IsolateDestAddr` + lane-generated distinct SOCKS creds per connId → distinct circuit *and* guard separation from the chat onion. Unlinkable at circuit/exit; far stronger guard separation than v1's shared-instance plan.
- **ENFORCED — fail-closed Tor start:** no start unless `BgconnTor.isBootstrapped()`.
- **ENFORCED — teardown:** operator-stop (even locked) / awaited-kill on app-quit (job object, no orphan) / plugin-disable (real loader path) / operator-set idle-teardown. A live connection cannot outlive consent, the app, the plugin, or the idle window.
- **ENFORCED — credential handling:** vault secret category; session via stdin/fd never argv/env; no core dumps; revocable.
- **ENFORCED — SSRF-exemption containment:** the SOCKS endpoint is reachable only by the manager-spawned subprocess, never via `ctx.egress`.
- **BEST-EFFORT (disclosed) — no direct fallback:** Tor verified + SOCKS-only handoff + no-direct-fallback Telethon config; not OS-enforced (structural jail deferred). Stated in the disclosure.
- **DISCLOSED — pseudonymous not anonymous; locked-machine memory exposure** bounded by the idle-teardown.
- No telemetry; the lane is the only added egress and it's explicitly consented.

---

## 8. Out of scope (subsystem 2 / the plugin)

Telethon CPython subprocess + bundling; phone→OTP→session auth flow; channel selection + FloodWait/scraping policy; the no-direct-fallback Telethon config (a platform-stated contract); message ingestion + the bounded lock-buffer (uses existing `case-storage`/`timeline`/`entity-registry`). Also out: app-lifetime auto-start; the structural OS-jail (deferred shared increment); any second consumer.

**Shared-infra note:** the plugin-worker teardown framework (`disablePlugin` in the loader + the `before-quit` `stopAll` hook + robust job-object subprocess kill) is generic platform infrastructure this capability *builds*, and the already-merged offensive controller should adopt it too (its missing quit hook is a tracked follow-up).

---

## 9. Error handling & testing

Fail-closed: no credentials / consent declined / **Tor not bootstrapped (Tor routing)** / manager teardown in progress / plugin lacks capability → no connection; `lane()` for unknown/unstarted conn → throws.

Tests (platform, **mock** worker — no real Telegram or Tor):
- Consent gate blocks unconfirmed start; channel-set change forces re-consent; switch-to-direct re-prompts.
- **Tor-bootstrap gate:** start refused when `isBootstrapped()` is false (Tor routing); allowed when true.
- **Lane isolation:** each connId yields a *distinct* SOCKS username/password; routing=direct yields no SOCKS.
- **Teardown:** `stopAll('quit')` calls `stop()` + `kill` for every live conn and is invoked from the before-quit path; `disablePlugin` tears down that plugin's workers; idle-teardown fires after the configured locked duration; **operator stop works while locked** (GATE_EXEMPT).
- **Survives lock (bounded):** a lock event does NOT tear down before the idle threshold; the vault-locked hook fires so the worker buffers; on unlock a drop produces a timeline marker.
- **Session handoff:** the spawn helper passes the session via stdin/fd, never argv/env (assert argv + env are secret-free).
- **SSRF containment:** a bgconn-capable plugin's `ctx.egress.fetch` to a loopback/`socks://` URL still throws.
- **Lock-screen surface:** `bgconn:status`/`bgconn:stop` are in `GATE_EXEMPT`; others are not.

Telethon integration, the auth flow, and live Tor are subsystem-2 + manual.
