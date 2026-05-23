# Ghost Access 98

A Windows 98–inspired case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

Ghost Access 98 looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management tool that happens to wear a retro shell.

## Status

Pre-MVP scaffolding. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map and [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) for how the build is reviewed.

## Modules

| Module | MVP | Purpose |
|---|---|---|
| Case Files | Yes | Create, open, rename, archive, delete cases |
| Notepad 98 | Yes | Plain text editor, saves into cases |
| Calendar | Yes | Month/week/day, surfaces reminders + case deadlines |
| Reminders / Alarm | Yes | Case-linked reminders + general alarms with notifications + sounds |
| Shred | Yes | Soft-delete bucket — restore or purge |
| Settings | Yes | Sound, theme intensity, startup sound, default case folder, providers |
| Access Menu | Yes | Editable program + web-link shortcuts |
| Net Explorer | Post-MVP | Internal browser (`<webview>`), save URLs to a case |
| Mail | Post-MVP | IMAP/SMTP client with synthesized "You have mail" alert |
| DialTerm | Post-MVP | SSH client with 90s dial-up handshake animation |
| EyeSpy | Post-MVP | Authorised camera streams (RTSP/MJPEG/HLS); no discovery, no brute force |
| AI Assistant | Post-MVP | Pluggable Ollama / OpenAI-compatible providers; case-scoped only |

## Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for code-signing/icon work)

## Setup

```bash
git clone git@github.com:onna-bugeisha-dev-team/ghost-access-98.git
cd ghost-access-98
pnpm install
```

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

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action (open a URL in Net Explorer, fetch mail, send an AI request, attach a camera stream).
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.

## License

[MIT](LICENSE) — © 2026 Obsidian Circuit.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- All audio assets are synthesized at runtime via the Web Audio API. No copyrighted Windows or AOL sound assets are bundled.
