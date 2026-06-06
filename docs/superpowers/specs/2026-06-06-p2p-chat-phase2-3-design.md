# DCS98 P2P Chat — Phase 2 (attachments) & Phase 3 (groups) design

Status: **implemented on `main`** (2026-06-06). Chat crypto remains EXPERIMENTAL
pending formal verification — these phases add NO new cryptographic primitives.

## Phase 2 — file attachments

**Decision:** chunked file transfer over the existing encrypted session, with a
hash-verified, explicit-save quarantine on receipt.

- A file is one `FileOffer` envelope + N ordered `FileChunk` envelopes, each its own
  AEAD-sealed `Msg` frame → every chunk inherits the Phase 1 session's
  confidentiality / integrity / ordering / replay protection. No new crypto.
- The transfer layer (`transfer.ts`) adds only application concerns: total-size
  bound (64 MiB), per-index length validation, idempotent dedup (reject conflicting
  dups), and a whole-file SHA-256 bound in the offer + verified **before** bytes are
  released to disk.
- Receipt path: verified bytes → encrypted-at-rest quarantine → user explicitly
  saves out via the app's hardened save helper (sanitise + symlink-refuse + atomic).
  Bytes are picked / quarantined / saved entirely in main (hostile-renderer model).
- Caps: `CHUNK_SIZE` 128 KiB (well under the 1 MiB frame cap after overhead),
  `MAX_ACTIVE_RECEIVERS` 8, 2-min idle reap (slow-loris guard), quarantine swept of
  orphans on enable + deleted on save (no indefinite retention of received material).

Red-team hardening applied post-implementation: save-path sanitisation/symlink/atomic
(was a real path-confusion + symlink-follow hole), quarantine retention cleanup, and
the stalled-transfer reaper. See commit `d608b3c`.

## Phase 3 — small groups (client-side fan-out)

**Decision (operator-selected):** client-side fan-out. A group is a shared `groupId`
+ name + member list of contactIds. Sending a group message encrypts it **separately
over each member's existing 1:1 session**. **Zero new cryptography**, so no new
formal-verification burden; the EXPERIMENTAL surface is unchanged.

Rejected alternatives: sender-keys (Signal-style) and full MLS/TreeKEM — both add new
crypto that would have to pass the formalist/crypto-auditor gate before losing the
EXPERIMENTAL label. Overkill for small trusted teams.

- Membership is a **local view** per device. Peers converge on the same group via
  `group-invite` control messages (carry groupId + name + full participant
  fingerprint list); `GroupStore.upsert` **unions** member sets so each peer's
  invite reconciles.
- Group history is keyed by groupId; inbound messages are attributed to the sender's
  contactId and dropped for unknown groups (no auto-join from a bare message).

**Known v1 limitation (surfaced in the UI):** full delivery requires a **complete
mesh** — each member can only relay to members it has paired with 1:1. The
conversation header shows an "some members offline" notice. File attachments are
1:1-only this phase.

## Remaining (Phase 4 + Piper) — not yet built

- **Phase 4 case-aware sharing** — design fork pending: export-and-send (share a case
  artifact into chat as a file/text, reusing Phase 2; no receiver-side import) vs
  structured case-object sharing with receiver-side import (larger, trust-sensitive).
- **Piper TTS** — needs its own brainstorm: bundle-vs-download of the binary + a
  CC0/MIT-licensed voice; this involves egress/licensing decisions reserved to the
  operator.
