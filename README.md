# Ghost Access 98

A Windows 98–inspired case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

Ghost Access 98 looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management tool that happens to wear a retro shell.

## Status

**v3.0.0** — major consolidated release. Adds optional **encrypt-at-rest login**, an in-app
**document viewer**, a cross-case **entity registry**, **bio photos**, an auto-emitting
**timeline**, **PDF/HTML/CSV exports**, cross-case **search**, a **whiteboard** canvas,
**Telnet + FTP** in DialTerm, **backup/restore** + single-case sharing, and an image wallpaper —
plus the Net Explorer fix. The encrypt-at-rest subsystem went through three rounds of internal
adversarial review and a headless runtime smoke test (0 Critical / 0 High; 75 automated tests
green). See [What's new in v3.0.0](#whats-new-in-v300) below, [`SECURITY.md`](SECURITY.md) for
the security model, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map, and
[`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) for how the build is reviewed.

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/ghost-access-98/releases) and run it.

Direct link to current release: [`GhostAccess98-Setup-3.0.0.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-access-98/releases/download/v3.0.0/GhostAccess98-Setup-3.0.0.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the
release notes:

```powershell
Get-FileHash .\GhostAccess98-Setup-3.0.0.exe -Algorithm SHA256
# expected: 80c0bc98897eb384f13ad69cae817077fa093e568c5fa30795a1e0ae330bbe0c
```

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Ghost Access 98 → Uninstall.

## What's new in v3.0.0

- **Encrypt-at-rest login.** Optionally lock the app behind a master password and encrypt all
  case data on disk (AES-256-GCM; scrypt-wrapped data key; one-time recovery key). Enable or
  disable it any time from **Settings → Security**; enabling encrypts your existing data in
  place, disabling decrypts it back. Minimum 12-character password with a strength meter. See
  [`SECURITY.md`](SECURITY.md).
- **Internal document viewer.** Open attachments in-app — PDF, DOCX, HTML, images (zoom/pan),
  CSV (filterable table), JSON, EML, and text. HTML/DOCX are sanitized and remote resources
  neutralized, so nothing beacons out.
- **Cross-case entities.** A global registry (people, aliases, emails, phones, domains, IPs,
  orgs, social profiles, vehicles, locations, crypto wallets, …) linked to cases under
  Family / Associates / Other, with merge/dedupe and corpus-wide query.
- **Bio photos**, **auto-timeline** (activity recorded automatically, with a type filter),
  **exports** (PDF/HTML summary + CSV for timeline/links/entities/attachments), and
  **global search** across metadata, entities, and extracted attachment text.
- **Whiteboard** canvas (draggable text/image/file/link nodes + connectors, per case).
- **DialTerm gains Telnet + FTP** alongside SSH; **backup/restore** a whole workspace to a
  `.ga98` file and share a single case as a `.ga98case` bundle; **image wallpaper**.
- **Net Explorer fix** — the in-app browser loads and navigates again.

## Modules

| Module | Purpose |
|---|---|
| Case Files | Create, open, rename, archive, delete cases; per-case dashboard with timeline / tasks / links / reminders / attachments / **entities (Family/Associates/Other)** / **bio photos**; **document viewer**, **exports** (PDF/HTML/CSV), and **backup/share** |
| Doc Viewer | In-app viewer for case attachments — PDF, DOCX, HTML, images, CSV, JSON, EML, text (sanitized; no remote fetches) |
| Search | Cross-case search over metadata, entities, and extracted attachment text; exportable results |
| Whiteboard | Per-case pannable/zoomable canvas — text/image/file/link nodes + connectors |
| Notepad 98 | Plain text editor, saves notes into a case |
| Calendar | Month grid surfacing case + global reminders and task due dates |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, image/colour wallpaper, default case folder, Access shortcut editor, AI / Mail / Browser providers, and **Security** (enable/disable login, change password, lock now, recovery key) |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | Internal browser (`<webview>`); save URLs to a case |
| Mail | IMAP/SMTP client (imapflow + nodemailer), encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH / **Telnet** / **FTP** client (ssh2 + xterm.js; raw Telnet; two-pane FTP file client) with 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest; plaintext-protocol warnings |
| EyeSpy | Authorised camera streams — manual URL entry only (HLS / MJPEG / HTTP refresh; RTSP requires a local ffmpeg→HLS bridge). **No discovery / scanning / brute-force code paths exist.** |
| AI Assistant | Pluggable Ollama (local) / OpenAI-compatible providers; case context is opt-in per message; API keys encrypted at rest |

## Build from source

You only need this section if you want to modify the code or build the installer yourself. For just running the app, use the installer link above.

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for icon work)

### Setup

```bash
git clone https://github.com/Obsidian-Circuit-LLC/ghost-access-98.git
cd ghost-access-98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:onna-bugeisha-dev-team/ghost-access-98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Ghost Access 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder. Locations:

- Windows: `%APPDATA%\ghost-access-98\GhostAccess98\`
- macOS: `~/Library/Application Support/ghost-access-98/GhostAccess98/`
- Linux: `~/.config/ghost-access-98/GhostAccess98/`

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case — each with its attachments, notes, bio-images, entity links, whiteboard, and timeline), a global `entities.json` registry, `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

When **login is enabled**, an `auth.json` appears (the scrypt-wrapped data key and recovery wrap — safe in the clear) and every case-data file on disk becomes AES-256-GCM ciphertext (prefixed with a `GA98ENC1` magic header). `settings.json` stays plaintext so the lock screen can render your theme/wallpaper before you unlock. Deleting the whole `GhostAccess98/` folder resets all state; if login was enabled, that also discards the encrypted data permanently (there is no key escrow).

## Debugging and smoke testing

- **Open DevTools** in the installed app: `Ctrl + Shift + I` or `F12`. Use the Console tab to see renderer errors and the Network tab to confirm there's no unexpected egress.
- **App data folder**: `%APPDATA%\ghost-access-98\GhostAccess98\` (see [Data location](#data-location) below). Delete the folder to reset all state and re-trigger the first-run Welcome flow.
- **Crash on launch?** Run `GhostAccess98-Setup-3.0.0.exe` again to repair; if that fails, capture `%APPDATA%\ghost-access-98\` contents and file an issue.
- **Reset just the Welcome flow** without nuking your data: edit `settings.json` and set `"hasSeenWelcome": false`.
- **Smoke-test checklist** for v3.0.0 — exercise: create a case, drag a file onto the attachments pane and **View** it in the doc viewer, add an **entity** and tag it Family/Associate, add a **bio photo**, open Notepad and save a note into the case, set a reminder for one minute from now and confirm the notification fires, open Net Explorer and load https://example.com (add a bookmark, open it in a second tab), drag-create a Calendar event, **export** the case to PDF, run a **search**, open the **Whiteboard**, then **Settings → Security → Enable login** (save the recovery key), **Lock now**, unlock, and confirm your data is intact. Round-trip a **Backup/Restore**. The AI Assistant, Mail, and DialTerm (SSH/Telnet/FTP) modules need user-provided credentials or hosts; EyeSpy needs a stream URL.
- **Encryption sanity check (Windows):** after enabling login, the per-case files under `%APPDATA%\ghost-access-98\GhostAccess98\cases\` should begin with the bytes `GA98ENC1` (open one in a hex viewer); `settings.json` stays readable. Disabling login should return them to plaintext JSON.

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action (open a URL in Net Explorer, fetch mail, connect SSH/Telnet/FTP, send an AI request, attach a camera stream).
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.
- **Optional encrypt-at-rest** (v3.0.0): enable login to encrypt all case data with AES-256-GCM behind a master password. See [`SECURITY.md`](SECURITY.md) for the full model, the backup trust boundary, and how to report a vulnerability.

## License

[MIT](LICENSE) — © 2026 Obsidian Circuit.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- All audio assets are synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
