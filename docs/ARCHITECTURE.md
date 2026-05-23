# Ghost Access 98 — Architecture

## Process model

Electron three-process layout, context isolation **on**, `nodeIntegration` **off** in the renderer.

```
┌───────────────────────┐    ipc / contextBridge    ┌───────────────────────┐
│   Main process        │ ◄───────────────────────► │  Renderer (React)     │
│  src/main/            │                           │  src/renderer/        │
│  - app lifecycle      │     ┌──────────────┐      │  - Win98 shell        │
│  - file I/O           │     │   Preload    │      │  - modules            │
│  - storage abstraction│ ───►│ src/preload/ │ ───► │  - Web Audio synth    │
│  - safeStorage        │     └──────────────┘      │                       │
│  - notifications      │                           │                       │
└───────────────────────┘                           └───────────────────────┘
```

The preload script defines the **only** API surface the renderer sees. It exposes typed methods via `contextBridge.exposeInMainWorld('api', …)`. Every IPC channel has a contract in `src/shared/ipc-contracts.ts`.

## Module map

```
src/
├── main/                    # privileged process
│   ├── index.ts             # app + BrowserWindow lifecycle
│   ├── ipc/                 # one file per domain (cases, files, settings, reminders, …)
│   ├── storage/             # abstraction over persistence (swap JSON → SQLite later)
│   │   ├── interface.ts     # CaseStore, FileStore, SettingsStore, SecretStore
│   │   ├── json-fs.ts       # MVP implementation
│   │   └── paths.ts         # resolves all user-data paths
│   ├── secrets/             # safeStorage wrapper
│   └── notifications/       # Electron Notification helpers
├── preload/
│   ├── index.ts             # contextBridge surface
│   └── api.d.ts             # typed window.api declaration
├── renderer/
│   ├── App.tsx              # mounts Desktop + Taskbar
│   ├── shell/               # Desktop, Taskbar, AccessMenu, Window, Icon
│   ├── modules/             # one folder per program (cases, notepad, calendar, …)
│   ├── styles/              # 98.css overrides + theme
│   └── audio/synth.ts       # generated 90s-style sounds (Web Audio)
└── shared/
    ├── types.ts             # Case, Reminder, Task, Settings, …
    └── ipc-contracts.ts     # channel names + payload types
```

## On-disk layout

App data root resolves to `app.getPath('userData') / GhostAccess98 /` so paths are never hard-coded.

```
GhostAccess98/
├── settings.json
├── cases/
│   └── <caseId>/
│       ├── case.json            # metadata
│       ├── notes/               # Notepad 98 saved notes
│       ├── attachments/         # dropped files; each has a .meta.json sidecar
│       ├── links.json           # web links saved from Net Explorer
│       ├── timeline.json
│       ├── tasks.json
│       ├── reminders.json
│       └── streams.json         # EyeSpy URLs attached to this case
├── reminders.global.json
├── alarms.json
├── shred/                       # soft-deleted items — restorable until purge
└── secrets.enc                  # safeStorage-encrypted JSON blob
```

### Attachment metadata sidecar (`<filename>.meta.json`)

```json
{
  "originalName": "evidence-001.pdf",
  "importedAt": "2026-05-24T12:00:00.000Z",
  "size": 184320,
  "sourcePath": "C:\\Users\\…\\Downloads\\evidence-001.pdf",
  "sha256": "…"
}
```

## Storage abstraction

```ts
// src/main/storage/interface.ts
export interface CaseStore {
  list(): Promise<CaseSummary[]>;
  create(input: CreateCaseInput): Promise<Case>;
  read(id: CaseId): Promise<Case>;
  rename(id: CaseId, title: string): Promise<void>;
  archive(id: CaseId): Promise<void>;
  delete(id: CaseId): Promise<void>;          // moves to shred/
  purge(id: CaseId): Promise<void>;           // permanent
  restore(id: CaseId): Promise<void>;
}
```

`json-fs.ts` is the MVP implementation. A future `sqlite.ts` implements the same interface; everything above the storage layer is unchanged.

## IPC contracts

Channels live in `src/shared/ipc-contracts.ts`:

```ts
export const channels = {
  cases: { list: 'cases:list', create: 'cases:create', read: 'cases:read', ... },
  files: { drop: 'files:drop', list: 'files:list' },
  settings: { read: 'settings:read', update: 'settings:update' },
  reminders: { list: 'reminders:list', create: 'reminders:create', ... },
} as const;
```

The preload exposes one typed function per channel. The renderer imports `window.api.cases.list()` and never touches `ipcRenderer` directly.

## Security invariants

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where compatible
- Renderer has zero filesystem access — it must go through the preload + IPC
- All secrets via Electron `safeStorage`; never plaintext, never in the renderer
- No remote code loaded into the renderer (no CDN scripts; everything is bundled)
- `<webview>` (Net Explorer) runs in a separate process with its own session
- DialTerm host secrets and Mail credentials never reach the renderer in plaintext — only the final stream contents do

## Network behaviour

- No background traffic, no telemetry, no analytics
- Every outbound request is the result of an explicit user action
- The no-egress smoke test (boot offline, exercise every MVP feature, none must fail) gates each MVP release tag

## Sound

`src/renderer/audio/synth.ts` synthesizes all sounds via the Web Audio API — square / triangle / sawtooth oscillators with short ADSR envelopes — so we ship zero copyrighted assets. The DialTerm dial-up handshake is layered tone bursts; the "You have mail" alert is a two-note arpeggio; the reminder chime is a single triangle pluck.
