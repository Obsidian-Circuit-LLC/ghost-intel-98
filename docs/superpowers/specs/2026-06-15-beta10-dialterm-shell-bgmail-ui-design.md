# DCS98 v3.14.0-beta.10 — DialTerm local shell, background mail, UI feedback (design)

**Source:** GhostExodus beta.9 field-test feedback, relayed by operator 2026-06-15.
**Status:** Approved for spec (operator: "proceed", 2026-06-15).

This release bundles five items from one feedback batch. Three are low-risk UI fixes
(A/B/C), one is a diagnosed bug plus a feature (E), and one is a high-risk native-module
feature (D) that lands behind a fail-safe gate.

---

## Workstream A — My Cases categories: persist collapse + default collapsed

**Problem.** In `CasesModule.tsx:60`, category collapse state is `useState<Record<string,
boolean>>({})` — in-memory only, absent key = expanded. Collapsing a category and restarting
the app loses the choice (categories spring back open). GhostExodus wants them "closed by
default," and the underlying complaint is the lost state.

**Decision (operator).** Persist collapse state across restarts **and** default unknown
categories to collapsed.

**Design.**
- Add `caseCategoryCollapsed: Record<string, boolean>` to `AppSettings`
  (`src/shared/types.ts`), default `{}`. It lives next to the existing case UI prefs
  (`caseSortBy`, `caseSortDir`).
- `CasesModule` reads initial state from `settings.caseCategoryCollapsed` and resolves
  per-category: `isCollapsed(name) = stored[name] ?? true`. Absent → collapsed. This makes
  fresh profiles and newly created categories start closed (honors "closed by default").
- On header click, persist via the existing settings patch:
  `patch({ caseCategoryCollapsed: { ...stored, [name]: nextCollapsed } })`. The component may
  keep a local mirror for snappy UI, but settings is the source of truth on mount.
- A renamed category loses its stored key and re-defaults to collapsed. Acceptable.

**Components/interfaces.** Pure resolver helper `resolveCollapsed(stored, name): boolean`
(absent → `true`) so the rule is unit-testable without React.

**Testing.** `resolveCollapsed`: absent → collapsed; explicit `false` → expanded; explicit
`true` → collapsed. Settings round-trip: patch merges without dropping other keys.

---

## Workstream B — Share/Import button layout

**Problem.** `CasesModule.tsx:215-229` renders five buttons (New, Rename, Delete, Share…,
Import…) in a single non-wrapping `display:flex` row. The row overflows the narrow sidebar,
producing a horizontal scrollbar that hides Share/Import "at first glance" (visible in the
beta.9 screenshot).

**Design.** Split into two rows inside the same toolbar container:
- Row 1: **New · Rename · Delete**
- Row 2: **Share… · Import…**

Implemented as two flex rows (or a wrapping flex with a forced break) so there is no
horizontal overflow at the sidebar's default width. Disabled-state logic
(`disabled={!selectedId}`) is unchanged. The category list's own vertical scroll is separate
and untouched.

**Testing.** Render test: both `Share…` and `Import…` buttons are present in the toolbar; the
toolbar container does not set/require horizontal scrolling (no `overflowX` reliance). Layout
fidelity is a manual check.

---

## Workstream C — Desktop icons → programs menu

**Problem.** Journal Jots, GeoINT, Markets, and Jukebox appear as desktop icons. GhostExodus
wants them off the desktop and available in the programs (Access) menu instead.

**Current state.**
- Desktop icons are a compiled-in list: `desktopShortcutDefaults` in
  `src/renderer/shell/Desktop.tsx:14-31` (`journal`, `media-player`, `geoint`, `markets` are
  all present).
- The Access/programs menu is the user-editable `settings.shortcuts` array, seeded from
  `defaultShortcuts` (`types.ts:437`) and repaired on launch by `reconcileShortcuts`
  (`types.ts:479-499`) using `REQUIRED_MODULE_SHORTCUTS` (`types.ts:465`).
- `defaultShortcuts` already contains `geoint` and `media-player`, but **not** `journal` or
  `markets`. `REQUIRED_MODULE_SHORTCUTS` already contains `geoint` + `media-player`.

