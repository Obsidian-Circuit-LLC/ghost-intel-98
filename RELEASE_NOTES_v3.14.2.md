# Ghost Intel 98 — v3.14.2

**Corrects the chat-verification wording to match the formal record.** The only code change is the text
of the in-app Chat "Good to know" panel; no behavior, crypto, or protocol changes.

## What changed

v3.14.1 described the Tor P2P chat handshake's **CryptoVerif computational proof as "in progress."** That
was wrong. The project's internal formal kit reproduces:

- **12/12 CryptoVerif models — "All queries proved"** (CryptoVerif 2.12): key-schedule full chain,
  mutual authentication, KCI, forward secrecy (classical + PQ), the unified KDF→AEAD model, the G2′
  hybrid-IND game, and the reconnect `mac_R` DoS-gate unforgeability.
- **ProVerif 4/5** (the R-authenticates-I injective query proves non-injectively only; injectivity is
  lifted via single-use prekey consumption and discharged computationally).
- A **three-pass internal adversarial review** (red-team / crypto-audit / skeptic) with the one Critical
  and the verification-UX Medium fixed.

The README (×3) and the in-app Chat info panel now state the honest, accurate scope:

> **Formally verified internally** — symbolic (ProVerif) + computational (CryptoVerif) — and internally
> adversarially reviewed. **Not** independently audited and **not** FIPS-validated; those two external
> gates remain outstanding.

The chat's **EXPERIMENTAL banner stays off** — its removal (back at v3.13.2) is supported by the
reproduced proofs, not contradicted by them. The only outstanding gates are external (independent audit +
FIPS), and the wording now says exactly that, claiming neither reserved phrase.

## Verify the download (unsigned)

```powershell
Get-FileHash .\GhostIntel98-Setup-3.14.2.exe -Algorithm SHA256
```

SHA-256: `df41b8a202d32605927d008d8914b1b1991d4e84843ed3f93fdf3a9bff54b3d4`
Size: 532748804 bytes (508.1 MB)

Unsigned — Windows SmartScreen will warn: **More info → Run anyway**. Installs per-user (no admin) and
upgrades any prior `Ghost Intel 98` build in place.

## Notes
- 1071 tests green; typecheck clean. The only code change is the in-app Chat info-panel text.
- Same `Ghost Intel 98` app id, so it upgrades in place.
- Supersedes v3.14.1, whose wording under-stated the proof state.
