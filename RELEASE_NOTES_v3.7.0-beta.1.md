# Dead Cyber Society 98 — v3.7.0-beta.1 (EXPERIMENTAL PRE-RELEASE)

> ⚠️ **EXPERIMENTAL / BETA — for functional testing only.** This build adds a new **P2P chat** whose
> encryption is **NOT yet formally verified**. Do **not** rely on it for real adversarial security or
> sensitive coordination. It is published as a **pre-release** for in-house dogfooding (finding bugs
> and gremlins), separate from the stable line. The stable channel remains **v3.6.8**.

## What's new — P2P Chat (beta)

A new **Chat (beta)** module: serverless, accountless peer-to-peer chat over **Tor onion services**.
- **No hosting, no account, no central server.** Each peer publishes its own onion service (bound to
  localhost — no Windows Firewall prompt) and dials peers over Tor's SOCKS port.
- **Invite links.** Create an invite (`dcs98chat://invite/…`), send it out-of-band; the other side
  pastes it to connect. The whole invite is signed by your identity key.
- **PQ-hybrid encryption.** Handshake combines X25519 **and** ML-KEM-768 (post-quantum), with Ed25519
  identities and forward-secret message sessions. Designed against harvest-now-decrypt-later.
- **TOFU + safety numbers.** Compare the per-contact safety number out-of-band to detect a MITM.
- **Encrypt-at-rest.** Contacts, message history, keys, and one-time prekeys are stored under your
  vault (sealed when login is on).
- **Opt-in.** Off by default — enabling it is the only thing that starts Tor (network egress).

Bundled **Tor 0.4.9.9** (official Expert Bundle, win-x64), verified at build time: SHA-256 matches the
Tor Project's GPG-signed sums (good signature from Tor Browser Developers).

## ⚠️ Security status — read this

- The handshake construction is **pending formal verification** (ProVerif/CryptoVerif). It passed an
  internal adversarial review and ~100 unit/integration tests, **but no formal proof exists yet.** Treat
  the crypto as **unproven**.
- The author has **not** live-tested two real peers over Tor on Windows — that is precisely what this
  beta is for. Report anything that breaks.
- Compare safety numbers out-of-band before trusting a contact's identity.

## How to test (in-house)

1. Install on two Windows machines (or two Windows user profiles).
2. Open **Chat (beta)** (Access menu / desktop), click **Enable chat** (starts Tor; first bootstrap
   can take a minute).
3. On one side: **Create invite** → copy the link → send it to the other side out-of-band.
4. On the other side: paste the link under **Accept invite** → **Connect**.
5. Chat. Compare the **safety number** on both ends. Try closing/reopening, going offline/online.

## Known limitations (beta)

- Crypto **not formally verified** (see above).
- Best-effort delivery: a message reaches a peer only while both apps are connected (no relay/mailbox).
- The PQ "last-resort" prekey path is forward-secrecy-degraded by design (used only if one-time
  prekeys are exhausted).
- **Windows x64 only** (the bundled Tor is win-x64).
- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.

## Verification

`typecheck` clean · ~100 chat unit + integration tests (wire/crypto/handshake/session/transport/
stores/engine) · full app suite green · end-to-end engine test (invite → handshake → message → ack →
persisted history) over an in-memory transport · app boots and the Chat module renders. The Tor onion
path and two-peer Windows flow are exercised by **your** live run, not the author's CI.

---

**Artifact:** `DCS98-Setup-3.7.0-beta.1.exe` (139,694,948 bytes ≈ 133 MB, NSIS, x64, unsigned, Tor bundled)
**SHA-256:** `af217aef314c8ff81c3664e3f6de7924f55c5777d8766fc2d01d5c6f1f1d864b`
