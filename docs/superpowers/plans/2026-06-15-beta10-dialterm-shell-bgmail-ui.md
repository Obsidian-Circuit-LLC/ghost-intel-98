# DCS98 v3.14.0-beta.10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship GhostExodus's beta.9 field feedback — persist+default-collapse My Cases categories, two-row Share/Import toolbar, move four desktop icons to the programs menu, a DialTerm local shell (opt-in, fail-safe), custom host ports, a fixed new-mail chime, and an opt-in background mail poller with chime + Win98 toast.

**Architecture:** Renderer (React/zustand) + main (Electron) over a validated IPC contract. New code mirrors existing patterns: `shell.ts` mirrors `ssh.ts`; `mail-poller.ts` is a main-process service emitting an IPC event consumed by the always-mounted shell; settings additions ride the existing `AppSettings` + `defaultSettings` + `useSettings.patch` plumbing.

**Tech Stack:** TypeScript, React, zustand, Electron, xterm.js, `node-pty` (new, lazy + fail-safe), vitest.

Spec: `docs/superpowers/specs/2026-06-15-beta10-dialterm-shell-bgmail-ui-design.md`

**Conventions for this branch (match existing repo behavior):**
- Branch off `main`: `feat/beta10-shell-bgmail-ui`.
- Run `pnpm typecheck` and `pnpm test` after each task; both must be green before commit.
- Do NOT use `--no-verify`; let the pre-commit hook run.
- Feature commits use no `Co-Authored-By` trailer (matches existing plan-driven commits).
- `pnpm test <file>` runs a single suite (vitest).

---

## Workstream A — My Cases categories: persist + default collapsed

### Task A1: Add persisted collapse setting + resolver

**Files:**
- Modify: `src/shared/types.ts` (AppSettings interface + `defaultSettings`)
- Create: `src/renderer/modules/cases/collapse.ts`
- Test: `test/cases-collapse.test.ts`
- Modify: `src/renderer/modules/cases/CasesModule.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/cases-collapse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveCollapsed, toggleCollapsed } from '../src/renderer/modules/cases/collapse';

describe('resolveCollapsed', () => {
  it('defaults an unknown category to collapsed', () => {
    expect(resolveCollapsed({}, 'Investigations')).toBe(true);
  });
  it('honors an explicit expanded (false) entry', () => {
    expect(resolveCollapsed({ Investigations: false }, 'Investigations')).toBe(false);
  });
  it('honors an explicit collapsed (true) entry', () => {
    expect(resolveCollapsed({ Investigations: true }, 'Investigations')).toBe(true);
  });
});

describe('toggleCollapsed', () => {
  it('flips an unknown (collapsed) category to expanded explicitly', () => {
    expect(toggleCollapsed({}, 'Field Ops')).toEqual({ 'Field Ops': false });
  });
  it('flips an expanded category back to collapsed', () => {
    expect(toggleCollapsed({ 'Field Ops': false }, 'Field Ops')).toEqual({ 'Field Ops': true });
  });
  it('does not mutate the input map', () => {
    const input = { A: false };
    toggleCollapsed(input, 'A');
    expect(input).toEqual({ A: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test cases-collapse`
Expected: FAIL — `Cannot find module '.../cases/collapse'`.

- [ ] **Step 3: Implement the resolver**

Create `src/renderer/modules/cases/collapse.ts`:

```ts
/**
 * Per-category collapse state for the My Cases sidebar, persisted in
 * AppSettings.caseCategoryCollapsed. An ABSENT category key resolves to
 * collapsed (true) — fresh profiles and newly created categories start closed
 * ("closed by default"); an explicit `false` means the user expanded it.
 */
export type CollapseMap = Record<string, boolean>;

export function resolveCollapsed(map: CollapseMap, name: string): boolean {
  return map[name] ?? true;
}

/** Returns a NEW map with `name` flipped relative to its resolved state. */
export function toggleCollapsed(map: CollapseMap, name: string): CollapseMap {
  return { ...map, [name]: !resolveCollapsed(map, name) };
}
```

- [ ] **Step 4: Add the setting field + default**

In `src/shared/types.ts`, add to the `AppSettings` interface (next to `caseSortBy`/`caseSortDir`):

```ts
  /** Per-category collapse state for the My Cases sidebar, keyed by category name.
   *  Absent key = collapsed (closed by default). */
  caseCategoryCollapsed: Record<string, boolean>;
```

And in `defaultSettings` (the object beginning at `src/shared/types.ts:501`), add after `caseSortDir: 'desc',`:

```ts
  caseCategoryCollapsed: {},
```

- [ ] **Step 5: Wire CasesModule to read/persist**

In `src/renderer/modules/cases/CasesModule.tsx`:

1. Add the import near the other local imports:
```ts
import { resolveCollapsed, toggleCollapsed } from './collapse';
```

2. Remove the local collapse `useState` at line 60 (`const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})`) and the comment above it. Replace with a settings-backed read (place near the existing `sortBy`/`sortDir`/`patchSettings` selectors around line 81-83):
```ts
const collapsed = useSettings((s) => s.settings?.caseCategoryCollapsed ?? {});
```
(`patchSettings` already exists at line 83.)

3. Replace the header `onClick` at line 265:
```ts
onClick={() => void patchSettings({ caseCategoryCollapsed: toggleCollapsed(collapsed, g.name) })}
```

4. Replace the `isCollapsed` derivation at line 261:
```ts
const isCollapsed = resolveCollapsed(collapsed, g.name);
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test cases-collapse && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/modules/cases/collapse.ts src/renderer/modules/cases/CasesModule.tsx test/cases-collapse.test.ts
git commit -m "feat(cases): persist category collapse state, default collapsed"
```

---

## Workstream B — Share/Import button layout

### Task B1: Two-row case toolbar

**Files:**
- Modify: `src/renderer/modules/cases/CasesModule.tsx:215-230`

- [ ] **Step 1: Split the toolbar into two rows**