**Design.**
1. Remove `journal`, `media-player`, `geoint`, `markets` entries from
   `desktopShortcutDefaults` in `Desktop.tsx`.
2. Add `journal` and `markets` to `defaultShortcuts` (new fresh installs) and to
   `REQUIRED_MODULE_SHORTCUTS` (existing installs) so `reconcileShortcuts` seeds them once.
   Use existing icon names (verify against the icon set during planning; e.g. `journal` →
   `note`/book glyph, `markets` → chart glyph). `geoint`/`media-player` are already seeded —
   no change needed for them, they simply stop being desktop icons.

**Migration semantics.** On GhostExodus's existing install, `reconcileShortcuts` finds
`journal`/`markets` absent and not yet in `seededShortcuts` → appends them once. If he later
deletes one, the `seededShortcuts` record prevents force-re-adding it. Desktop icons vanish on
update because the list is compiled-in.

**Testing.** Extend the `reconcileShortcuts` test: a list lacking `journal`/`markets` gets them
seeded; a list where the user deleted one (target in `seededShortcuts`, absent from
`shortcuts`) does not re-add it. Assert `desktopShortcutDefaults` no longer contains the four
targets.

---

## Workstream D — DialTerm local shell (ConPTY via node-pty)

**Problem.** DialTerm is an SSH/Telnet/FTP client (xterm.js frontend, `src/main/services/ssh.ts`
backend, all pure-JS). GhostExodus wants it to also drive a local Windows cmd/PowerShell —
"a terminal/command shell emulation."

**Decision (operator).** Real PTY via `node-pty` (ConPTY on Windows). Opt-in, default off.

**Architecture.** New main-process service `src/main/services/shell.ts`, structurally parallel
to `ssh.ts` (a `Map<sessionId, session>`, the same connect/write/resize/disconnect verbs, the
same `onData`/`onClose` event-send pattern). The renderer reuses the existing xterm.js terminal
component; DialTerm gains a "Local Shell" connection type alongside the host profiles.

**IPC surface** (new channels, all validated in `src/main/security/validate.ts`):
- `shell.connect(program?) → { sessionId }`
- `shell.write(sessionId, data)`
- `shell.resize(sessionId, cols, rows)`
- `shell.disconnect(sessionId)`
- `shell.onData → { sessionId, data }` (main→renderer)
- `shell.onClose → { sessionId, reason }` (main→renderer)

**Security design (load-bearing).**
1. **Fail-safe native load.** `node-pty` is `require`d lazily *inside* the connect path,
   wrapped in try/catch. It is NEVER imported at main-process module top level. A missing or
   ABI-mismatched `.node` therefore surfaces as a "Local shell unavailable" error/toast on
   connect — it does not crash the app at boot. (Directly addresses the prior
   native/ESM-at-boot crash class.)
2. **Authoritative main-side gate.** `shell.connect` refuses unless
   `settings.localShellEnabled === true`. The renderer also hides/disables the UI when off,
   but the IPC handler is the real boundary — any renderer code (including plugins, which
   share the renderer) calling the channel while disabled is rejected.
3. **No arbitrary executable from the renderer.** The shell binary is selected by the main
   process from a fixed allowlist (`cmd.exe`, `powershell.exe` on win32; `/bin/bash` or `$SHELL`
   on other platforms for dev). The renderer may pass a *choice token* (e.g. `'cmd' | 'powershell'`)
   mapped by main to a fixed path; it may not pass a path. Bounds-checked `cols`/`rows`
   (positive ints, sane max). `cwd` defaults to the user home; not renderer-supplied in v1.
4. **Lifecycle.** Sessions are killed on `shell.disconnect`, on owning-window close, and on app
   quit. No orphaned PTYs.

**Settings.** `localShellEnabled: boolean` (default `false`), `localShellProgram: 'cmd' |
'powershell'` (default `'cmd'`). Surfaced in a Settings → Terminal pane (or the existing
relevant pane) with a one-line disclosure that this runs local commands with the user's own
privileges.

