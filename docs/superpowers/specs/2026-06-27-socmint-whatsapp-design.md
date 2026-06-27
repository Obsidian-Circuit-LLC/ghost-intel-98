# WhatsApp Collector — Draft Design Spec for Ghost Intel 98 SOCMINT Module

**Status:** DESIGN ONLY. No source written. All library claims derive from primary-source reads (2026-06-27); items not verifiable against primary sources are marked **[UNVERIFIED]**. Produced by a design-research agent, reviewed and accepted by the orchestrator. Extends the built SOCMINT v1 (Telegram) — reuses its schema/store/rank/labels/filter/gate; adds a WhatsApp collector + sealed Baileys adapter + encrypted-session adapter + OpSec UI.

> **Operator decision (2026-06-27, eyes-open):** build WhatsApp as **monitoring-only**, accepting the burner is visibly in each target group's member list (participation/deanon) + ToS ban risk. No public WhatsApp search; capability is strictly observing messages in groups the burner has already joined.

## Primary-source read log (anti-fabrication record)
- github.com/WhiskeySockets/Baileys/releases — v7.0.0-rc13 (May 21, 2025) is latest
- Baileys package.json — MIT, v7.0.0-rc13, dep list
- baileys.wiki/docs (intro, receiving-updates, handling-messages) — auth model, events, ToS warning
- deepwiki Baileys (indexed 2026-06-23) — auth state, Node >=20, QR + pairing-code modes
- lotusbail incident: The Register / BleepingComputer / SecurityWeek / SC World (all Dec 2025)
- Baileys GitHub #450 (media download proxy), #2153/#450 (SOCKS5)

