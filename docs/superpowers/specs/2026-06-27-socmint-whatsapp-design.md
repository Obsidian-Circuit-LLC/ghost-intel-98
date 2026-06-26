# SOCMINT WhatsApp Collector — Draft Design Spec (v0.1, for operator review)

Status: DESIGN ONLY. Extends the built SOCMINT v1 (Telegram) module — reuses its schema, store, ranking, labels, filter, and egress gate; adds a WhatsApp **collector** + schema extension + OpSec UI. Library/API specifics carried from the v1 spec §1 feasibility; anything not re-verified here is **[UNVERIFIED]** and must be confirmed at library-lock time.

> **Operator decision (2026-06-27, eyes-open):** build WhatsApp as **monitoring-only**, accepting that the burner account is **visibly in each target group's member list** (participation/deanon) and the ToS ban risk. There is **no public WhatsApp search** — the only capability is receiving messages from groups the linked burner has already joined.

## 1. Scope & honest framing

WhatsApp is **participation, not passive collection**. The linked burner number appears in every monitored group's member list, visible to admins. This is the inverse of the charter OpSec posture and is accepted by explicit operator decision. v1 capability is strictly: **observe messages in groups the burner is already a member of**. No global search, no discovery, no joining-by-scrape.

This is a collector behind the existing SOCMINT infrastructure, not a new module.

## 2. Library

**Baileys** (`@whiskeysockets/baileys`) — pure-JS WhatsApp Web multi-device client, MIT, actively maintained (v7.x line as of 2026 — **[UNVERIFIED] exact version**; confirm + pin at lock). Links a device via **QR code or pairing code**; exposes `messages.upsert` events and group metadata; can fetch limited history. The "lotusbail" token-harvesting fork is a real threat-class but the specific incident is **[UNVERIFIED]** — pin by integrity hash and verify scope/name at install.

**Sealed seam (build rule):** do NOT add or install `@whiskeysockets/baileys` in this build. The collector is written to the interface; its dependency import is a guarded dynamic import that throws `'SOCMINT: WhatsApp library not installed — pending operator lock'` until the operator pins it. Mirrors the Telegram `makeMtcuteCollector` sealed pattern.

## 3. Schema (reuse + extend)

- Extend `SocmintPlatform` in `src/shared/socmint/types.ts`: `'telegram' | 'whatsapp'`.
- Map a WhatsApp group message → the existing `HarvestedItem`:
  - `platform: 'whatsapp'`
  - `channelId` = group JID (`...@g.us`); `channelLabel` = group subject
  - `authorHandle` = participant pushname (untrusted); `authorId` = participant JID
  - `text` = message body (extracted from the relevant message type; non-text → empty + `mediaType`)
  - `mediaType`/`mediaRef` = media kind + an opaque local ref if downloaded (basename-sanitised); **never** a path
  - `url` = none (WhatsApp has no public permalink) → empty string; renderer shows no anchor
  - `messageId` = message key id; `publishedAt` = message timestamp (ISO, from the platform — never `Date.now()`); `harvestedAt` = injected clock
  - deterministic `id` = SHA-256 of `whatsapp:<groupJID>:<messageId>` (reuse `harvestedItemId` in `src/main/socmint/utils.ts`)
- **Reuse unchanged:** `store.ts` (encrypted per-case sidecars + exact-id dedup), `rank.ts` (loopback embedding ranking), `labels.ts` (analyst accept/reject), `filter.ts` (literal keyword match — never RegExp on untrusted text).

## 4. Collector (sealed, implements `SocmintCollector`)

`makeWhatsAppCollector({ burnerId, transport, harvestedAt })` implementing the existing interface:
- `connect()` — restore the burner session (see §5) and open the Baileys socket; **sealed** (guarded import throws until lock). In tor mode, see §6.
- `join(jid)` — WhatsApp cannot join-by-scrape; this **asserts membership** of an already-joined group and registers it for monitoring (throws if the burner is not a member).
- `subscribe(groupJids, onItem)` — hooks `messages.upsert` filtered to the monitored group JIDs, maps each to `HarvestedItem`, applies the local keyword `filter`, emits. Returns an unsubscribe.
- `backfill(jid, limit)` — best-effort recent history if the socket supports it; **[UNVERIFIED]** depth; document the limit honestly.
- `disconnect()` — close the socket; teardown wired into app-quit lifecycle.