**Packaging (the risk, stated plainly).** `node-pty` is the project's first native module and
needs an Electron-ABI Windows `.node`, `asarUnpack`ed via electron-builder, and the `postinstall`
"skipping native rebuild — ssh2 runs pure-JS" assumption no longer holds for it. Producing that
binary from this Linux + Wine box is the same wall as the parked Windows-confinement work and
may require a real Windows build host. **Consequence for this release:** the *code* lands in
beta.10 behind the opt-in + fail-safe gate, so the feature is dark and harmless until a working
binary exists. Whether the beta.10 installer carries that binary is a build-time decision (we
may ship beta.10 with the shell still dark and complete the packaged binary in a Windows-host
follow-up). The rest of beta.10 is unaffected either way.

**Red-team (mandatory — live process execution).** Verify: the disabled gate cannot be bypassed
via direct IPC; no path/arg/cwd injection escalates beyond the allowlisted shell; sessions are
cleaned up on every termination path; environment passed to the PTY does not leak app secrets;
the lazy-load failure path cannot wedge the app.

**Testing.** `shell.ts` lifecycle with `node-pty` **mocked** (no real PTY in CI): connect wires
data/close handlers and returns a sessionId; write/resize/disconnect reach the mock; connect is
refused when `localShellEnabled` is false; a renderer-supplied bad program token falls back to
the default allowlisted shell (never spawns an arbitrary path); cols/rows bounds enforced. A
`describe.skip` live-PTY integration test documents the manual path.

### D-port — Custom ports in the host editor (added 2026-06-15, GhostExodus)

**Problem.** In the DialTerm SSH-hosts editor the Port field is already a free numeric input
(`DialTermModule.tsx:438`), but the Protocol dropdown's `onChange` (line 428) overwrites the
port with the protocol default (SSH→22, Telnet→23, FTP→21) on every protocol change — so a
custom port feels un-keepable, which reads as "ports are locked to the protocol."

**Design.** Protocol and port are orthogonal (SSH can run on any port), so there is no "custom
protocol" entry — the three transports stay. Instead: (1) the Protocol `onChange` only fills the
default port when the current port is empty or still equals a known default (22/23/21);
a user-entered custom port survives a protocol switch. (2) The port input is bounds-validated
1–65535 with a short helper hint that any port is allowed. (3) The main-side connect path
already takes `host.port` as given — confirm it imposes no protocol↔port coupling; if it does,
remove it.

**Testing.** Pure helper `nextPortOnProtocolChange(currentPort, newProtocol): number` — empty/
default current → new protocol's default; custom current (e.g. 2222) → unchanged. Port bounds
clamp/validate test.

---

## Workstream E — Background mail: chime fix + main-process poller + toast

Two coupled parts: a diagnosed bug (E1) and a feature (E2).

### E1 — "You've got mail" chime not firing

**Diagnosis.** The chime plays via `new Audio(mailNotifyUrl); a.play()` in
`MailModule.tsx:20-28`, fired from a background `setInterval` poll, with the rejection swallowed
by a bare `catch`. The main `BrowserWindow` sets **no** `autoplayPolicy`
(`src/main/index.ts:97`), so Chromium's default (`document-user-activation-required`) blocks
`play()` when invoked from a timer without a fresh user gesture — the prime suspect. Secondary
factors: the chime only fires on a *net increase* in unseen count (correct, but means existing
unread never re-chimes), and `soundEnabled` defaults to `true` (so that is not the cause). The
CSP `media-src 'self' blob: ga98media: https: http:` has no `data:`, but the 9946-byte `.wav` is
above Vite's inline limit and is emitted as a `'self'`-origin file asset — allowed; not the
cause.

**Design.**
1. Set `autoplayPolicy: 'no-user-gesture-required'` on the main `BrowserWindow` webPreferences.
2. Route the new-mail chime through the existing audio subsystem (the same path used for
   startup/dial-up sounds) rather than a bare detached `Audio` element, for a consistent and
   more reliable playback path.
3. Stop silently swallowing the playback error in dev — log it so future failures are visible.
4. Add a **"Test chime"** button to Settings → Sound that plays `mail-notify.wav` on a real user
   gesture (guaranteed-allowed), so the operator/tester can confirm the asset decodes and the
   path resolves in the packaged app.

**Honesty note.** Final confirmation requires a built run; these are the concrete, reviewable
deliverables. The autoplay-policy change is the highest-probability fix.

### E2 — Background mail poller (runs with Mail window closed)