Replace the single button row (`<div style={{ display: 'flex', gap: 4 }}>` … `</div>` spanning lines 215-230) with two rows. Row 1 = New/Rename/Delete; Row 2 = Share/Import. Keep every existing handler and `disabled`/`title` attribute verbatim — only the wrapping `<div>` structure changes:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
  <div style={{ display: 'flex', gap: 4 }}>
    <button onClick={() => void createCase()} title="Ctrl/Cmd+N">New</button>
    <button disabled={!selectedId} onClick={() => void renameSelected()}>Rename</button>
    <button disabled={!selectedId} onClick={() => void deleteSelected()}>Delete</button>
  </div>
  <div style={{ display: 'flex', gap: 4 }}>
    <button disabled={!selectedId} title="Save this case as a shareable .ghost file to send to another Dead Cyber Society 98 user" onClick={async () => {
      if (!selectedId) return;
      try { const saved = await window.api.cases.exportBundle(selectedId); if (saved) toast.success(`Saved shareable case: ${saved}`); }
      catch (err) { toast.error(`Share failed: ${(err as Error).message}`); }
    }}>Share…</button>
    <button title="Open a .ghost case file shared by another Dead Cyber Society 98 user" onClick={async () => {
      try {
        const r = await window.api.cases.importBundle();
        if (r) { await refreshList(); setSelectedId(r.caseId); toast.success('Shared case imported.'); }
      } catch (err) { toast.error(`Import failed: ${(err as Error).message}`); }
    }}>Import…</button>
  </div>
</div>
```

- [ ] **Step 2: Verify typecheck + manual note**

Run: `pnpm typecheck`
Expected: clean. (Layout fidelity — no horizontal scrollbar, Share/Import visible — is a manual check in a built run; no unit test for pure CSS layout.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/cases/CasesModule.tsx
git commit -m "feat(cases): stack Share/Import beneath New/Rename to remove sidebar h-scroll"
```

---

## Workstream C — Desktop icons → programs menu

### Task C1: Move journal/markets/geoint/jukebox off the desktop

**Files:**
- Modify: `src/renderer/shell/Desktop.tsx:14-26`
- Modify: `src/shared/types.ts` (`defaultShortcuts:437`, `REQUIRED_MODULE_SHORTCUTS:465`)
- Test: `test/shortcuts-reconcile.test.ts` (extend if it exists, else create)

- [ ] **Step 1: Write the failing test**

Create or extend `test/shortcuts-reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileShortcuts, defaultShortcuts } from '../src/shared/types';

describe('reconcileShortcuts — journal + markets seeding (beta.10)', () => {
  it('seeds journal and markets into an install that lacks them', () => {
    const existing = defaultShortcuts.filter((s) => s.target !== 'journal' && s.target !== 'markets');
    const { shortcuts, seededShortcuts } = reconcileShortcuts(existing, []);
    expect(shortcuts.some((s) => s.target === 'journal')).toBe(true);
    expect(shortcuts.some((s) => s.target === 'markets')).toBe(true);
    expect(seededShortcuts).toContain('journal');
    expect(seededShortcuts).toContain('markets');
  });

  it('respects a user who deleted journal after it was seeded', () => {
    const withoutJournal = defaultShortcuts.filter((s) => s.target !== 'journal');
    const { shortcuts } = reconcileShortcuts(withoutJournal, ['journal']);
    expect(shortcuts.some((s) => s.target === 'journal')).toBe(false);
  });

  it('fresh defaults already include journal and markets', () => {
    expect(defaultShortcuts.some((s) => s.target === 'journal')).toBe(true);
    expect(defaultShortcuts.some((s) => s.target === 'markets')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test shortcuts-reconcile`
Expected: FAIL — journal/markets not in `defaultShortcuts`/`REQUIRED_MODULE_SHORTCUTS`.

- [ ] **Step 3: Remove the four desktop icons**

In `src/renderer/shell/Desktop.tsx`, edit `desktopShortcutDefaults` (lines 14-26) to remove `journal`, `media-player`, `geoint`, and `markets`. Resulting array:

```ts
const desktopShortcutDefaults: { module: ModuleKey; label: string }[] = [
  { module: 'cases', label: 'My Cases' },
  { module: 'notepad', label: 'Notepad 98' },
  { module: 'briefcase', label: 'Briefcase' },
  { module: 'bookmarks', label: 'Bookmarks' },
  { module: 'calendar', label: 'Calendar' },
  { module: 'reminders', label: 'Reminders' },
  { module: 'chat', label: 'Chat (beta)' }
];
```

- [ ] **Step 4: Seed journal + markets into the programs menu**

In `src/shared/types.ts`:

1. In `defaultShortcuts` (line 437), add `journal` and `markets` entries (place `journal` after `briefcase`, `markets` after `bookmarks`, mirroring the desktop order). Use existing icon names — verify against the icon set in `src/renderer/shell/Icon.tsx`; if `journal`/`chart` glyph names are absent, reuse `note` for journal and `chart` for markets (the glyph just needs to resolve):
```ts
  { id: 'journal', label: 'Journal Jots', kind: 'module', target: 'journal', icon: 'note' },
  { id: 'markets', label: 'Markets', kind: 'module', target: 'markets', icon: 'chart' },
```

2. In `REQUIRED_MODULE_SHORTCUTS` (line 465), add the same two so existing installs seed them once:
```ts
  { id: 'journal', label: 'Journal Jots', kind: 'module', target: 'journal', icon: 'note' },
  { id: 'markets', label: 'Markets', kind: 'module', target: 'markets', icon: 'chart' },
```

