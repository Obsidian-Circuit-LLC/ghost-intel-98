# Security

Ghost Intel 98 (formerly Ghost Access 98) is built and maintained by Obsidian Circuit. It is an offline-first,
local-only desktop tool: no telemetry, no analytics, no background phone-home, and no network
egress except actions you explicitly take (opening a link, connecting Mail/SSH/FTP, or an
opt-in remote AI endpoint).

## Reporting a vulnerability

Please report security issues **privately** to the maintainer rather than opening a public
issue, so a fix can ship before details are public. Include a description, affected version,
and a reproduction if you have one.

## v3.0.0 security advisory

v3.0.0 adds optional **encrypt-at-rest**: a master password gates the app and encrypts all
case data on disk (AES-256-GCM with a random data key, wrapped by a scrypt-derived
key-encryption key and a one-time recovery key).

As part of bringing this subsystem to release quality it went through multiple rounds of
internal adversarial review and a runtime smoke test. That review hardened the
enable/disable migration, the encrypted read/write paths, error reporting on encrypted reads,
credential storage on systems without a hardware-backed OS keyring, and the master-password
policy.

**Recommendation:** users on earlier versions should upgrade to v3.0.0, enable login, and
choose a strong master password (minimum 12 characters; a long passphrase is best). Earlier
versions do not encrypt case data at rest at all.

## At-rest model (summary)

- **Data:** AES-256-GCM per file, random 256-bit data key (DEK) held in memory only while
  unlocked.
- **Key wrapping:** DEK wrapped by the master password (scrypt, N=2¹⁷) and, independently, by a
  one-time recovery key shown once at setup. There is no password reset.
- **Credentials** (`secrets.enc`, Mail/SSH/AI): protected by the OS keyring (DPAPI on Windows,
  Keychain on macOS, libsecret/KWallet on Linux). On a Linux system with no real keyring, the
  vault's encryption layer is additionally applied when login is enabled.
- **Backups:** a full `.ga98` backup of an encrypted workspace stays encrypted and is portable
  with the master password — so its confidentiality reduces to password strength. A shared
  single-case `.ga98case` bundle is plaintext by design (the recipient holds a different key);
  send it over a confidential channel.

## Distribution integrity

Release installers are currently **unsigned** (no code-signing certificate), so Windows
SmartScreen will warn on first run. Always verify the published **SHA-256** of the installer
against the value in the release notes before running it.