**Problem.** Polling lives in the Mail component's `useEffect` (30s interval) and is torn down on
unmount — no mail is fetched, and no chime fires, when the Mail window is closed. GhostExodus
wants new mail received (and the chime) in the background.

**Decision (operator).** Move polling to the main process. Opt-in, default off. Signal new mail
with **chime + a Win98 toast**.

**Design.**
- New main service `src/main/services/mail-poller.ts`. On an interval (default 60s), for each
  configured account, it calls the existing `fetchInbox` path, tracks the per-account unseen
  baseline in main (priming on first poll without firing), and emits `mail:newMail`
  `{ accountId, unseenCount }` to the renderer when unseen increases.
- **Gating.** The poller runs only when `settings.mailBackgroundCheck === true` (default false)
  **and** at least one account is configured **and** the existing mail/network gate is satisfied.
  No idle network egress unless the operator opts in.
- Credentials already live in main (`secretStore`), so the poller is self-sufficient.
- The always-mounted shell (Desktop/taskbar) subscribes to `mail:newMail` and fires the chime
  (the hardened E1 path) + a Win98 toast/balloon near the clock (reusing the existing toast
  surface).
- **No double-chime.** When `mailBackgroundCheck` is on, the main poller is the single source of
  new-mail chimes/toasts; the open Mail module's own chime logic stands down (fires only when
  background polling is off, as a fallback). When the Mail module is open it still refreshes its
  own list view as today.

**Settings.** `mailBackgroundCheck: boolean` (default `false`), surfaced in the Mail/Sound
settings with a one-line note that it polls your mailbox on a timer while the app runs.

**IPC.** `mail:newMail` event (main→renderer). Optional control to start/stop the poller on
settings change; otherwise the poller reads settings on each tick and no-ops when disabled.

**Testing.** `mail-poller.ts` with `fetchInbox` mocked: first poll primes baseline and emits no
event; a later poll with increased unseen emits `mail:newMail`; disabled setting → no polling/no
event; no accounts → no event; interval teardown on disable. Toast/chime wiring is a lighter
renderer integration check.

---

## Cross-cutting

- **Version** → `3.14.0-beta.10` (`package.json`); update `README.md` (status, version strings,
  test count) and write `RELEASE_NOTES_v3.14.0-beta.10.md`.
- **New settings:** `caseCategoryCollapsed`, `localShellEnabled`, `localShellProgram`,
  `mailBackgroundCheck` — all added to `AppSettings`, `defaultSettings`, and validated.
- **New IPC channels:** `shell.*` (connect/write/resize/disconnect/onData/onClose),
  `mail:newMail` — all validated in `validate.ts`, registered in `ipc/register.ts`, exposed via
  preload + `api.d.ts`.
- **Module registration** unchanged (no new top-level module; DialTerm gains a connection type,
  mail-poller is a service).
- **Build path:** subagent-driven development with the standard two-stage review per task; a
  **mandatory red-team pass on Workstream D** (live execution) and a **review pass on E2's idle
  egress**.

## Verification

- `pnpm typecheck` + full `pnpm test` green (new suites: cases collapse resolver, reconcile
  shortcuts journal/markets, shell lifecycle (mocked pty), mail-poller).
- Manual (needs a built run, flagged where headless can't confirm): categories persist collapsed
  across restart; Share/Import visible without horizontal scroll; the four icons gone from
  desktop and present in the programs menu; chime audibly fires (incl. the new Test button);
  background poller chimes + toasts with the Mail window closed (when enabled); DialTerm local
  shell opens cmd/PowerShell when enabled and degrades to a toast (not a crash) when the native
  binary is absent.
- Charter: no telemetry; no new egress except the opt-in background IMAP poll (gated, disclosed);
  local shell runs only with the user's own privileges behind the opt-in main-side gate.

## Risks / deferrals

- **D's packaged binary** may require a real Windows build host. The code ships dark behind the
  opt-in + fail-safe gate; the installer's working-shell binary is a build-time decision and may
  be a follow-up. Mirrors the beta.9 XPath-engine deferral and the parked Windows-confinement work.
- **E1** cannot be fully verified headless; the autoplay-policy fix + Test button are the testable
  deliverables.
