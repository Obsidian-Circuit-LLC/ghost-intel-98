# Ghost Access 98 — v3.0.0

A major, consolidated release. Everything below is offline-first and local-only — no telemetry, no analytics, no network egress except where you explicitly act (opening a link, connecting Mail/SSH, an opt-in remote AI endpoint).

## Headline: encrypt-at-rest login

Ghost Access 98 can now lock behind a master password and **encrypt all case data at rest**.

- **Crypto:** a random 256-bit data key (DEK) encrypts every case file with AES-256-GCM. The DEK is wrapped by your master password (scrypt, N=2¹⁷) and, separately, by a one-time **recovery key** shown once at setup — the only way back in if you forget the password. There is no password reset.
- **Transparent:** when unlocked, the app behaves exactly as before; files are encrypted on write and decrypted on read through a single audited IO layer. The DEK lives in memory only while unlocked.
- **Enable / disable safely:** turning login on encrypts your existing data in place; turning it off decrypts it back. Both migrations are crash-resilient — an interrupted enable resumes automatically on your next unlock, and disable refuses to finish if any file can't be decrypted (so nothing is ever stranded).
- **Password policy:** minimum 12 characters with an inline strength meter. A backup file carries your encrypted key, so its safety comes down to your password — a long passphrase is strongly recommended.

## New features

- **Internal document viewer** — open attachments in-app: PDF, DOCX, HTML, images (zoom/pan), CSV (filterable table), JSON, EML email, and text. HTML/DOCX are sanitized; remote resources are neutralized so nothing beacons out.
- **Cross-case entities** — a global registry of people, aliases, emails, phones, domains, IPs, orgs, social profiles, vehicles, locations, crypto wallets, and more. Link entities to cases under Family / Associates / Other, merge duplicates, and query across your whole corpus.
- **Bio / profile photos** — per-case image gallery with thumbnails and a primary photo shown in the case list. EXIF metadata (including GPS) is read and kept behind a "Show location" toggle.
- **Auto-timeline** — case activity (updates, renames, files, notes, links, entities, photos) is recorded to the timeline automatically, with an event-type filter.
- **Exports** — case summary to **PDF** and **HTML**, plus **CSV** for timeline / links / entities / attachments (RFC-4180 quoting with spreadsheet formula-injection guards).
- **Global search** — search across case metadata, entities, and extracted attachment text; export the results.
- **Digital whiteboard** — a pannable/zoomable canvas with draggable text/image/file/link nodes and connectors, saved per case.
- **DialTerm: Telnet + FTP** — alongside SSH: raw Telnet to the in-app terminal and a two-pane FTP file client (list / get / put), with plaintext-protocol warnings.
- **Backup / Restore** — save your whole workspace to a portable `.ga98` file and restore it. Share a single case as a `.ga98case` bundle (plaintext by design — send it over a confidential channel; it re-encrypts under the recipient's vault on import).
- **Image wallpaper** — set a desktop background image, not just a color.
- **Net Explorer fix** — the in-app browser loads and navigates again.

## Upgrading from v2.x

- Your existing case data is read as-is — no manual migration, no data loss. New fields are additive and default safely.
- Login is **off** by default. Enabling it encrypts your data in place (this can take a moment on large workspaces) and shows your recovery key **once** — save it.
- **Backups:** a full `.ga98` backup of an encrypted workspace stays encrypted and is portable to another machine *with your password*. Stored credentials (`secrets.enc`) remain OS-keyring-bound (Windows DPAPI) and must be re-entered after moving machines.

## Security & verification

This release went through three internal red-team rounds against the encrypt-at-rest surface (silent-failure analysis + an adversarial crypto/storage audit) plus a headless runtime smoke test. Every Critical and High finding was fixed and locked behind a regression test; the suite is **75 tests, all green**, with a clean typecheck, build, and headless boot.

Documented, accepted limitations (not defects at single-user scale): the GCM nonce is random per write under one key (safe far below realistic write volumes), and there is no unlock rate-limit beyond scrypt's per-attempt cost. On Linux systems without a real OS keyring, stored credentials now receive the vault's encryption layer too.

## Known limitations

- Final Windows-specific validation (SmartScreen reputation, native dialogs/fonts, the DPAPI keyring round-trip) is expected on real Windows; the build is verified on Linux/headless here.
- The installer is unsigned; Windows SmartScreen may warn on first run.

---

**Artifact:** `GhostAccess98-Setup-3.0.0.exe` (~118 MB, NSIS, x64, unsigned)
**SHA-256:** `80c0bc98897eb384f13ad69cae817077fa093e568c5fa30795a1e0ae330bbe0c`
