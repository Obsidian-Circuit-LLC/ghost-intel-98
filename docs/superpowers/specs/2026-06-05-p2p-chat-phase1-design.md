# DCS98 P2P Chat — Phase 1 Design (Secure 1:1 over Tor)

**Date:** 2026-06-05
**Status:** Approved design; pending implementation plan.
**Scope:** Phase 1 of a phased build. This document specifies **only Phase 1**.

## Context

DCS98 has no Tor, SOCKS, WebSocket, or P2P infrastructure today. All egress is direct
`fetch` through an SSRF-guarded `safeFetch`, with the standing posture: hostile renderer,
all networking in the main process, opt-in egress (off by default), no telemetry,
encrypt-at-rest via the vault. A P2P chat is net-new networking surface; the chosen
transport (Tor via embedded `arti`) is a new bundled dependency.

GhostExodus's ask: invite-link-based P2P chat for collaboration that is secure, requires
no hosting, and does not trigger the Windows Firewall prompt.

## Phasing (decomposition)

The full request is large, so it is split into independently shippable sub-projects, each
with its own spec → plan → build → review cycle:

- **Phase 1 — Secure 1:1 transport (this doc).** Tor onion runtime, PQ-hybrid handshake,
  session encryption with forward secrecy, contacts + invite links + TOFU safety-number
  verification, local best-effort outbox, typed IPC surface, encrypt-at-rest.
- **Phase 2 — File attachments** (chunked, capped, quarantined, explicit save).
- **Phase 3 — Small groups** (membership, group key, mesh fan-out, partial-delivery semantics).
- **Phase 4 — Case-aware sharing** (share/import case records, events, entities through the
  existing validation/trust boundary).
- **Phase 5 (optional) — Fast/LAN path** (opt-in non-Tor transport; introduces a real
  listening socket and therefore a firewall prompt — deferred to keep Phase 1 Tor-only).

## Decisions locked during brainstorming

| Axis | Decision |
|---|---|
| Threat model | Metadata-resistant **Tor by default**; optional faster path deferred to Phase 5. |
| Delivery | **Local-queue best-effort** — no relay, no hosting, no mailbox. |
| Conversation shape | **1:1 in Phase 1**; small groups in Phase 3. |
| Crypto | **PQ-hybrid**: X25519 + ML-KEM-768 handshake; Ed25519 identity (ML-DSA-65 optional). |
| Content | Text in Phase 1; attachments in Phase 2. |
| Integration | Standalone in Phase 1; case-aware sharing in Phase 4. |
| Transport runtime | **Embedded arti (A)**, with bundled C-tor as a verified fallback (B). |
| Forward secrecy | Per-message symmetric ratchet **within** a session + fresh hybrid handshake **on every reconnect** (PCS across sessions). Full PQ Double Ratchet deferred. |

## Architecture & process model

All network/crypto/storage logic lives in **main**. The renderer (hostile) gets only a
typed IPC surface and never touches keys or sockets.

New subsystem `src/main/chat/`:

- `tor.ts` — owns the embedded **arti** runtime: bootstrap, publish an ephemeral **v3 onion
  service**, expose a local SOCKS port; lifecycle + status events.
- `transport.ts` — connection management behind a `Transport` interface (seam for testing):
  dial a peer `.onion` via SOCKS; accept inbound on a **127.0.0.1-only** listener that is the
  onion service's target.
- `handshake.ts` — PQ-hybrid handshake.
- `session.ts` — post-handshake AEAD framing + forward-secrecy ratchet.
- `identity.ts` — long-term keypairs, onion key, fingerprint/safety-number derivation.
- `contacts.ts`, `outbox.ts`, `store.ts` — contact list, best-effort send queue,
  encrypt-at-rest persistence.

**No-firewall-prompt property:** the engine opens only **loopback** sockets — its listener
binds `127.0.0.1`, and it dials out through arti's local SOCKS. arti makes only *outbound*
Tor connections (no routable inbound listener). Windows Firewall prompts on inbound rules for
routable listeners, so loopback-only + outbound-only = no prompt. (Phase 5's LAN path is where
a real listener — and a prompt — would appear; that is why it is deferred and opt-in.)

**Opt-in & lock model:** the engine starts only when the user enables Chat (Tor bootstrap is
egress → off by default, shown as a status like other network toggles). Identity keys,
contacts, and history are encrypted at rest via the existing vault; when the vault is
**locked**, chat is sealed (no decryption, no identity use), consistent with existing behavior.

