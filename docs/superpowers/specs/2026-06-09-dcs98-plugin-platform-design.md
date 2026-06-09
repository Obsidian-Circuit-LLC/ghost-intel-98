# DCS98 Plugin Platform — Design Spec

**Status:** design — awaiting operator review before `writing-plans`.
**Date:** 2026-06-09
**Author:** Desirae Stark (with Claude)

**Goal:** Add a minimal, security-first plugin platform to the open-source DCS98 core so that closed-source, separately-distributed capabilities (first being the OSINT/Maltego competitor) can be loaded as **signed** bundles — verified with a PQ-hybrid (Ed25519 + ML-DSA-65) signature in the main process before any plugin code runs, scoped to declared capabilities, and able to contribute renderer UI modules at runtime.

**Architecture (3 sentences):** A plugin is a signed bundle (`manifest.json` + prebuilt main entry + prebuilt renderer ESM chunk + detached hybrid signature) dropped in `userData/plugins/`. At startup the main process verifies each bundle's signature against public keys pinned in the core binary, and only on success loads the main entry with a capability-scoped `PluginContext` and exposes the verified renderer chunk over a privileged `dcs98-plugin://` protocol. The renderer dynamically imports verified chunks, which register UI modules into a runtime `ModuleRegistry` that replaces today's compile-time 5-point wiring.

**Tech stack:** Electron 33, React 18, TypeScript, Zustand, Vitest; `@noble/curves` (Ed25519) + `@noble/post-quantum` (ML-DSA-65), both already bundled into main by `electron.vite.config.ts`.

---

## 1. Scope & non-goals

**In scope (this subsystem — the public core):**
- Plugin discovery in `userData/plugins/`.
- PQ-hybrid signature verification (fail-closed) against pinned public keys.
- A capability/permission model and a capability-scoped `PluginContext`.
- A runtime `ModuleRegistry` (refactor of the compile-time 5-point pattern) that built-ins seed and plugins extend.
- A privileged `dcs98-plugin://` protocol to serve verified renderer chunks, plus the one CSP change needed to import them.
- New `plugin:*` IPC channels and a `plugins` settings block.
- A pinned **core API version** contract a plugin targets.

