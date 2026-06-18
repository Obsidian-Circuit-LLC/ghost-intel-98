# Ghost Intel 98 — v3.14.1

**Documentation patch — honest chat-verification wording.** No code changes; the application is
identical to v3.14.0.

## What changed

The README described the Tor P2P chat handshake as verified by "ProVerif symbolic + CryptoVerif
computational," which implied the computational proof was complete. It is not. This release corrects the
wording everywhere it appears to reflect the actual state:

- The handshake (first-contact **and** reconnect) is **symbolically verified internally with ProVerif**.
- The **CryptoVerif computational proof is in progress** (not yet complete).
- An independent external audit and a FIPS module remain unmet gates.

The chat remains opt-in and off by default. This is a correctness fix to the claims we publish — nothing
about the shipped binary or its behavior changed from v3.14.0.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.1.exe -Algorithm SHA256
```

SHA-256: `TBD`
Size: TBD bytes (TBD)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- 1071 tests green; typecheck clean. Documentation-only change from v3.14.0.
- Same `Ghost Intel 98` app id, so it upgrades in place.