**IPC surface (typed, minimal):** `chat:enable/disable`, `chat:createInvite`,
`chat:acceptInvite`, `chat:listContacts`, `chat:send(contactId, text)`,
`chat:history(contactId)`; push events `chat:onMessage`, `chat:onContactStatus`
(offline/connecting/online), `chat:onDelivery` (queued/sent/delivered). No key material or raw
socket crosses to the renderer.

## Identity, invite links, trust

**Identity (generated on first enable; stored in `secrets.enc`, vault-sealed):**
Ed25519 signing identity (+ optional ML-DSA-65), X25519 + ML-KEM-768 handshake static keys,
and the arti-managed v3 onion key (the `.onion` is the network locator).

**Safety number:** a stable fingerprint hashed over all identity public keys, rendered
human-comparable; compared out-of-band to catch a MITM on the invite channel.

**Invite link:** one URI sent out-of-band, e.g. `dcs98chat://invite/<base64url(payload)>`,
carrying the onion address, the inviter's identity public keys (for pin + verify), a
**one-time invite token**, and a version tag. The link is secret-grade; the one-time token
bounds replay.

**Trust = TOFU + verified safety number.** Accepting an invite pins the inviter's identity
keys. First connection is authenticated by the one-time token + a mutual handshake, so both
ends end up pinning each other (one-directional invite, mutual trust). The UI shows the safety
number with a "verified" toggle. If a pinned contact's identity keys ever change, the channel
**hard-fails with a loud warning** — no silent re-trust.

**Anti-unsolicited-contact:** inbound is accepted only with a valid one-time token (first
contact) or authentication against an already-pinned identity; everything else is dropped.

**Acceptance flow:** A creates invite (engine mints token + bundles onion/pubkeys) → A sends
link out-of-band → B pastes it, engine dials A's onion via SOCKS, runs the handshake with the
token, both pin identities → token consumed; later reconnects authenticate by pinned static keys.

## Secure-channel protocol

**Handshake — PQ-hybrid, Noise-based.** A Noise-style mutual handshake (IK-like; the
invite/pin supplies the responder's static keys) whose chaining key mixes **both** X25519 ECDH
**and** ML-KEM-768 encapsulations against each side's static KEM key — the session secret
requires breaking both primitives. The transcript hash binds both identities, the
suite/version, and (first contact) the one-time token. An Ed25519 signature over the transcript
gives explicit identity binding (ML-DSA-65 optional behind the same suite flag).

> **Open item for the plan, not hand-waved here:** the exact Noise+KEM pattern and the specific
> vetted ML-KEM-768 implementation are fixed during planning and pass a formalist + crypto-audit
> gate before any wire format is frozen. No bespoke / hand-rolled primitives.

**Forward secrecy (v1):** per-message **symmetric KDF ratchet** within a session (advance
chain key, derive fresh message key, delete old → FS), plus a **fresh hybrid handshake with new
ephemerals on every reconnect** (new root key → post-compromise healing across sessions, bounded
by long-term static-key safety). Full PQ **Double Ratchet** (continuous per-message PCS) is
documented as a later upgrade.

**Integrity / replay / ordering:** AEAD per message (ChaCha20-Poly1305) keyed from the ratchet;
nonce = monotonic per-direction counter; receiver rejects counters ≤ last seen (replay) and
orders by counter within a transcript-bound session id (blocks cross-session replay). Sender
timestamps are carried but never trusted for ordering.

**Wire:** length-prefixed frames over the onion TCP stream with a hard max frame size (DoS
guard). Frame types: `handshake`, `msg`, `ack`, `ping` (presence), `close`. The `msg` payload
is a **versioned typed envelope** so Phases 2–4 extend the content type without a wire break.

**Crypto hygiene:** libsodium for X25519/Ed25519/ChaCha20-Poly1305/HKDF; a vetted ML-KEM-768
binding for the PQ leg; all in main; key material zeroized and dropped on vault lock. Protocol
passes formalist + red-teamer + crypto-auditor before freeze.

## Delivery, data model, persistence

**Best-effort outbox.** Per-contact persisted outbox. On `chat:send`: assign local id +
monotonic per-contact sequence, encrypt at rest, enqueue `queued`, show immediately (optimistic).
Connection manager dials the contact's onion on demand (conversation opened, or queued messages
pending); when a session is up, outbox flushes **in order**: `queued → sent` (over the wire) →
`delivered` (peer app-level `ack`). No connection ⇒ stays `queued` (best-effort, no relay).
Disconnect ⇒ exponential-backoff redial while the conversation is active.

**Dedup & ordering.** Receiver dedupes by `(sender identity, session id, counter)` and by
message id. Display order = per-contact sender sequence, tie-broken by receive time; a detected
sequence gap surfaces a quiet "messages may be missing" marker rather than feigning completeness.