**Explicit non-goals (YAGNI — do not build):**
- No marketplace, registry, auto-update, or remote fetch of plugins (a plugin arrives as a local file; how the OSINT artifact reaches users is a *subsystem-2* product decision).
- No third-party SDK docs or public plugin-authoring guide (the only plugin author is us, for now).
- No hot-reload / live plugin dev server.
- **No unsigned/dev-mode plugin loading.** A dev bypass would be a backdoor; if ever wanted it is a separate, loud, build-flag decision — not in this spec.
- No per-plugin OS-process sandbox. Plugins are *first-party, signed* trusted code; the signature is the trust boundary, the capability model is defense-in-depth. (A renderer-side sandbox is not meaningful when the plugin's own main code already runs in main.)

**Where this fits:** This is **subsystem 1 of 2**. Subsystem 2 (the OSINT plugin, private repo) targets the plugin SDK defined here. Platform ships first; OSINT plugin is a later, separate spec→plan→build cycle.

---

## 2. Architecture overview

```
core (public, MIT)                              plugin bundle (private, signed)
─────────────────────                           ──────────────────────────────
main process                                    my-plugin.dcs98plugin/
  index.ts  app.whenReady()                        manifest.json
    └─ plugins/loader.ts  discover+verify+load  ──▶  main.js     (CJS, transforms+IPC)
         ├─ plugins/verify.ts  Ed25519∥ML-DSA        renderer.js (ESM, the UI module)
         ├─ plugins/context.ts  capability scope      signature.bin (Ed25519 ∥ ML-DSA-65)
         └─ plugins/protocol.ts  dcs98-plugin://
preload/index.ts  window.api.plugins.*
renderer
  state/registry.ts  ModuleRegistry  ◀── built-ins seed; plugin renderer.js registers
  shell/ModuleHost.tsx  renders from registry (was: 27-case switch)
  bootstrap: query verified plugins → import('dcs98-plugin://<id>/renderer.js')
```

**Boot sequence (main):**
1. `protocol.registerSchemesAsPrivileged([... , dcs98-plugin])` — *before* `app.ready` (alongside the existing `ga98media`/`ga98model` registration in `src/main/index.ts:21`).
2. In `app.whenReady()`, after `vault.refreshEnabled()` and before `registerIpc(...)` (`src/main/index.ts:~230`): `await loadPlugins()`.
3. `loadPlugins()` enumerates `userData/plugins/*`, verifies each, and for verified plugins requires the main entry with a scoped context and records the renderer-chunk path. Unverified/failed plugins are skipped and logged; **load failure never blocks app startup**.
4. `registerPluginProtocol()` installs the `dcs98-plugin://` handler (path-confined to verified plugin dirs).

**Boot sequence (renderer):**
1. Built-in modules register into `ModuleRegistry` at import time (replacing the static maps).
2. `App.tsx` queries `window.api.plugins.listVerified()` and, for each, `await import('dcs98-plugin://<id>/renderer.js')`; the imported module's side-effect (or default export) calls `registerModule(descriptor)`.
3. `ModuleHost` and the Desktop/shortcuts read from the registry.

---

## 3. Plugin artifact & manifest

A plugin is a **directory** under `userData/plugins/<id>/` (the distributable form is a `.dcs98plugin` zip the user extracts, or a future installer drops; the loader operates on the extracted directory). Contents:

```
<id>/
  manifest.json
  main.js          # prebuilt CommonJS bundle — transforms, IPC handlers
  renderer.js      # prebuilt ESM chunk — registers the UI module
  signature.bin    # detached hybrid signature (see §4)
  assets/          # optional; static assets served via dcs98-plugin://
```

`manifest.json` schema (validated; unknown fields rejected):

```jsonc
{
  "id": "osint",                       // ^[a-z][a-z0-9-]{2,31}$ ; matches dir name
  "name": "OSINT Toolkit",
  "version": "1.0.0",                  // semver
  "targetApiVersion": 1,               // integer; must satisfy core's compat range (§9)
  "modules": [                         // renderer UI modules this plugin contributes
    { "key": "osint:graph", "title": "OSINT", "glyph": "🕸" }
  ],
  "capabilities": ["egress", "secrets", "case-storage", "entity-registry", "timeline"],
  "main": "main.js",
  "renderer": "renderer.js"
}
```

- `modules[].key` MUST be namespaced `^<id>:[a-z0-9-]{1,32}$` to avoid colliding with built-in `ModuleKey`s.
- `capabilities` is the *requested* set; the loader grants exactly these (a plugin cannot escalate at runtime). Unknown capability strings → reject the plugin.

---

## 4. Signature scheme & verification

**Trust root:** PQ-hybrid. Two independent signatures over the same message; **both must verify** (fail-closed). The signed message is a domain-separated canonical hash:

```
msg = SHA-512( "DCS98-PLUGIN-v1" ∥ 0x00 ∥
               len-prefixed(manifest.json bytes) ∥
               len-prefixed(main.js bytes) ∥
               len-prefixed(renderer.js bytes) ∥
               len-prefixed(sorted assets: for each, path ∥ 0x00 ∥ bytes) )
signature.bin = ed25519_sig (64 B) ∥ mldsa65_sig (~3309 B)
```

- `len-prefixed(x)` = 8-byte big-endian length ∥ `x`. Sorted assets use a deterministic byte-wise path sort. Hashing every file (not just the manifest) means a tampered `main.js`/`renderer.js`/asset fails verification even if the manifest is untouched.
- **Verification (main, `plugins/verify.ts`):** recompute `msg`; `ed25519.verify(sigEd, msg, PINNED_ED_PUB)` **AND** `ml_dsa65.verify(sigPq, msg, PINNED_PQ_PUB)`. Both true → load. Either false / wrong length / parse error → refuse + `console.error('[plugin:<id>] signature verification failed')`, skip.
- **Pinned keys:** `PINNED_ED_PUB` (32 B) and `PINNED_PQ_PUB` (ML-DSA-65 public, ~1952 B) are constants compiled into the core (`src/main/plugins/trust.ts`). Private keys live **offline with the operator**; they never touch the repo or build host.
- **Reuse:** Ed25519 via the same `ed25519` import already used in `src/main/chat/crypto.ts:22`; ML-DSA-65 via `@noble/post-quantum` (in `dependencies`, bundled into main). Verification lives in its own module — `chat/crypto.ts` stays chat-only.
- **Signing workflow (operator side, lives in the private plugin repo):** `scripts/sign-plugin.mjs` builds `msg` from the built artifact, signs with both offline private keys, writes `signature.bin`. Documented in subsystem 2; the core only verifies.

**Key rotation (minimal now):** `trust.ts` holds an *array* of accepted `{edPub, pqPub}` pairs; verification passes if any one pair validates both legs. Ship with a single pair. This makes future rotation a pin-list edit without a verification rewrite. No revocation list, no expiry in v1 (YAGNI).

---

## 5. Capability model & `PluginContext`

The loaded main entry exports `register(ctx: PluginContext): void`, invoked once after verification. `ctx` exposes **only** the capabilities the manifest declared; absent capabilities are simply not present on the object.

```typescript
export interface PluginContext {
  readonly id: string;
  readonly logger: { info(m: string): void; warn(m: string): void; error(m: string): void };

  // always available — register a named handler into the plugin's internal dispatch map
  // (keyed `<id>:<name>`); reached from the renderer via the single `plugins:invoke` IPC channel,
  // NOT a per-handler IPC channel.
  registerHandler(name: string, fn: (...args: unknown[]) => unknown): void;

  // capability: 'egress' — gated + SSRF-validated + Tor-routed fetch
  egress?: {
    fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>; // throws EEGRESSOFF if settings.plugins[id].networkEnabled !== true
    isEnabled(): boolean;
  };

  // capability: 'secrets' — namespaced to this plugin
  secrets?: {
    get(name: string): Promise<string | null>; // backed by secretStore key `plugin:<id>:<name>`
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };

  // capability: 'entity-registry'
  entities?: { /* create/read/link — mirrors src/main/storage/entities.ts surface */ };

  // capability: 'case-storage' — per-case sidecar files, vault-encrypted at rest
  caseStorage?: {
    readSidecar(caseId: string, name: string): Promise<string | null>; // secureReadText
    writeSidecar(caseId: string, name: string, data: string): Promise<void>; // secureWriteFile
  };

  // capability: 'timeline'
  timeline?: { append(caseId: string, event: TimelineEventInput): Promise<void> };
}
```

- **Egress is the load-bearing capability.** `ctx.egress.fetch` checks `settings.plugins[<id>].networkEnabled` (off by default), runs the URL through `src/main/security/validate.ts` validators, and routes through the bundled Tor SOCKS proxy by default (per-call `direct: true` override surfaces a `blocked` result rather than a silent direct call). This is how the OSINT plugin's tier-2 transforms inherit DCS98's egress discipline unchanged.
- A plugin **cannot** import `node:fs`, `electron`, or arbitrary core modules through the context — the context is the entire sanctioned surface. (It runs in main, so it *physically* can `require('fs')`; the capability model is a documented contract + defense-in-depth, not an OS sandbox. The signature is the real gate. This is stated honestly as a limitation, not oversold.)

---

## 6. Runtime module registration (the 5-point refactor)

Today a module is wired in 5 compile-time places (grounded paths):
- `ModuleKey` union — `src/renderer/state/store.ts:10`
- `GLYPHS` — `src/renderer/shell/Icon.tsx:110`
- `moduleTitles` — `src/renderer/shell/Desktop.tsx:31`
- `ModuleHost` switch — `src/renderer/shell/ModuleHost.tsx:35`
- shortcuts — `src/shared/types.ts:298`

**Refactor → `src/renderer/state/registry.ts`:**

```typescript
export interface ModuleDescriptor {
  key: string;                 // built-in ModuleKey OR namespaced 'plugin:sub'
  title: string;
  glyph: string;
  component: React.ComponentType<{ spec: WindowSpec }>;
  builtin: boolean;
}
const registry = new Map<string, ModuleDescriptor>();
export function registerModule(d: ModuleDescriptor): void;   // throws on duplicate key
export function getModule(key: string): ModuleDescriptor | undefined;
export function listModules(): ModuleDescriptor[];
```

- **Built-ins** register at renderer boot via a single `src/renderer/modules/register-builtins.ts` that calls `registerModule(...)` for each of the 27 existing modules, preserving today's titles/glyphs verbatim. `ModuleKey` stays a type for built-ins; the registry key widens to `string`.
- `ModuleHost.tsx` becomes: `const d = getModule(spec.module); return d ? <d.component spec={spec}/> : <ComingSoon .../>` — the 27-case switch is deleted.
- `Desktop.tsx` and `Icon.tsx` read title/glyph from the registry instead of the static maps.
- **Plugin modules** register when their `renderer.js` is imported: the chunk calls `registerModule({ key: 'osint:graph', ..., builtin: false })`. The plugin's renderer code receives `React` and the registry API via a small `window.dcs98Plugin` bridge (see §7) so it does not bundle its own React (avoids dual-React).
- **Shortcuts:** plugin-contributed modules get an Access-menu shortcut seeded once via the existing `reconcileShortcuts` mechanism (`src/shared/types.ts`), keyed by the namespaced module key, so a user can still remove it.

This refactor is behavior-preserving for built-ins and is independently testable (registry round-trip + ModuleHost renders the right component).

---

## 7. Renderer code loading + protocol + CSP

**Protocol (`src/main/plugins/protocol.ts`):** register `dcs98-plugin` privileged (mirroring `src/main/index.ts:21`):

```typescript
{ scheme: 'dcs98-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
```

Handler (`protocol.handle('dcs98-plugin', ...)`, installed after app.ready like `registerMediaProtocol`): map `dcs98-plugin://<id>/<path>` to `userData/plugins/<id>/<path>`, **path-confined** (reject `..`/absolute escapes), and serve **only** files belonging to a plugin that passed verification this session. Unverified id or escape → 404.

**CSP change** (`src/renderer/index.html:15`): add `dcs98-plugin:` to `script-src`. New value:
```
... script-src 'self' 'wasm-unsafe-eval' dcs98-plugin: ; ...
```
(`connect-src`/`img-src` already permit enough; add `dcs98-plugin:` to `connect-src` too so the chunk can `fetch` its own assets.) No `'unsafe-eval'`, no broad `file:`.

**Renderer import:** in `App.tsx` bootstrap, after settings load:
```typescript
for (const p of await window.api.plugins.listVerified()) {
  try { await import(/* @vite-ignore */ `dcs98-plugin://${p.id}/${p.renderer}`); }
  catch (e) { /* surface a non-fatal "plugin UI failed to load" toast; never crash the shell */ }
}
```

**The one spike (build-time, before the rest depends on it):** confirm Chromium permits dynamic ESM `import()` of a `dcs98-plugin://` URL under the amended CSP. `supportFetchAPI: true` + `standard: true` + `secure: true` strongly implies yes (the two existing schemes already serve fetchable, secure, standard content). Fallback if it fights us: fetch the chunk text over the protocol and instantiate via a Blob URL / `import(blobUrl)` (Blob URLs are already CSP-permitted via `worker-src blob:` precedent; would extend `script-src blob:`). The spike picks the path; the rest of the design is identical either way.