(`geoint` and `media-player` are already in both lists — no change; they simply stop being desktop icons.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test shortcuts-reconcile && pnpm typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/Desktop.tsx src/shared/types.ts test/shortcuts-reconcile.test.ts
git commit -m "feat(shell): move Journal/GeoINT/Markets/Jukebox from desktop to programs menu"
```

---

## Workstream D — DialTerm local shell + custom ports

### Task D1: Settings fields for the local shell

**Files:**
- Modify: `src/shared/types.ts` (AppSettings + defaultSettings)

- [ ] **Step 1: Add the settings fields**

In the `AppSettings` interface add:

```ts
  /** DialTerm local shell — opt-in (default off). When false the main process refuses
   *  shell.connect even if the renderer asks. */
  localShellEnabled: boolean;
  /** Which local shell to spawn when localShellEnabled. Mapped to a fixed executable by
   *  the main process; the renderer never supplies an executable path. */
  localShellProgram: 'cmd' | 'powershell';
```

In `defaultSettings` add:

```ts
  localShellEnabled: false,
  localShellProgram: 'cmd',
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → clean.
```bash
git add src/shared/types.ts
git commit -m "feat(settings): add localShellEnabled + localShellProgram (default off)"
```

---

### Task D2: IPC contract + preload + api types for the shell

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (after the `ssh:` block at line 197-207)
- Modify: `src/preload/index.ts` (after the `ssh:` block at line 211-228)
- Modify: `src/preload/api.d.ts` (after the `ssh:` block at line 281)

- [ ] **Step 1: Add the channel names**

In `src/shared/ipc-contracts.ts`, add a `shell` block mirroring `ssh`:

```ts
  shell: {
    connect: 'shell:connect',
    write: 'shell:write',
    resize: 'shell:resize',
    disconnect: 'shell:disconnect',
    onData: 'shell:onData',
    onClose: 'shell:onClose'
  },
```

- [ ] **Step 2: Add the preload bindings**

In `src/preload/index.ts`, add a `shell` object mirroring `ssh` (note: `connect` takes an optional program token, not a hostId):

```ts
  shell: {
    connect: (program?: 'cmd' | 'powershell') => ipcRenderer.invoke(channels.shell.connect, program),
    write: (sessionId: string, data: string) => ipcRenderer.invoke(channels.shell.write, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke(channels.shell.resize, sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.invoke(channels.shell.disconnect, sessionId),
    onData: (cb: (payload: { sessionId: string; data: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; data: string }) => cb(p);
      ipcRenderer.on(channels.shell.onData, l);
      return () => ipcRenderer.removeListener(channels.shell.onData, l);
    },
    onClose: (cb: (payload: { sessionId: string; reason: string }) => void) => {
      const l = (_e: unknown, p: { sessionId: string; reason: string }) => cb(p);
      ipcRenderer.on(channels.shell.onClose, l);
      return () => ipcRenderer.removeListener(channels.shell.onClose, l);
    }
  },
```

(Match the exact arrow/listener style already used by the `ssh` block at lines 211-228.)

- [ ] **Step 3: Add the api.d.ts types**

In `src/preload/api.d.ts`, add a `shell` block mirroring the `ssh` block's shape (line 281):

```ts
  shell: {
    connect(program?: 'cmd' | 'powershell'): Promise<{ sessionId: string }>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    disconnect(sessionId: string): Promise<void>;
    onData(cb: (payload: { sessionId: string; data: string }) => void): () => void;
    onClose(cb: (payload: { sessionId: string; reason: string }) => void): () => void;
  };
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck` → clean.
```bash
git add src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(ipc): add shell channels (connect/write/resize/disconnect/onData/onClose)"
```

---

### Task D3: Shell-program validator

**Files:**
- Modify: `src/main/security/validate.ts`
- Test: `test/validate-shell.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/validate-shell.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ensureShellProgram } from '../src/main/security/validate';

describe('ensureShellProgram', () => {
  it('accepts cmd', () => expect(ensureShellProgram('cmd')).toBe('cmd'));
  it('accepts powershell', () => expect(ensureShellProgram('powershell')).toBe('powershell'));
  it('falls back to cmd for undefined', () => expect(ensureShellProgram(undefined)).toBe('cmd'));
  it('falls back to cmd for an arbitrary string (no path injection)', () => {
    expect(ensureShellProgram('C:\\\\Windows\\\\System32\\\\evil.exe')).toBe('cmd');
    expect(ensureShellProgram('/bin/sh; rm -rf /')).toBe('cmd');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test validate-shell`
Expected: FAIL — `ensureShellProgram` is not exported.

- [ ] **Step 3: Implement the validator**

In `src/main/security/validate.ts`, add (near `ensureSessionId` at line 279):

```ts
/** The renderer may only pass a shell CHOICE token, never an executable path. Anything
 *  not in the allowlist degrades to 'cmd'. The main process maps the token to a fixed
 *  executable — see services/shell.ts. */
export function ensureShellProgram(v: unknown): 'cmd' | 'powershell' {
  return v === 'powershell' ? 'powershell' : 'cmd';
}
```

- [ ] **Step 4: Run test + commit**

Run: `pnpm test validate-shell && pnpm typecheck` → PASS, clean.
```bash
git add src/main/security/validate.ts test/validate-shell.test.ts
git commit -m "feat(security): add ensureShellProgram allowlist validator"
```

---

### Task D4: Local-shell service (lazy node-pty, gated, session map)

**Files:**
- Create: `src/main/services/shell.ts`
- Test: `test/shell-service.test.ts`

**Design notes for the implementer:**
- `node-pty` is required **lazily inside the connect path**, wrapped in try/catch. NEVER import it at module top level — a missing/ABI-mismatched native binary must degrade to a thrown "Local shell unavailable" error, not crash the app at boot.
- `connect` reads `localShellEnabled` from settings via the existing settings accessor and throws if false. (Use the same settings-read the rest of main uses; see how `mail.ts`/other services read settings — locate the settings getter and call it. If a synchronous getter exists, use it; otherwise read the persisted settings file via the existing storage helper.)
- The shell executable is chosen by main from a fixed map; the renderer's token is passed through `ensureShellProgram`.
- Session map + `onData`/`onClose` send + `shutdownAllShellSessions()` mirror `ssh.ts`.

- [ ] **Step 1: Write the failing test (node-pty mocked)**

Create `test/shell-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-pty with a controllable fake PTY.
const ptyInstances: any[] = [];
vi.mock('node-pty', () => ({
  spawn: vi.fn((file: string, args: string[], opts: any) => {
    const handlers: Record<string, ((arg: any) => void)[]> = { data: [], exit: [] };
    const inst = {
      file, args, opts, written: [] as string[], resized: null as any, killed: false,
      onData: (cb: (d: string) => void) => { handlers.data.push(cb); },
      onExit: (cb: (e: any) => void) => { handlers.exit.push(cb); },
      write: (d: string) => inst.written.push(d),
      resize: (c: number, r: number) => { inst.resized = { c, r }; },
      kill: () => { inst.killed = true; },
      _emitData: (d: string) => handlers.data.forEach((h) => h(d)),
      _emitExit: () => handlers.exit.forEach((h) => h({ exitCode: 0 }))
    };
    ptyInstances.push(inst);
    return inst;
  })
}));

// Mock the settings read used by shell.ts. ADAPT the module path/return to the actual
// settings accessor discovered during implementation.
let shellEnabled = true;
vi.mock('../src/main/storage/settings', () => ({
  readSettings: () => ({ localShellEnabled: shellEnabled, localShellProgram: 'cmd' })
}), { virtual: true });

import * as shellSvc from '../src/main/services/shell';
import { channels } from '../src/shared/ipc-contracts';

function fakeWindow() {
  const sent: { ch: string; payload: any }[] = [];
  return { win: { webContents: { send: (ch: string, payload: any) => sent.push({ ch, payload }) } }, sent };
}

beforeEach(() => { ptyInstances.length = 0; shellEnabled = true; });

describe('shell service', () => {
  it('refuses to connect when localShellEnabled is false', async () => {
    shellEnabled = false;
    await expect(shellSvc.connect('cmd', () => fakeWindow().win as any)).rejects.toThrow();
    expect(ptyInstances.length).toBe(0);
  });

  it('connects, wires data → onData IPC, and returns a sessionId', async () => {
    const { win, sent } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    expect(sessionId).toBeTruthy();
    expect(ptyInstances.length).toBe(1);
    ptyInstances[0]._emitData('hello');
    expect(sent.find((s) => s.ch === channels.shell.onData)?.payload).toEqual({ sessionId, data: 'hello' });
  });

  it('write/resize/disconnect reach the pty', async () => {
    const { win } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    await shellSvc.write(sessionId, 'dir\r');
    expect(ptyInstances[0].written).toContain('dir\r');
    await shellSvc.resize(sessionId, 120, 40);
    expect(ptyInstances[0].resized).toEqual({ c: 120, r: 40 });
    await shellSvc.disconnect(sessionId);
    expect(ptyInstances[0].killed).toBe(true);
  });

  it('pty exit emits onClose and drops the session', async () => {
    const { win, sent } = fakeWindow();
    const { sessionId } = await shellSvc.connect('cmd', () => win as any);
    ptyInstances[0]._emitExit();
    expect(sent.find((s) => s.ch === channels.shell.onClose)?.payload.sessionId).toBe(sessionId);
    await expect(shellSvc.write(sessionId, 'x')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test shell-service`
Expected: FAIL — `src/main/services/shell.ts` does not exist.

> **Implementer note:** before writing, locate the real synchronous settings accessor in `src/main` (grep for how `localShellEnabled`'s neighbors like `caseFolderOverride` or `soundEnabled` are read in main — e.g. a `storage/settings` module or a cached settings singleton). Use that real accessor in `shell.ts` and update the test's `vi.mock` path/return to match it. The mock above is a template; make it mirror the actual module.

- [ ] **Step 3: Implement the service**

Create `src/main/services/shell.ts`:

```ts
/**
 * DialTerm local shell service (ConPTY via node-pty).
 *
 * Security posture:
 *  - node-pty is required LAZILY inside connect(), wrapped in try/catch, so a missing or
 *    ABI-mismatched native binary degrades to a thrown error (surfaced as a toast) rather
 *    than crashing the app at boot.
 *  - connect() refuses unless settings.localShellEnabled is true. This is the authoritative
 *    gate; the renderer hiding the UI is cosmetic.
 *  - The renderer passes only a CHOICE token (cmd|powershell); main maps it to a fixed
 *    executable. The renderer never supplies an executable path.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';
import { ensureShellProgram } from '../security/validate';
import { readSettings } from '../storage/settings'; // ADAPT to the real settings accessor

interface PtyLike {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
interface ShellSession { pty: PtyLike; closed: boolean; }

const sessions = new Map<string, ShellSession>();

/** win32 executable map. On non-win32 (dev) fall back to a POSIX shell so the service is
 *  runnable in development; production target is Windows. */
function resolveExecutable(program: 'cmd' | 'powershell'): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return program === 'powershell'
      ? { file: 'powershell.exe', args: [] }
      : { file: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

function loadPty(): typeof import('node-pty') {
  try {
    // Lazy require — never at module top level.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('node-pty');
  } catch (err) {
    throw new Error('Local shell unavailable: the terminal backend (node-pty) failed to load.');
  }
}

export async function connect(
  programToken: unknown,
  getWindow: () => BrowserWindow | null
): Promise<{ sessionId: string }> {
  const settings = readSettings();
  if (!settings.localShellEnabled) {
    throw new Error('Local shell is disabled. Enable it in Settings → Terminal.');
  }
  const program = ensureShellProgram(programToken ?? settings.localShellProgram);
  const pty = loadPty();
  const { file, args } = resolveExecutable(program);
  const sessionId = `sh-${randomUUID()}`;

  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd: homedir(),
    env: process.env as Record<string, string>
  }) as unknown as PtyLike;

  const session: ShellSession = { pty: proc, closed: false };
  sessions.set(sessionId, session);

  function closeOnce(reason: string): void {
    if (session.closed) return;
    session.closed = true;
    getWindow()?.webContents.send(channels.shell.onClose, { sessionId, reason });
    sessions.delete(sessionId);
    try { proc.kill(); } catch { /* nothing */ }
  }

  proc.onData((data) => {
    getWindow()?.webContents.send(channels.shell.onData, { sessionId, data });
  });
  proc.onExit(() => closeOnce('shell exited'));

  return { sessionId };
}

export async function write(sessionId: string, data: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) throw new Error(`No active shell session: ${sessionId}`);
  s.pty.write(data);
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) return;
  const c = Math.max(1, Math.min(500, Math.floor(cols)));
  const r = Math.max(1, Math.min(300, Math.floor(rows)));
  try { s.pty.resize(c, r); } catch { /* pty may have exited */ }
}

export async function disconnect(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.closed = true;
  try { s.pty.kill(); } catch { /* nothing */ }
  sessions.delete(sessionId);
}

/** Called from main on before-quit alongside shutdownAllSessions() (ssh). */
export async function shutdownAllShellSessions(): Promise<void> {
  for (const [, s] of sessions) {
    s.closed = true;
    try { s.pty.kill(); } catch { /* nothing */ }
  }
  sessions.clear();
}
```

> **Implementer note:** if no `readSettings()`-style synchronous accessor exists in main, add one to the existing settings storage module (a cached read of the persisted settings) rather than threading settings through every call. Keep the gate synchronous and cheap.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test shell-service && pnpm typecheck`
Expected: PASS; clean. (Typecheck may require `@types/node` `require` typing — the lazy `require` is intentional; if eslint/ts complains, keep the `require` and silence narrowly as shown.)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/shell.ts test/shell-service.test.ts
git commit -m "feat(dialterm): local shell service — lazy node-pty, gated, session-managed"
```

---

### Task D5: Wire shell IPC handlers + before-quit shutdown

**Files:**
- Modify: `src/main/ipc/register.ts` (ssh handlers at 867-873; add shell handlers after them)
- Modify: `src/main/index.ts` (before-quit at 341-354; import + call shutdownAllShellSessions)

- [ ] **Step 1: Register the shell IPC handlers**

In `src/main/ipc/register.ts`, import the shell service (next to the `ssh` import at the top) and add handlers after the ssh block (after line 873). Validate via `ensureSessionId` + `ensureShellProgram` (already imported / add to the validate import list):

```ts
  safeHandle(channels.shell.connect, (...args) => shellSvc.connect(args[0], getWindow));
  safeHandle(channels.shell.write, (...args) => shellSvc.write(ensureSessionId(args[0]), args[1] as string));
  safeHandle(channels.shell.resize, (...args) => shellSvc.resize(ensureSessionId(args[0]), args[1] as number, args[2] as number));
  safeHandle(channels.shell.disconnect, (...args) => shellSvc.disconnect(ensureSessionId(args[0])));
```

(Import: `import * as shellSvc from '../services/shell';` and ensure `ensureSessionId`, `ensureShellProgram` are in the `validate` import. `connect` validates the program token inside the service via `ensureShellProgram`.)

- [ ] **Step 2: Drain shell sessions on quit**

In `src/main/index.ts`: add `import { shutdownAllShellSessions } from './services/shell';` next to the ssh import (line 39), and in the before-quit handler (after `await shutdownAllSessions();` at line 354) add:

```ts
    await shutdownAllShellSessions();
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → clean. (Full `pnpm test` should still pass — no behavior change to existing paths.)
```bash
git add src/main/ipc/register.ts src/main/index.ts
git commit -m "feat(dialterm): register shell IPC handlers + drain shell sessions on quit"
```

---

### Task D6: Package node-pty (dependency + unpack + build note)

**Files:**
- Modify: `package.json` (dependencies, `build.asarUnpack`, `postinstall` note)

**Honest constraint:** producing a working Windows Electron-ABI `node-pty` binary from this Linux+Wine box is the known packaging wall. The lazy-load fail-safe (Task D4) means the app is safe without it. This task records the dependency + packaging config; whether the shipped installer carries a working binary is a build-time decision (may be a Windows-host follow-up). CI tests mock node-pty (Task D4), so they pass regardless.

- [ ] **Step 1: Add the dependency**

Add `node-pty` to `dependencies` in `package.json` at a current version (verify latest stable at implementation time). Do NOT remove the `postinstall` line; update its message to acknowledge node-pty is native and may need an Electron rebuild on the build host:

```jsonc
"postinstall": "echo 'native: ssh2 is pure-JS; node-pty is a native addon (lazy-loaded, fail-safe) — needs an Electron-ABI build on the Windows packaging host'"
```

- [ ] **Step 2: Unpack the native binary from the asar**

In the electron-builder `build` config, add a `asarUnpack` glob so the `.node` is extractable at runtime (a native addon cannot be `require`d from inside an asar):

```jsonc
"asarUnpack": [
  "**/node_modules/node-pty/**"
]
```

(If `asarUnpack` already exists, append the glob to its array.)

- [ ] **Step 3: Verify install + typecheck**

Run: `pnpm install` then `pnpm typecheck && pnpm test`.
Expected: install succeeds; if the native build fails on this host, that is the documented packaging wall — the lazy-load path keeps the app and the (mocked) tests green. Note the outcome in the task report (DONE_WITH_CONCERNS if the native binary did not build here).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(dialterm): add node-pty dep + asarUnpack (native, lazy-loaded, fail-safe)"
```

---

### Task D7: DialTerm "Local Shell" UI + Settings → Terminal pane

**Files:**
- Modify: `src/renderer/modules/dialterm/DialTermModule.tsx`
- Modify: `src/renderer/modules/settings/SettingsModule.tsx`

**Design notes:**
- The xterm.js terminal, connect→open→closed state machine, and `ssh.onData`/`onClose` wiring already exist in `DialTermModule.tsx`. Add a "Local Shell" entry to the connection/host selector that, when chosen and `localShellEnabled`, calls `window.api.shell.connect(settings.localShellProgram)` and pipes the same xterm via `window.api.shell.onData`/`onClose`/`write`/`resize` (the shell API mirrors the ssh API exactly, so reuse the same terminal-attach code path, swapping `window.api.ssh.*` → `window.api.shell.*`).
- When `localShellEnabled` is false, show the "Local Shell" option disabled with the hint "Enable in Settings → Terminal."

- [ ] **Step 1: Add a Terminal settings pane**

In `src/renderer/modules/settings/SettingsModule.tsx`, add a `TerminalPane` (mirror `SoundPane` at line 173) and register it in the pane list/nav (follow how `SoundPane`/`ThemePane` are registered):

```tsx
function TerminalPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Terminal</legend>
      <label>
        <input type="checkbox" checked={s.localShellEnabled} onChange={(e) => void patch({ localShellEnabled: e.target.checked })} />
        {' '}Enable local shell in DialTerm (runs local commands with your own privileges)
      </label>
      <br />
      <label>Shell:&nbsp;
        <select className="ga98-text" value={s.localShellProgram} disabled={!s.localShellEnabled}
          onChange={(e) => void patch({ localShellProgram: e.target.value as AppSettings['localShellProgram'] })}>
          <option value="cmd">Command Prompt (cmd.exe)</option>
          <option value="powershell">PowerShell</option>
        </select>
      </label>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        Off by default. The local shell runs on your machine with your account's privileges; it is not
        a remote connection. The terminal backend is loaded only when you open a shell session.
      </p>
    </fieldset>
  );
}
```

- [ ] **Step 2: Add the Local Shell connection path in DialTerm**

In `DialTermModule.tsx`, add a "Local Shell" choice to the connection selector (the `<select>` of hosts around line 242). When selected:
- if `!settings?.localShellEnabled`: show the disabled hint / toast "Enable the local shell in Settings → Terminal" and do not connect;
- else on Dial/connect: `const { sessionId } = await window.api.shell.connect(settings.localShellProgram);` then attach the existing xterm exactly as the ssh path does, but subscribe to `window.api.shell.onData/onClose` and send keystrokes/resize via `window.api.shell.write/resize`.

Factor the terminal-attach logic so the ssh and shell paths share it (both have identical `{onData,onClose,write,resize}` shapes) — pass the chosen API surface as a parameter rather than duplicating the xterm setup.

- [ ] **Step 3: Typecheck + manual note**

Run: `pnpm typecheck` → clean. (Live shell behavior is a manual check in a built run with `localShellEnabled` on; headless cannot verify ConPTY. Verify the disabled-gate path and that selecting Local Shell while disabled shows the hint.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/dialterm/DialTermModule.tsx src/renderer/modules/settings/SettingsModule.tsx
git commit -m "feat(dialterm): Local Shell connection type + Settings → Terminal pane (opt-in)"
```

---

### Task D8: Custom ports in the host editor

**Files:**
- Create: `src/renderer/modules/dialterm/port.ts`
- Test: `test/dialterm-port.test.ts`
- Modify: `src/renderer/modules/dialterm/DialTermModule.tsx:426-438`

- [ ] **Step 1: Write the failing test**

Create `test/dialterm-port.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextPortOnProtocolChange, DEFAULT_PORTS } from '../src/renderer/modules/dialterm/port';

describe('nextPortOnProtocolChange', () => {
  it('fills the protocol default when the current port is a known default', () => {
    expect(nextPortOnProtocolChange(22, 'telnet')).toBe(DEFAULT_PORTS.telnet); // 23
    expect(nextPortOnProtocolChange(21, 'ssh')).toBe(DEFAULT_PORTS.ssh);       // 22
  });
  it('fills the protocol default when the current port is empty/zero', () => {
    expect(nextPortOnProtocolChange(0, 'ftp')).toBe(DEFAULT_PORTS.ftp);        // 21
  });
  it('preserves a user-entered custom port across a protocol change', () => {
    expect(nextPortOnProtocolChange(2222, 'telnet')).toBe(2222);
    expect(nextPortOnProtocolChange(8022, 'ssh')).toBe(8022);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dialterm-port`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/modules/dialterm/port.ts`:

```ts
import type { DialTermProtocol } from '@shared/post-mvp-types';

export const DEFAULT_PORTS: Record<DialTermProtocol, number> = { ssh: 22, telnet: 23, ftp: 21 };
const KNOWN_DEFAULTS = new Set<number>([22, 23, 21]);

/** When the user changes protocol, only auto-fill the new protocol's default port if the
 *  current port is empty/zero or still a known default — so a custom port (e.g. 2222) is
 *  preserved. Protocol and port are orthogonal; any port 1–65535 is allowed. */
export function nextPortOnProtocolChange(currentPort: number, newProtocol: DialTermProtocol): number {
  if (!currentPort || KNOWN_DEFAULTS.has(currentPort)) return DEFAULT_PORTS[newProtocol];
  return currentPort;
}
```

- [ ] **Step 4: Use the helper in the editor**

In `DialTermModule.tsx`, replace the protocol `onChange` body (line 426-429) so it uses the helper instead of unconditionally resetting the port:

```tsx
              <select className="ga98-text" value={draft.protocol ?? 'ssh'} onChange={(e) => {
                const protocol = e.target.value as DialTermProtocol;
                const port = nextPortOnProtocolChange(draft.port, protocol);
                setDraft({ ...draft, protocol, port, ...(protocol !== 'ssh' ? { authKind: 'password' as const, keyPath: '' } : {}) });
              }}>
```

Add the import: `import { nextPortOnProtocolChange } from './port';`

Add a short hint next to the Port input (after line 438):
```tsx
              <span style={{ fontSize: 10, color: '#666' }}>Any port 1–65535 (e.g. SSH on 2222).</span>
```

Optionally clamp on change (keep it minimal): the existing `onChange` at line 438 already does `Number(e.target.value)`; leave as-is (the connect path tolerates the value; full clamp is not required for this fix).

- [ ] **Step 5: Run test + typecheck + commit**

Run: `pnpm test dialterm-port && pnpm typecheck` → PASS, clean.
```bash
git add src/renderer/modules/dialterm/port.ts src/renderer/modules/dialterm/DialTermModule.tsx test/dialterm-port.test.ts
git commit -m "feat(dialterm): preserve custom host ports across protocol changes"
```

---

## Workstream E — Mail chime fix + background poller + toast

### Task E1: Fix the new-mail chime

**Root cause (from spec):** the working legacy-audio path (`synth.ts:285 playSample`) waits for `loadedmetadata` before calling `play()`; the mail chime (`MailModule.tsx:20-28`) calls `play()` immediately on an unloaded `Audio` element and swallows the rejection. Fix = route the chime through the proven `playSample` pattern and add a user-gesture "Test chime" so the operator can confirm the `.wav` decodes.

**Files:**
- Modify: `src/renderer/audio/synth.ts` (add exported `playMailNotify`)
- Modify: `src/renderer/modules/mail/MailModule.tsx` (use it; drop the local helper)
- Modify: `src/renderer/modules/settings/SettingsModule.tsx` (Test chime button in SoundPane)

- [ ] **Step 1: Export a reliable mail-chime player from synth.ts**

In `src/renderer/audio/synth.ts`, add the import near the other asset imports (line 9-10):
```ts
import mailNotifyUrl from '../assets/mail-notify.wav';
```
And add, next to the legacy players (after line 313):
```ts
/** New-mail chime (operator-supplied .wav). Uses the same metadata-then-play loader as the
 *  legacy pack, which is the path proven to work under the packaged file:// origin. */
export function playMailNotify(): void {
  void playSample(mailNotifyUrl, 0.9);
}
```

- [ ] **Step 2: Use it in MailModule**

In `src/renderer/modules/mail/MailModule.tsx`:
- Remove the local `playMailNotify` function (lines 19-28) and the `import mailNotifyUrl from '../../assets/mail-notify.wav';` (line 12).
- Add `import { playMailNotify } from '../../audio/synth';`.
- The two call sites (lines 78, 102) keep calling `playMailNotify()` unchanged.

- [ ] **Step 3: Add a "Test chime" button to SoundPane**

In `SettingsModule.tsx` `SoundPane` (line 173), import `playMailNotify` from `../../audio/synth` and add a button (user-gesture playback is always allowed, so this isolates a decode/path problem from a gating problem):

```tsx
      <br />
      <button onClick={() => playMailNotify()}>Test "You've got mail" chime</button>
```

- [ ] **Step 4: Typecheck + manual note**

Run: `pnpm typecheck` → clean. Audible confirmation needs a built run; the Test button is the concrete verification surface.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio/synth.ts src/renderer/modules/mail/MailModule.tsx src/renderer/modules/settings/SettingsModule.tsx
git commit -m "fix(mail): play new-mail chime via the proven metadata-then-play loader + Settings test button"
```

---

### Task E2: Background mail poller (opt-in) + chime + Win98 toast

**Files:**
- Modify: `src/shared/types.ts` (AppSettings + defaultSettings: `mailBackgroundCheck`)
- Modify: `src/shared/ipc-contracts.ts` (mail block: add `onNewMail`)
- Modify: `src/preload/index.ts` + `src/preload/api.d.ts` (mail `onNewMail` listener)
- Create: `src/main/services/mail-poller.ts`
- Test: `test/mail-poller.test.ts`
- Modify: `src/main/ipc/register.ts` (start poller wiring) and/or `src/main/index.ts`
- Modify: `src/renderer/shell/` always-mounted component (subscribe → chime + toast)
- Modify: `src/renderer/modules/mail/MailModule.tsx` (suppress in-module chime when bg on)

**Design notes:**
- The poller is a main-process timer. It calls the existing inbox-fetch path that `mail:fetchInbox` already uses (locate the function `fetchInbox` calls in `src/main/services/mail.ts` and reuse it per account). It tracks a per-account unseen baseline in main, priming on first poll (no event), and emits `mail:onNewMail` `{ accountId, unseenCount }` when unseen increases.
- Gate: only poll when `settings.mailBackgroundCheck === true`. Read settings each tick and no-op when disabled (so toggling the setting takes effect without restart).
- The renderer subscriber lives in an always-mounted shell component (the same one that hosts `Toaster` / taskbar — e.g. the shell root or `Toaster` host). On `onNewMail`: `playMailNotify()` + `toast.info('You\'ve got mail — N new message(s)')` (Win98 toast via the existing `toast`/`useToasts` surface).
- No double-chime: in `MailModule.tsx`, gate the two in-module `playMailNotify()` calls (lines 78, 102) behind `!settings?.mailBackgroundCheck` so when the background poller owns chiming, the open module does not also chime. The module still updates its list view.

- [ ] **Step 1: Add the setting**

`AppSettings`:
```ts
  /** Poll configured mail accounts in the background (even when the Mail window is closed).
   *  Opt-in (default off) — when on, the app makes periodic IMAP fetches while running. */
  mailBackgroundCheck: boolean;
```
`defaultSettings`: `mailBackgroundCheck: false,`

- [ ] **Step 2: Add the IPC event + preload**

`ipc-contracts.ts` mail block (after `printMessage` at line 133), add:
```ts
    onNewMail: 'mail:onNewMail'
```
`preload/index.ts` mail block — add a listener (mirror ssh.onData style):
```ts
    onNewMail: (cb: (payload: { accountId: string; unseenCount: number }) => void) => {
      const l = (_e: unknown, p: { accountId: string; unseenCount: number }) => cb(p);
      ipcRenderer.on(channels.mail.onNewMail, l);
      return () => ipcRenderer.removeListener(channels.mail.onNewMail, l);
    },
```
`api.d.ts` mail block — add:
```ts
    onNewMail(cb: (payload: { accountId: string; unseenCount: number }) => void): () => void;
```

- [ ] **Step 3: Write the failing poller test (fetch mocked)**

Create `test/mail-poller.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

// Mock settings + the inbox fetch + account list. ADAPT module paths to the real ones found
// during implementation (mail service + settings accessor).
let bgEnabled = true;
let accounts = [{ id: 'acc1' }];
let unseenByAccount: Record<string, number> = { acc1: 0 };

vi.mock('../src/main/storage/settings', () => ({
  readSettings: () => ({ mailBackgroundCheck: bgEnabled })
}), { virtual: true });
vi.mock('../src/main/services/mail', () => ({
  listAccounts: () => Promise.resolve(accounts),
  fetchInbox: (accId: string) =>
    Promise.resolve(Array.from({ length: unseenByAccount[accId] ?? 0 }, () => ({ unseen: true })))
}), { virtual: true });

import { pollOnce } from '../src/main/services/mail-poller';

function fakeWindow() {
  const sent: { ch: string; payload: any }[] = [];
  return { win: { webContents: { send: (ch: string, payload: any) => sent.push({ ch, payload }) } }, sent };
}

beforeEach(() => { bgEnabled = true; accounts = [{ id: 'acc1' }]; unseenByAccount = { acc1: 0 }; });

describe('mail-poller pollOnce', () => {
  it('primes the baseline on first poll without emitting', async () => {
    unseenByAccount.acc1 = 3;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any); // first poll = prime
    expect(sent.length).toBe(0);
  });
  it('emits onNewMail when unseen increases after priming', async () => {
    unseenByAccount.acc1 = 1;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);   // prime at 1
    unseenByAccount.acc1 = 4;
    await pollOnce(() => win as any);   // increase → emit
    const evt = sent.find((s) => s.ch === channels.mail.onNewMail);
    expect(evt?.payload).toEqual({ accountId: 'acc1', unseenCount: 4 });
  });
  it('does nothing when mailBackgroundCheck is off', async () => {
    bgEnabled = false;
    unseenByAccount.acc1 = 5;
    const { win, sent } = fakeWindow();
    await pollOnce(() => win as any);
    await pollOnce(() => win as any);
    expect(sent.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test mail-poller`
Expected: FAIL — module missing.

> **Implementer note:** locate the real exported functions in `src/main/services/mail.ts` that `mail:listAccounts` and `mail:fetchInbox` delegate to, and the real settings accessor; update the test mocks to those module paths/signatures.

- [ ] **Step 5: Implement the poller**

Create `src/main/services/mail-poller.ts`:

```ts
/**
 * Background mail poller (opt-in via settings.mailBackgroundCheck). Runs in main so it
 * checks mail even when the Mail window is closed. Tracks a per-account unseen baseline,
 * primes on first poll without firing, and emits mail:onNewMail when unseen increases.
 * No idle egress unless the setting is on.
 */
import type { BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';
import { readSettings } from '../storage/settings';          // ADAPT
import { listAccounts, fetchInbox } from './mail';           // ADAPT to real exports

const POLL_MS = 60_000;
const baseline = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;

export async function pollOnce(getWindow: () => BrowserWindow | null): Promise<void> {
  if (!readSettings().mailBackgroundCheck) return;
  let accounts: { id: string }[] = [];
  try { accounts = await listAccounts(); } catch { return; }
  for (const acc of accounts) {
    try {
      const list = await fetchInbox(acc.id, 30);
      const unseen = list.filter((m: { unseen?: boolean }) => m.unseen).length;
      const prev = baseline.get(acc.id);
      baseline.set(acc.id, unseen);
      if (prev === undefined) continue;              // prime, do not fire
      if (unseen > prev) {
        getWindow()?.webContents.send(channels.mail.onNewMail, { accountId: acc.id, unseenCount: unseen });
      }
    } catch { /* silent: transient IMAP errors don't spam */ }
  }
}

export function startMailPoller(getWindow: () => BrowserWindow | null): void {
  if (timer) return;
  timer = setInterval(() => { void pollOnce(getWindow); }, POLL_MS);
}

export function stopMailPoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
  baseline.clear();
}
```

- [ ] **Step 6: Start the poller from main**

In `src/main/ipc/register.ts` (inside `registerIpc(getWindow)`) or `src/main/index.ts` after window creation, call `startMailPoller(getWindow)` once. (The poller self-gates each tick on the setting, so it can run unconditionally; it no-ops when disabled.) Add `import { startMailPoller, stopMailPoller } from '../services/mail-poller';` and call `stopMailPoller()` in the before-quit handler alongside the other shutdowns.

- [ ] **Step 7: Renderer subscriber — chime + toast**

In the always-mounted shell host (the component that renders `Toaster` — find it via `grep -rn "Toaster" src/renderer/shell`), add a `useEffect` that subscribes once:

```tsx
useEffect(() => {
  const off = window.api.mail.onNewMail(({ unseenCount }) => {
    playMailNotify();
    toast.info(`You've got mail — ${unseenCount} unread`);
  });
  return off;
}, []);
```

Imports: `playMailNotify` from `../audio/synth`, `toast` from `../state/toasts`. (This component is always mounted, so the chime/toast fire regardless of whether the Mail window is open.)

- [ ] **Step 8: Suppress double-chime in the open Mail module**

In `MailModule.tsx`, change the two chime conditions (lines 78, 102) from `settings?.soundEnabled` to `settings?.soundEnabled && !settings?.mailBackgroundCheck` so the open module does not also chime when the background poller owns it.

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm test mail-poller && pnpm typecheck && pnpm test`
Expected: PASS; full suite green.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/services/mail-poller.ts src/main/ipc/register.ts src/main/index.ts src/renderer/shell/ src/renderer/modules/mail/MailModule.tsx test/mail-poller.test.ts
git commit -m "feat(mail): opt-in background poller emitting new-mail chime + Win98 toast"
```

---

## Cross-cutting finalization

### Task F1: Version bump + docs

**Files:**
- Modify: `package.json` (version → `3.14.0-beta.10`)
- Modify: `README.md` (status line, version strings, test count)
- Create: `RELEASE_NOTES_v3.14.0-beta.10.md`

- [ ] **Step 1: Bump version** to `3.14.0-beta.10` in `package.json`.
- [ ] **Step 2: Update `README.md`** status/version/test-count strings to match.
- [ ] **Step 3: Write `RELEASE_NOTES_v3.14.0-beta.10.md`** covering: categories persist+default-collapsed; Share/Import two-row toolbar; four icons moved desktop→programs menu; DialTerm local shell (opt-in, Settings → Terminal; note the native backend + that it loads only on session open); custom host ports; fixed new-mail chime + Settings test button; opt-in background mail poller (chime + toast). Leave the installer SHA-256/size as `TBD — filled at release time` (the unsigned-installer ritual fills these post-build).
- [ ] **Step 4: Commit**
```bash
git add package.json README.md RELEASE_NOTES_v3.14.0-beta.10.md
git commit -m "chore(release): v3.14.0-beta.10 — DialTerm shell, bg mail, UI feedback"
```

### Task F2: Red-team gate (mandatory) + egress review

- [ ] **Step 1:** Dispatch the `red-teamer` agent against Workstream D (live process execution): verify the disabled gate cannot be bypassed via direct `shell.connect` IPC; no path/arg/cwd injection escapes the allowlisted shell (`ensureShellProgram` returns only cmd/powershell; renderer cannot supply a path); sessions are killed on disconnect, window close, and quit; the PTY env does not leak app secrets; the lazy-load failure path cannot wedge the app at boot.
- [ ] **Step 2:** Review Workstream E2's egress: background IMAP fetches occur only when `mailBackgroundCheck` is true; no polling when disabled or no accounts; no telemetry.
- [ ] **Step 3:** Fix any findings (new tasks), re-review until clean. Record outcome.

---

## Self-Review (completed by plan author)

**Spec coverage:** A (categories persist+default) ✓ A1. B (Share/Import layout) ✓ B1. C (desktop→menu) ✓ C1. D (local shell) ✓ D1-D7; D-port (custom ports) ✓ D8. E1 (chime) ✓ E1. E2 (poller+toast) ✓ E2. Cross-cutting (version/docs/red-team) ✓ F1/F2.

**Placeholder scan:** The two settings-accessor / mail-service references are intentionally flagged "ADAPT to the real module discovered during implementation" with explicit grep guidance — not silent placeholders. All code steps carry complete code. Icon names (`note`/`chart`) carry a verify-against-Icon.tsx instruction with a concrete fallback. Release-notes SHA is `TBD — filled at release time` per the established unsigned-installer ritual.

**Type consistency:** `localShellEnabled`/`localShellProgram` (`'cmd'|'powershell'`) consistent across types.ts, validator, service, preload, UI. `shell.*` channel shape mirrors `ssh.*` exactly (`{sessionId,data}` / `{sessionId,reason}`). `mail.onNewMail` payload `{accountId,unseenCount}` consistent across contract, preload, api.d.ts, poller emit, and renderer subscriber. `nextPortOnProtocolChange(number, DialTermProtocol): number` consistent between test, helper, and call site.

**Risks carried from spec:** D6 native-binary packaging may not complete on this host — lazy-load fail-safe + mocked tests keep the app and CI green; shipped-shell-binary is a build-time/Windows-host decision. E1 audible confirmation needs a built run; Test button is the verification surface.
