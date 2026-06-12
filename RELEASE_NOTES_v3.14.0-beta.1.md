# Dead Cyber Society 98 — v3.14.0-beta.1 (BETA)

> ⚠️ **BETA — for functional testing.** This build folds in a batch of dogfooding fixes plus two that
> are specifically worth confirming on a real install: the **chat invite-accept fix** and the **Piper
> TTS static fix**. Both are correct in code and fully unit-tested, but their failure modes only show
> in a *packaged* runtime (not the test suite), so this build is the thing to verify them on. The
> stable channel remains the last non-beta line; the Tor P2P chat is still **pending external audit +
> FIPS build** — don't rely on it for real adversarial security.

## What's new

- **Journal Jots** — a new password-protected (4-digit PIN) journal app. Entries are consolidated inside
  the app (they never land in the Briefcase) and are encrypted at rest with everything else under the
  optional vault login. The PIN is a **rate-limited lock over already-encrypted storage** — a convenience
  gate, not the encryption boundary (the vault is). scrypt + salt, constant-time compare, escalating
  lockout on repeated wrong PINs.
- **Chat invite-accept fix.** The Tor P2P chat's message AEAD used a cipher the shipped runtime
  (Electron/BoringSSL) doesn't expose by name, so accepting an invite failed with "Unknown cipher" in
  every packaged build. It now uses a runtime-independent implementation of the **same** ChaCha20-Poly1305
  — identical algorithm and wire format, the formal model is unchanged.
- **Piper TTS no longer plays as static.** Piper now writes its audio to a **seekable temp file** instead
  of a stdout pipe, so the WAV length headers are correct and the player stops decoding garbage over the
  voice. (The Microsoft/SAPI voices were always clean — this was Piper-specific.)
- **EyeSpy** — a **Purge-all** button, **edit-a-stream** in place, and a **geo-aware header-mapped CSV
  import**: a feed CSV whose header names a URL column now imports the geo columns too (city / lat / lon /
  country / source, alias-aware, order-independent), not just JSON.
- **Jukebox** opens at a sensible default size and has a **collapse/expand** toggle for a compact
  "just the deck" view.
- **DialTerm** drops the redundant touch-tone dialpad animation — **Dial** goes straight to the AOL-style
  dial-up client.
- **Mail** — the account-setup dialog now closes properly (it could trap you when no account was set up
  yet) and gained an X button. **Notepad 98** — delete a saved entry.

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **Chat:** Enable chat on two machines/profiles → Create invite on one → paste under Accept invite on
   the other → **Connect**. This is the path that was throwing "Unknown cipher"; confirm an invite is
   accepted and a message round-trips.
3. **Piper TTS:** in the AI Assistant, pick the Piper (neural) voice and have it speak — confirm clean
   speech, no static. (Piper is bundled; no download.)
4. **Journal Jots / Jukebox / EyeSpy / DialTerm / Mail / Notepad** — exercise the items above.

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending** — treat as
  unproven for real adversarial use.
- Long video files attached to **encrypted** cases still buffer the whole decrypted file before playing
  (a seekable decrypted-stream path is a follow-up); unencrypted attachments stream fine.

## Verification

`typecheck` clean · **681 automated tests** green (incl. the new Journal Jots store/PIN suite, the geo-CSV
import suite, and the chat crypto round-trip/handshake suites). The chat two-peer-over-Tor flow and Piper
audio on a real Windows install are exercised by **your** run, not CI — that's what this beta is for.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.1.exe` (520,567,264 bytes ≈ 496 MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `796feaaef3b9723014f1c29d1adf0b83b3c1f3ef1404be82f37fe697eaa2555d`