---

## 8. IPC surface

New channels in `src/shared/ipc-contracts.ts`:

```typescript
plugins: {
  listVerified: 'plugins:listVerified',   // → { id, name, version, modules, renderer }[]
  invoke:       'plugins:invoke',          // (id, name, args[]) → unknown ; routes to registered plugin handler
  status:       'plugins:status'           // → { id, loaded, error? }[]  (diagnostics)
}
```

- Handlers in `src/main/ipc/register.ts` via the existing `safeHandle` wrapper (inherits the vault-lock gate — correct, plugins are post-unlock).
- `plugins:invoke` dispatches to the plugin's `registerHandler`-registered functions (channel-internal map keyed by `<id>:<name>`); arguments are structured-clone-safe only.
- Preload (`src/preload/index.ts`) exposes `window.api.plugins.{listVerified,invoke,status}` and a separate **`window.dcs98Plugin`** bridge giving plugin renderer chunks `{ React, registerModule, api }` so they share the host's React/registry and call `api.plugins.invoke` rather than re-deriving IPC.

---

## 9. Core API version contract

- The core exports `PLUGIN_API_VERSION = 1` (integer) and a compat range `MIN_SUPPORTED = 1`.
- A plugin's `manifest.targetApiVersion` must satisfy `MIN_SUPPORTED <= target <= PLUGIN_API_VERSION`; otherwise the plugin is refused with a clear log (`incompatible API version`).
- The "API" under version control = the `PluginContext` surface (§5) + the `window.dcs98Plugin` renderer bridge (§7) + the manifest schema (§3). Breaking either bumps the integer. v1 freezes the surfaces in this document.