## 5. Session storage (encrypted, never echoed)

Baileys' default `useMultiFileAuthState` writes creds/keys to **plaintext disk files** — that is forbidden. The collector must serialise the Baileys auth state (creds + signal keys) and persist it **only via `secretStore`** (`src/main/secrets/index.ts`), namespaced `socmint.wa.<burnerId>.authState`, OS-encrypted, never in `settings.json` or logs, **never echoed to the renderer** (`hasBurner`-style boolean only). A custom auth-state adapter backed by `secretStore` (or secure-fs) replaces the file-based default.

## 6. Transport

Reuse `settings.socmint.transport` (`'direct' | 'tor'`, default **direct/clearnet** per operator scope). Baileys-over-Tor is flaky and increases ban risk (**[UNVERIFIED]** how cleanly Baileys' WebSocket honours a SOCKS proxy). Rule, consistent with the v1 fail-closed invariant: in **`tor`** mode the collector routes the Baileys socket through the bgconn SOCKS proxy and **refuses (throws) if Tor is down — never silently clearnet**; if Baileys cannot be configured to use the proxy, the collector must **refuse to connect in tor mode** (fail closed), not fall back. `direct` mode is the explicit operator clearnet choice. The egress gate `settings.socmint.networkEnabled` (off by default) governs whether any connection happens.

## 7. OpSec & Charter

- **Participation-deanon (the load-bearing reality):** the burner number is visible in every monitored group's member list. The renderer **must show a blocking, explicit warning before linking a WhatsApp burner** ("This account will be visible to the admins/members of every group you monitor; it is not anonymous"). Non-dismissible-by-accident.
- **Untrusted content:** message body, pushname, group subject are attacker-controlled — render as `textContent` only (no `dangerouslySetInnerHTML`); reuse `safeHref` (which already rejects non-http(s) and userinfo) for any link surfaced; never auto-fetch links or media from message content; media downloaded only from WhatsApp's own CDN via the collector's transport, basename-sanitised.
- **No RegExp on untrusted text** (reuse `filter.ts`). **Encrypt at rest** (store + session). **No telemetry.** **No-log** of message text / session / burner number.
- **Ban expectation:** weeks; document; on disconnect/ban surface a clear status, do not auto-relink.

## 8. Decisions needed from the operator

1. **Capture scope:** groups-only (recommended) vs also direct messages.
2. **Link method:** QR vs pairing-code (pairing-code is friendlier for a headless burner).
3. **Media:** download+store media, or metadata-only (recommended for v1 — less disk, less exposure).
4. **Burner provisioning:** who provides the WhatsApp burner number/device.

## 9. Task breakdown (for the implementation plan)

1. Schema: extend `SocmintPlatform` to `'whatsapp'`; WhatsApp message→`HarvestedItem` mapper (pure, unit-tested).
2. WhatsApp session-secret adapter: Baileys auth-state ↔ `secretStore` (encrypted, round-trip tested; never plaintext).
3. `makeWhatsAppCollector` sealed adapter (interface contract via a mock; guarded-import throws sealed-seam error; transport fail-closed in tor mode).
4. IPC + gate reuse: wire WhatsApp into the existing `socmint:*` handlers (platform param) or parallel `socmint:wa*` channels; egress gate; burner secret set/has (never echoed).
5. Renderer: WhatsApp panel + the **blocking participation warning** before link; items rendered XSS-safe; reuse the rank/label UI.
6. Tests: schema mapper, session round-trip, collector contract + sealed seam + tor-fail-closed, gate, renderer safe-render (extend the safeHref pattern).

Reuses unchanged: `store.ts`, `rank.ts`, `labels.ts`, `filter.ts`, `utils.ts`, the egress-gate pattern, `safe-href.ts`.