**Data model (encrypted at rest):**
- `Identity` (keys) → `secrets.enc` (vault).
- `Contact` → contactId = hash of pinned identity pubkey, local display name, onion address,
  pinned pubkeys, verified flag, last-seen.
- `Message` → id, contactId, direction, sender seq, counter, timestamp, state, typed content
  envelope (v1 text), createdAt.
- Store under `dataRoot/chat/` via the **existing secure-fs / encrypt-at-rest** layer (same as
  cases / sticky-notes). Vault locked ⇒ sealed, engine pauses. Caps: max history per contact,
  max outbox depth, max message size; prune beyond cap. Nothing leaves the machine except E2E
  ciphertext to the intended peer; no telemetry.

**Presence.** online / connecting / offline from the live connection + `ping` keepalive, via
`chat:onContactStatus`. Visible only to the connected peer — no central presence service, no
presence-metadata leak.

**Hostile-inbound validation.** Every inbound frame/field validated in main before persistence:
bounded sizes, type checks, counter monotonicity, content-type allowlist (v1 = text; unknown
dropped). Inbound text is untrusted display data — rendered as **text, never HTML**, reusing the
app's existing no-HTML discipline.

## Error handling & failure modes

Principle: **fail closed, fail loud, never silently accept.**

- Tor bootstrap fails/slow/censored → clear status, non-blocking UI, backoff retry; chat
  disabled until bootstrapped.
- Peer unreachable → contact *offline*, messages `queued`, backoff redial; status distinguishes
  "peer offline" from "Tor down."
- Handshake failure → version/suite mismatch = explicit error; bad/expired token = reject;
  **pinned key changed = hard fail + loud MITM warning, no auto-retrust.**
- AEAD/decrypt failure (tag, replay, malformed) → drop frame; repeated failures tear the session
  down; never accept on failure.
- Vault locks mid-session → seal: tear down sessions, zeroize keys, pause; queued sends stay
  encrypted at rest, resume on unlock; no plaintext persists; no error spam on lock.
- Malformed/oversized inbound & DoS → size caps pre-parse, bounded parser, drop unknown types,
  rate-limit inbound connections/frames, cap concurrent sessions.
- Invite misuse → replayed one-time token rejected; leaked link bounded by token + safety-number
  check.
- Store write failure → surface, mark message `failed` + retry; never silently drop.
- arti crash → supervised restart with backoff, "Tor restarting" status, sessions recovered.

## Testing strategy

1. **Pure unit (the bulk, deterministic, seeded RNG):** handshake KDF/transcript vectors;
   ratchet advance + old-key-deletion (FS property); AEAD framing round-trip + tag/replay/oversize
   rejection; invite parse/serialize + one-time-token consumption + malformed-link rejection;
   safety-number stability + change-detection; outbox state machine (transitions, dedup, ordering,
   gap detection); inbound validation (caps, allowlist, monotonic counter).
2. **In-memory transport integration (no real Tor):** two engine instances over a mock duplex
   stream behind the `Transport` seam — handshake → message → ack → reconnect → rehandshake →
   key-change-detection, end-to-end.
3. **Loopback-Tor smoke (gated/manual):** two real arti instances on one host, one dials the
   other's onion via SOCKS; assert a message round-trips. Gated out of the fast suite.
4. **Adversarial gates before wire-freeze:** formalist (handshake/ratchet properties), red-teamer
   (MITM, downgrade, replay, malformed-frame, resource exhaustion), crypto-auditor (PQ-hybrid
   construction, lib usage, zeroize coverage), determinism-auditor.
5. **Negative/abuse tests:** invalid token, key-change MITM, replayed/oversized frame, unknown
   content type, connection flood — each asserting fail-closed + loud.

**Verification floor:** typecheck + unit + in-memory-integration suites green; security gates
passed; a manual loopback-Tor demonstration that a message round-trips over a real onion.

## Open items to resolve in the implementation plan

1. Confirm arti's current **onion-service (server-side) maturity**; if insufficient, switch to
   the bundled C-tor fallback (B) — decision gate before transport work begins.
2. Fix the exact **Noise+KEM handshake pattern** and the specific vetted **ML-KEM-768** library.
3. Packaging: how arti is shipped (sidecar binary vs native addon) per-platform and pinned by
   hash (supply-chain), consistent with the unsigned-but-hash-verified release posture.
4. Bundle-size budget impact (arti adds to the installer).

## Out of scope for Phase 1

File attachments (Phase 2), groups (Phase 3), case-aware sharing (Phase 4), the non-Tor fast/LAN
path (Phase 5), full PQ Double Ratchet, and any relay/mailbox/hosting.