---

## 10. Settings additions

Add to `AppSettings` (`src/shared/types.ts`) and `defaultSettings`:

```typescript
plugins: Record<string, {
  enabled: boolean;        // default true once present; a disabled plugin is verified-but-not-loaded
  networkEnabled: boolean; // default FALSE — egress gate, mirrors geoint/markets/chat
  settings?: Record<string, unknown>; // per-plugin opaque config
}>;
```

Defaults: `plugins: {}`. Settings remain plaintext (the lock screen needs them pre-unlock), which is fine — these are flags, not secrets; secrets go to `secretStore`. A plugin reads/writes its own block via `window.api.settings.update({ plugins: { [id]: {...} } })`.

---

## 11. Lifecycle & failure modes (all fail-closed / fail-safe)

| Condition | Behavior |
|---|---|
| No `userData/plugins/` dir | Create empty; zero plugins; app boots normally |
| Bundle missing a required file | Skip plugin, log, continue |
| Signature invalid / either leg fails | Skip plugin, log `signature verification failed`, continue |
| Manifest invalid / unknown capability / bad id | Skip plugin, log, continue |
| Incompatible `targetApiVersion` | Skip plugin, log, continue |
| `enabled === false` in settings | Verified but not loaded (no main require, no renderer expose) |
| Main entry throws on `register(ctx)` | Catch, mark plugin errored (`plugins:status`), continue; its IPC handlers are not registered |
| Renderer chunk import throws | Non-fatal toast; shell unaffected |
| Egress called with `networkEnabled=false` | `ctx.egress.fetch` throws `EEGRESSOFF`; nothing leaves the box |