## 0. Corrections to v1 spec §1 (WhatsApp feasibility)
- **v7.4.4 claim: RETRACTED.** Latest release is **v7.0.0-rc13 (May 21, 2025)** — ~13 months stale, still RC. The earlier "v7.4.4 June 2026" was a transient npm 403 artifact, no source supports it.
- **lotusbail supply-chain attack: VERIFIED** (was [UNVERIFIED] in v1). Malicious npm `lotusbail` cloned `@whiskeysockets/baileys`, ~56k downloads over ~6 months from May 2025, exfiltrated all WhatsApp auth tokens, every message, contact lists, and media via RSA-encrypted exfiltration. Critically it **hijacked device-linking with a hard-coded pairing code → persistent account access that survives package uninstall** (victim must manually unlink devices in WhatsApp). The threat is persistent account compromise, not just credential theft. This gates the entire WhatsApp design on verified-package-only installation (§5.5).
- **SOCKS5: PARTIALLY VERIFIED.** Works via `agent`/`fetchAgent` (`SocksProxyAgent` from `socks-proxy-agent`) in `makeWASocket`; the control WebSocket is proxied. Media downloads may not reliably honour the proxy (#450) **[UNVERIFIED]** — reduced risk since this design prohibits media auto-fetch, but documented as a hard invariant.
- **"<2% ban for receive-only" stat: still UNVERIFIED** (one commercial blog, undisclosed methodology). Not a design assumption.

## 1. Schema
Extend `SocmintPlatform` in `src/shared/socmint/types.ts`: `'telegram' | 'whatsapp'` (only type change; `HarvestedItem` is platform-generic). Mapping from Baileys `proto.IWebMessageInfo`:

| HarvestedItem | WhatsApp source | Notes |
|---|---|---|
| `id` | `harvestedItemId('whatsapp', channelId, msg.key.id)` | reuse `src/main/socmint/utils.ts` |
| `platform` | `'whatsapp'` | |
| `channelId` | `msg.key.remoteJid` | group JID `…@g.us` (DMs `…@s.whatsapp.net`) |
| `channelLabel` | `sock.groupMetadata(jid).subject` | attacker-controlled at renderer |
| `authorId` | `msg.key.participant` | sender JID |
| `authorHandle` | `participant.replace('@s.whatsapp.net','')` | phone digits; bidi/homoglyph-guard at renderer |
| `messageId` | `msg.key.id` | |
| `text` | `msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? ''` | both checked |
| `mediaType` | which sub-message is set (image/video/audio/document) | label only; never auto-download |
| `mediaRef` | `''` (analyst-triggered save only → basename) | never a path/href |
| `url` | `''` | no public permalink; `safeHref('')`→null→no anchor. Do NOT build `wa.me` links (analyst trap) |
| `publishedAt` | `new Date(msg.messageTimestamp*1000).toISOString()` | seconds epoch |
| `harvestedAt` | injected clock | never inline `Date.now()` |

**Group filter invariant:** the collector filters `messages.upsert` to `remoteJid.endsWith('@g.us')` AND the subscribed group-JID set (the burner may be in non-monitored groups). DMs/broadcast excluded.

## 2. Collector: `makeWhatsAppCollector` (sealed, implements `SocmintCollector`)
New file `src/main/socmint/whatsapp-collector.ts`; signature mirrors `makeMtcuteCollector({ burnerId, transport: SocmintTransport, harvestedAt })`. Sealed seam: no static `import('@whiskeysockets/baileys')`; guarded dynamic import throws `'SOCMINT: WhatsApp library not installed — pending operator supply-chain verification + library lock. Complete §5.5 checklist before unsealing.'` `MockCollector` (existing) reuses unchanged.

- **`connect()`** — build secretStore-backed auth state (§4); build `SocksProxyAgent('socks5://user:pass@127.0.0.1:port')` when `transport.mode==='tor'` else null; `makeWASocket({ auth, agent, fetchAgent, syncFullHistory:<D2>, logger: pino({level:'silent'}) })` (silencing is a no-log requirement — Baileys logs key material at default level); register `connection.update` + persist on `creds.update`. If creds null → linking ceremony (§2.8) before resolving.
- **`join(groupJid)`** — **assert-joined, not auto-join.** Calls `sock.groupMetadata(jid)`; success → `MonitoredChannel{channelId:jid,label:subject}`; failure → throws `'WhatsApp: burner is not a member of <jid> — manual join required'`. (Diff from Telegram, which network-joins a public channel.)
- **`backfill(jid,limit)`** — limited/opt-in: with `syncFullHistory:true`, history arrives via `messages.upsert {type:'append'}`; `backfill()` drains a per-group buffer accumulated at connect (cap=limit, drop-oldest), then returns `[]` on later calls. Returns `[]` if `syncFullHistory:false` (recommended default). Not a paginated on-demand backfill (WhatsApp has no such API).
- **`subscribe(groupJids,onItem)`** — `messages.upsert` handler filtered to `type==='notify'`, `@g.us`, subscribed set, `!fromMe`; returns unsubscribe.
- **`disconnect()`** — `sock.end()`, flush pending auth writes, keep the session (for reconnect).

### 2.8 New IPC flow — WhatsApp linking ceremony (the principal new surface)
Telegram has a pre-existing StringSession; WhatsApp's session doesn't exist until linking inside a running socket. New channels in `ipc-contracts.ts`: `setWhatsappBurnerPairingCode`, `hasWhatsappBurner`, `unlinkWhatsappBurner`. **Pairing code** is primary (8-digit text — no QR image/binary in renderer; QR optional fallback per D1).
- `handleSetWhatsappBurnerPairingCode(burnerId, phone)` — gate check (`networkEnabled`); `resolveTransport`; sealed import; temp `makeWASocket` (empty auth, proxy, silent logger); `sock.requestPairingCode(digits)`; return `{pairingCode}`; on `connection:'open'` persist creds to secretStore + push linked status via `webContents.send`; on close/timeout teardown + failure event.
- `handleHasWhatsappBurner` — boolean only. `handleUnlinkWhatsappBurner` — delete secretStore keys (does not server-side unlink — user must, in WhatsApp → Linked Devices).

## 3. Transport (reuse, fail-closed)
Reuse `settings.socmint.transport` (default `direct`/clearnet, operator-authorized) via the existing `deps.transport()` injection. `resolveTransport(burnerId,mode)` unchanged — tor mode throws `SocmintTorUnavailableError` if Tor down, propagated (no silent fallback, no silent retry). Baileys SOCKS5 wiring: `new SocksProxyAgent('socks5://user:pass@host:port')` → `makeWASocket({agent, fetchAgent})`; per-burner `(user,pass)` via `deriveBurnerCredentials` → `IsolateSOCKSAuth` distinct circuit (torrc already set). **Tor-over-WhatsApp is flaky** (WhatsApp flags datacenter exit IPs aggressively on long-lived WebSockets) — the renderer must show a per-session advisory when `transport==='tor' && platform==='whatsapp'` ("supported but increases ban risk + instability; the burner's clearnet IP is never used — the connection fails rather than falls back; clearnet recommended for WhatsApp"). Media-download proxy gap (#450) is moot under the no-media-fetch rule; must be re-verified if media-save is ever added. See D3/D4 for per-platform transport/gate options.

## 4. Session storage (secretStore-backed auth adapter)
`useMultiFileAuthState` writes 28+ **plaintext** files; Baileys docs say "DO NOT rely on it in prod." Plaintext auth = critical (it holds the long-term Signal identity key → decrypts past/future messages). New file `src/main/socmint/whatsapp-auth.ts`: `makeWhatsAppAuthState(deps)` (injected read/write/delete) implementing Baileys' `AuthenticationState` — `creds` serialized to one JSON blob under `socmint.whatsapp.burner.<safeId>.creds`, `keys` (Signal store) serialized to one blob under `…​.keys` (single blob, NOT per-key, to avoid keychain saturation). `withLock` serialized; **200ms-debounced** writes (Baileys ratchets `creds.update` frequently; in-memory state authoritative, secretStore best-effort-latest). `safeId = burnerId.replace(/[/\\]/g,'_')`. Never echoed (boolean only). Unlink deletes both keys.

## 5. OpSec & Charter
- **5.1 Participation-deanon (blocking, not mitigable):** the burner phone number is permanently/immediately visible to every member+admin of every joined group; admins get join notifications + can screenshot. It traces to the SIM purchase event; any attributable linkage (CCTV/retail/registration/VoIP-reuse) deanonymizes to physical origin. Posture is **infiltration, not surveillance** — the burner is a participant. Renderer must show, **before the first WhatsApp group is configured** (not just on monitor-start), a per-session (non-permanently-suppressible) warning stating exactly this. Cannot be mitigated by routing/library choice.
- **5.2 Ban timeline:** receive-only low-volume = lower; `syncFullHistory:true` = elevated (bulk-read signal); many groups + frequent reconnects = cumulative. Recommend `syncFullHistory:false`, spaced group joins, stable long connections. On persistent auth failure → delete secretStore entry, retire burner.
- **5.3 XSS (critical, identical to Telegram):** `text`/`authorHandle`/`channelLabel`/`url`/`mediaRef` are attacker-controlled — `textContent` only, no `dangerouslySetInnerHTML`; bidi/homoglyph normalization on handle/label; `url=''`→no anchor (reuse `safeHref`). Route the renderer through the **commit security-review hook**, not per-task only (MEMORY lesson).
- **5.4 No auto-fetch (critical):** WhatsApp messages often carry preview links — no preview/auto-fetch/`link-preview-js` (verify it's absent from the lockfile); URLs in text are `textContent` only.
- **5.5 Supply-chain gate (elevated, non-negotiable — per lotusbail §0):** before unsealing, complete: (1) verify scope is exactly `@whiskeysockets/baileys` (GitHub WhiskeySockets/Baileys); (2) `--save-exact` v7.0.0-rc13 + verify `package-lock.json` integrity SHA-512 vs registry, recorded in a comment by the seam; (3) audit `whatsapp-rust-bridge` (0.5.4) — WASM vs native NAPI (native → Electron rebuild + per-platform bundling + checksum-verify prebuilt) **[UNVERIFIED]**; (4) audit `libsignal` (^6.0.0) identity/source — a different author than expected = red flag **[UNVERIFIED]**; (5) confirm `link-preview-js` absent.
- **5.6 No telemetry / loopback-only AI:** `pino` silenced; no cloud egress; `assertLoopbackAi()` unchanged for ranking WhatsApp text.
- **5.7 Burner provisioning:** the phone that enters the pairing code exposes its IP/fingerprint/number to Meta at link time regardless of the app's transport — irreducible clearnet exposure at the phone side. Use an unlinked SIM/device/network.

## 6. Decisions needed from the operator
- **D1** Pairing method: pairing-code (recommended) / QR / both.
- **D2** `syncFullHistory`: default-off (recommended) / on (history but bulk-read ban signal).
- **D3** Per-platform vs shared transport setting (currently shared `settings.socmint.transport`). Telegram-Tor + WhatsApp-clearnet needs a per-platform field + migration.
- **D4** Separate `networkEnabled` gate for WhatsApp vs shared.
- **D5** Native-dep audit posture (`whatsapp-rust-bridge`, `libsignal`): accept-as-is / audit-before-unseal (correct) / attempt-exclude.
- **D6** Burner provisioning: physical SIM (lower-risk baseline) vs VoIP (higher ban-risk [UNVERIFIED delta]).
- **D7** Analyst-triggered media-save as a v2 feature (needs the #450 proxy gap resolved) or text-only.
- **D8** Separate WhatsApp library-lock smoke test (recommended — the agent/fetchAgent SOCKS5 path differs mechanically from mtcute).

## 7. Task breakdown (implementation plan skeleton)
All sealed/testable with injected deps + deterministic mocks; no app code until D1–D8 resolved where they gate a task.
- **WA-T1** Schema: `SocmintPlatform += 'whatsapp'`; WhatsApp→HarvestedItem mapper; extend `test/socmint-types.test.ts`.
- **WA-T2** Sealed `makeWhatsAppCollector` (every method throws sealed message; `disconnect` no-op); `test/socmint-whatsapp-collector.test.ts`.
- **WA-T3** `whatsapp-auth.ts` secretStore adapter (injected store; creds/keys JSON round-trip; mutex; debounce); `test/socmint-whatsapp-auth.test.ts` with in-memory Map.
- **WA-T4** `buildBaileysProxy(transport)` helper (direct→null; tor→SocksProxyAgent URL; unknown mode still throws); unit-tested without live Baileys.
- **WA-T5** IPC contracts: 3 new channels + handler stubs; extend `test/socmint-contracts.test.ts`.
- **WA-T6** `handleHasWhatsappBurner`/`handleUnlinkWhatsappBurner` (secretStore, never echoed); gate test with mock store.
- **WA-T7** `handleSetWhatsappBurnerPairingCode` to the egress gate (gate-closed→`{disabled:true}`; gate-open→sealed error, not crash/fallback); extend `test/socmint-gate.test.ts`.
- **WA-T8** Renderer: participation-deanon warning + pairing-code link form + `@g.us`-guarded channel input + Tor advisory + XSS invariants; manual-smoke checklist (not headlessly tested).
- **WA-T9** Operator smoke test (unblocks unsealing): two burners over bgconn Tor, distinct circuits via `IsolateSOCKSAuth` (same WhatsApp DC IP), `tcpdump` zero clearnet SYNs, `link-preview-js` absent, `whatsapp-rust-bridge` build-type confirmed loadable in Electron.
- **WA-T10** `register.ts` wiring + preload exposure (after WA-T9); extend contracts test.

## Sources
Baileys releases/package.json/wiki/deepwiki; lotusbail (The Register/BleepingComputer/SecurityWeek/SC World, Dec 2025); Baileys #450 / #2153; one commercial ban-rate blog (methodology undisclosed, [UNVERIFIED]).
