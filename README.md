# Ghost Access 98

A Windows 98–inspired case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

Ghost Access 98 looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management tool that happens to wear a retro shell.

## Status

**v2.0.1** — all twelve modules implemented; v2.0 UX pass (multi-tab Net Explorer with bookmarks + history, Mail attachments + drafts, Calendar drag-create, DialTerm clipboard, Cases sort, Welcome flow + Help) shipped; five-round adversarial security audit closed (0 Critical / 0 High remaining). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map and [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) for how the build is reviewed.

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Dezirae-Stark/ghost-access-98/releases) and run it.

Direct link to current release: [`GhostAccess98-Setup-2.0.1.exe`](https://github.com/Dezirae-Stark/ghost-access-98/releases/download/v2.0.1/GhostAccess98-Setup-2.0.1.exe).

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Ghost Access 98 → Uninstall.

## Modules

| Module | Purpose |
|---|---|
| Case Files | Create, open, rename, archive, delete cases; per-case dashboard with timeline / tasks / links / reminders / attachments |
| Notepad 98 | Plain text editor, saves notes into a case |
| Calendar | Month grid surfacing case + global reminders and task due dates |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, default case folder, Access shortcut editor, AI / Mail / Browser providers |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | Internal browser (`<webview>`); save URLs to a case |
| Mail | IMAP/SMTP client (imapflow + nodemailer), encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH client (ssh2 + xterm.js) with 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest |
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
git clone https://github.com/Dezirae-Stark/ghost-access-98.git
cd ghost-access-98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:Dezirae-Stark/ghost-access-98.git` also works. The HTTPS form above requires no key setup.

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

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case), `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

## Debugging and smoke testing

- **Open DevTools** in the installed app: `Ctrl + Shift + I` or `F12`. Use the Console tab to see renderer errors and the Network tab to confirm there's no unexpected egress.
- **App data folder**: `%APPDATA%\ghost-access-98\GhostAccess98\` (see [Data location](#data-location) below). Delete the folder to reset all state and re-trigger the first-run Welcome flow.
- **Crash on launch?** Run `GhostAccess98-Setup-2.0.1.exe` again to repair; if that fails, capture `%APPDATA%\ghost-access-98\` contents and file an issue.
- **Reset just the Welcome flow** without nuking your data: edit `settings.json` and set `"hasSeenWelcome": false`.
- **Smoke-test checklist** for v2.0.1 — exercise: create a case, drag a file onto the attachments pane, open Notepad and save a note into the case, set a reminder for one minute from now and confirm the notification fires, open Net Explorer and load https://example.com (then add a bookmark, open it in a second tab), open Calendar and drag-create an event, open Settings and toggle sound, open Shred and confirm a deleted case appears + restores cleanly. The AI Assistant, Mail, DialTerm, and EyeSpy modules need user-provided credentials or stream URLs to exercise — without those, just confirm their windows open and the Settings → Accounts pages accept input.

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action (open a URL in Net Explorer, fetch mail, send an AI request, attach a camera stream).
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.

## License

[MIT](LICENSE) — © 2026 Desirae Stark.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- All audio assets are synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