**Invariant:** a malformed, unsigned, tampered, or crashing plugin can never take down the DCS98 shell, and never gains a capability it did not declare and the operator did not enable.

---

## 12. Security invariants preserved (charter)

- **No telemetry / no phone-home** — the platform adds none; plugins get egress only through the gated, SSRF-validated, Tor-routed `ctx.egress.fetch`, off by default.
- **Egress off by default, enforced in main** — `settings.plugins[id].networkEnabled` defaults false; the gate is in main, not the renderer.
- **The loader is new attack surface; the signature is the boundary.** Loading code into main is exactly what the prior "no external-code plugins" decision avoided — that decision is *narrowed*, not reversed: only PQ-hybrid-signed, first-party code loads, verified before execution. This is stated as the central security tradeoff of the whole subsystem.
- **No weakening of existing gates** — vault lock gate (`safeHandle`), secrets backend, SSRF validators are reused, not bypassed.

---

## 13. Testing strategy

`test/` (Vitest), mocking `electron` + `fetch` per existing patterns (`test/geoint-egress.test.ts`, `test/chat-handshake.test.ts`):

- **verify.test.ts** — valid hybrid sig loads; tampered `main.js` fails; missing Ed leg fails; missing PQ leg fails; wrong pinned key fails; multi-pair keyring accepts the second pair. (Generates ephemeral test keypairs; signs a fixture bundle in-test.)
- **manifest.test.ts** — schema validation: bad id, unknown capability, non-namespaced module key, incompatible API version all rejected.
- **registry.test.ts** — register/get/list round-trip; duplicate-key throws; built-in seeding produces the 27 expected modules; ModuleHost picks the right component (render test).
- **context.test.ts** — capability scoping: absent capability not present; `egress.fetch` throws `EEGRESSOFF` when disabled and performs no fetch (spy asserts zero calls); secrets namespaced to `plugin:<id>:`.
- **loader.test.ts** — fixture-dir load: unsigned skipped, errored-main isolated, disabled-not-loaded; app-boot path tolerates a bad plugin.
- **Spike + manual smoke** (not headless-unit-testable): `dcs98-plugin://` dynamic import under CSP; a trivial signed fixture plugin that registers a "Hello" module and round-trips one `plugins:invoke`.

---

## 14. File-level change map

**Create (core):**
- `src/main/plugins/loader.ts` — discovery + orchestration
- `src/main/plugins/verify.ts` — hybrid signature verification
- `src/main/plugins/trust.ts` — pinned public-key list + `PLUGIN_API_VERSION`
- `src/main/plugins/context.ts` — capability-scoped `PluginContext` factory
- `src/main/plugins/protocol.ts` — `dcs98-plugin://` handler
- `src/main/plugins/manifest.ts` — manifest parse/validate
- `src/renderer/state/registry.ts` — runtime `ModuleRegistry`
- `src/renderer/modules/register-builtins.ts` — seed built-ins
- `src/shared/plugin-types.ts` — `PluginContext`, `ModuleDescriptor`, manifest types (shared main/renderer)
- tests per §13

**Modify (core):**
- `src/main/index.ts` — register `dcs98-plugin` scheme (`:21`); `await loadPlugins()` + `registerPluginProtocol()` in `whenReady` (`:~230`)
- `src/shared/ipc-contracts.ts` — `plugins` channels + contracts
- `src/main/ipc/register.ts` — `safeHandle` the new channels
- `src/preload/index.ts` — `window.api.plugins.*` + `window.dcs98Plugin` bridge
- `src/renderer/shell/ModuleHost.tsx` — render from registry (delete switch)
- `src/renderer/shell/Desktop.tsx`, `src/renderer/shell/Icon.tsx` — read registry
- `src/renderer/App.tsx` — import verified plugin renderer chunks on boot
- `src/shared/types.ts` — `AppSettings.plugins` + defaults
- `package.json` build (`extraResources`) — ensure `userData/plugins/` is a runtime dir (no bundling); version bump on release

**Private repo (subsystem 2, NOT this cycle):** the OSINT plugin sources + its own build + `scripts/sign-plugin.mjs`.

---

## 15. Plugin SDK summary (what subsystem 2 targets)

A plugin author (us) ships a directory with `manifest.json` (id, version, `targetApiVersion: 1`, declared `modules`/`capabilities`), a CJS `main.js` exporting `register(ctx: PluginContext)`, and an ESM `renderer.js` that, on import, calls `window.dcs98Plugin.registerModule({ key, title, glyph, component })` using `window.dcs98Plugin.React`. Main-side work (transforms, network, storage) goes through `ctx`; renderer↔main calls go through `window.dcs98Plugin.api.plugins.invoke(id, name, args)`. Built and signed with the operator's offline keys via `sign-plugin.mjs`. Everything the OSINT plugin needs — gated egress, secrets, entities, per-case sidecars, timeline, a UI module — is in `PluginContext` + the registry.

---

## 16. Open risks

1. **Custom-scheme dynamic `import()` under CSP** — the §7 spike; high confidence given the two existing privileged schemes, with a documented Blob-URL fallback.
2. **Dual-React** — mitigated by handing the plugin `window.dcs98Plugin.React` and marking React external in the plugin build; verify the plugin's renderer build externalizes React/ReactDOM.
3. **Capability honesty** — the context is a contract, not an OS sandbox; first-party-signed-only is what makes that acceptable. Documented, not oversold.
4. **Bundle size / artifact format** — extracted-dir vs zip handling at install; v1 assumes the directory already exists under `userData/plugins/` (manual extract / future installer). Delivery is subsystem-2 scope.
