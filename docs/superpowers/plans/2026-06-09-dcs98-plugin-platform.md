# DCS98 Plugin Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a signed-plugin platform to the DCS98 core so closed first-party plugins (first: the OSINT toolkit) load only after a PQ-hybrid signature verifies, scoped to declared capabilities, contributing renderer UI modules at runtime.

**Architecture:** A plugin is a directory under `userData/plugins/<id>/` (`manifest.json` + `main.js` + `renderer.js` + `signature.bin` + optional `assets/`). Main verifies an Ed25519∥ML-DSA-65 signature over a canonical hash of every file before `require`-ing the main entry with a capability-scoped `PluginContext`, and serves the renderer chunk over a privileged `dcs98-plugin://` scheme. A new runtime `ModuleRegistry` replaces the compile-time 5-point module wiring; verified renderer chunks register their module on dynamic import.

**Tech Stack:** Electron 33, React 18, TypeScript, Zustand, Vitest; `@noble/curves` (Ed25519), `@noble/post-quantum` (ML-DSA-65), `node:crypto` (SHA-512). Both noble packages are in `dependencies` and bundled into main by `electron.vite.config.ts`.

**Spec:** `docs/superpowers/specs/2026-06-09-dcs98-plugin-platform-design.md`

**Build order / de-risking:** Tasks 1–6 are pure logic (no Electron), fully unit-testable, and safe to build first. **Task 11 (protocol) + Task 16 (smoke) carry the one real risk — dynamic ESM `import()` of a `dcs98-plugin://` URL under CSP — so run a minimal version of that smoke as soon as Task 11 + Task 14 land, before investing in Task 15.** If the custom-scheme import is rejected by Chromium, switch to the Blob-URL fallback (noted in Task 11/15) and adjust those two tasks only.

**House rules:** TDD (failing test first). Typecheck with `pnpm typecheck` (runs BOTH `tsconfig.node.json` + `tsconfig.web.json`) — a bare `tsc` misses the other project and has bitten us before. Tests: `pnpm test` (Vitest). Tests live in `test/`. Mock `electron` and `fetch` per `test/geoint-egress.test.ts`.

---

## Task 1: Shared plugin types

**Files:**
- Create: `src/shared/plugin-types.ts`
- Test: `test/plugin-types.test.ts`

- [ ] **Step 1: Write the failing test** (`test/plugin-types.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { CAPABILITIES, type Capability, type PluginManifest } from '../src/shared/plugin-types';

describe('plugin-types', () => {
  it('exposes the closed capability set', () => {
    expect([...CAPABILITIES].sort()).toEqual(
      ['case-storage', 'egress', 'entity-registry', 'plugin-storage', 'secrets', 'timeline']
    );
  });

  it('a well-formed manifest object is assignable to PluginManifest', () => {
    const m: PluginManifest = {
      id: 'osint', name: 'OSINT', version: '1.0.0', targetApiVersion: 1,
      modules: [{ key: 'osint:graph', title: 'OSINT', glyph: '🕸' }],
      capabilities: ['egress'] as Capability[], main: 'main.js', renderer: 'renderer.js'
    };
    expect(m.id).toBe('osint');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-types` → Expected: FAIL (`Cannot find module '../src/shared/plugin-types'`).

- [ ] **Step 3: Write minimal implementation** (`src/shared/plugin-types.ts`)

```typescript
/** Shared between main, preload, and renderer. The frozen v1 plugin contract surface. */

export const CAPABILITIES = [
  'egress', 'secrets', 'case-storage', 'plugin-storage', 'entity-registry', 'timeline'
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface PluginModuleDecl {
  key: string; // `<id>:<sub>`, namespaced
  title: string;
  glyph: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  targetApiVersion: number;
  modules: PluginModuleDecl[];
  capabilities: Capability[];
  main: string;
  renderer: string;
}

/** Returned to the renderer by `plugins:listVerified`. */
export interface VerifiedPluginInfo {
  id: string;
  name: string;
  version: string;
  modules: PluginModuleDecl[];
  renderer: string; // relative path, e.g. 'renderer.js'
}

export interface PluginStatus {
  id: string;
  loaded: boolean;
  error?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-types` → Expected: PASS. Then `pnpm typecheck` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/plugin-types.ts test/plugin-types.test.ts
git commit -m "feat(plugins): shared plugin contract types"
```

---

## Task 2: Trust root + API version

**Files:**
- Create: `src/main/plugins/trust.ts`
- Test: `test/plugin-trust.test.ts`

- [ ] **Step 1: Write the failing test** (`test/plugin-trust.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { isApiCompatible, PLUGIN_API_VERSION, MIN_SUPPORTED_API_VERSION, PINNED_KEYSETS } from '../src/main/plugins/trust';

describe('plugin trust', () => {
  it('current version is compatible; out-of-range and non-integers are not', () => {
    expect(isApiCompatible(PLUGIN_API_VERSION)).toBe(true);
    expect(isApiCompatible(MIN_SUPPORTED_API_VERSION)).toBe(true);
    expect(isApiCompatible(PLUGIN_API_VERSION + 1)).toBe(false);
    expect(isApiCompatible(0)).toBe(false);
    expect(isApiCompatible(1.5)).toBe(false);
  });

  it('PINNED_KEYSETS is an array (may be empty until the dev/release key is pinned)', () => {
    expect(Array.isArray(PINNED_KEYSETS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-trust` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/trust.ts`)

```typescript
/**
 * Plugin trust root. PINNED_KEYSETS holds the public keys the core will accept plugin
 * signatures from. Verification passes if ANY one keyset validates BOTH legs (Ed25519 ∥ ML-DSA-65).
 * Private keys live OFFLINE with the operator and never touch this repo. The keyset(s) below are
 * a DEV key for local smoke testing — the operator replaces them with the offline release key
 * (see scripts/gen-plugin-devkey.mjs and Task 16) before any public release.
 */
export interface TrustKeyset {
  edPub: Uint8Array; // 32 bytes
  pqPub: Uint8Array; // ML-DSA-65 public key
}

export const PLUGIN_API_VERSION = 1;
export const MIN_SUPPORTED_API_VERSION = 1;

export function isApiCompatible(target: number): boolean {
  return (
    Number.isInteger(target) &&
    target >= MIN_SUPPORTED_API_VERSION &&
    target <= PLUGIN_API_VERSION
  );
}

// Filled by Task 16 with the generated dev keyset (hex-decoded). Empty here = no plugin loads.
export const PINNED_KEYSETS: TrustKeyset[] = [];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-trust` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/trust.ts test/plugin-trust.test.ts
git commit -m "feat(plugins): trust keyset list + API version compat"
```

---

## Task 3: Manifest parse + validate

**Files:**
- Create: `src/main/plugins/manifest.ts`
- Test: `test/plugin-manifest.test.ts`

- [ ] **Step 1: Write the failing test** (`test/plugin-manifest.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { parseManifest, ManifestError } from '../src/main/plugins/manifest';

const good = {
  id: 'osint', name: 'OSINT', version: '1.0.0', targetApiVersion: 1,
  modules: [{ key: 'osint:graph', title: 'OSINT', glyph: '🕸' }],
  capabilities: ['egress', 'plugin-storage'], main: 'main.js', renderer: 'renderer.js'
};

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest(good);
    expect(m.id).toBe('osint');
    expect(m.modules[0].key).toBe('osint:graph');
  });

  it('rejects a bad id', () => {
    expect(() => parseManifest({ ...good, id: 'OSINT!' })).toThrow(ManifestError);
  });

  it('rejects an unknown capability', () => {
    expect(() => parseManifest({ ...good, capabilities: ['egress', 'rootkit'] })).toThrow(ManifestError);
  });

  it('rejects a module key not namespaced to the plugin id', () => {
    expect(() => parseManifest({ ...good, modules: [{ key: 'other:graph', title: 'X', glyph: 'x' }] }))
      .toThrow(ManifestError);
  });

  it('rejects a non-object', () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest('{}')).toThrow(ManifestError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-manifest` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/manifest.ts`)

```typescript
import { CAPABILITIES, type Capability, type PluginManifest, type PluginModuleDecl } from '../../shared/plugin-types';

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ID_RE = /^[a-z][a-z0-9-]{2,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SUB_RE = /^[a-z0-9-]{1,32}$/;
const CAP_SET = new Set<string>(CAPABILITIES);

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) throw new ManifestError(`manifest.${k} must be a non-empty string`);
  return v;
}

export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestError('manifest must be a JSON object');
  }
  const o = raw as Record<string, unknown>;

  const id = str(o, 'id');
  if (!ID_RE.test(id)) throw new ManifestError(`manifest.id "${id}" must match ${ID_RE}`);

  const name = str(o, 'name');
  const version = str(o, 'version');
  if (!SEMVER_RE.test(version)) throw new ManifestError(`manifest.version "${version}" is not semver`);

  if (!Number.isInteger(o['targetApiVersion'])) throw new ManifestError('manifest.targetApiVersion must be an integer');
  const targetApiVersion = o['targetApiVersion'] as number;

  if (!Array.isArray(o['modules']) || o['modules'].length === 0) {
    throw new ManifestError('manifest.modules must be a non-empty array');
  }
  const modules: PluginModuleDecl[] = (o['modules'] as unknown[]).map((mu, i) => {
    if (typeof mu !== 'object' || mu === null) throw new ManifestError(`manifest.modules[${i}] must be an object`);
    const mo = mu as Record<string, unknown>;
    const key = str(mo, 'key');
    const [ns, sub, ...rest] = key.split(':');
    if (rest.length > 0 || ns !== id || !SUB_RE.test(sub ?? '')) {
      throw new ManifestError(`manifest.modules[${i}].key "${key}" must be "${id}:<sub>" with sub matching ${SUB_RE}`);
    }
    return { key, title: str(mo, 'title'), glyph: str(mo, 'glyph') };
  });

  if (!Array.isArray(o['capabilities'])) throw new ManifestError('manifest.capabilities must be an array');
  const capabilities: Capability[] = (o['capabilities'] as unknown[]).map((c, i) => {
    if (typeof c !== 'string' || !CAP_SET.has(c)) throw new ManifestError(`manifest.capabilities[${i}] "${String(c)}" is not a known capability`);
    return c as Capability;
  });

  const main = str(o, 'main');
  const renderer = str(o, 'renderer');

  return { id, name, version, targetApiVersion, modules, capabilities, main, renderer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-manifest` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/manifest.ts test/plugin-manifest.test.ts
git commit -m "feat(plugins): manifest parse + validation"
```

---

## Task 4: Canonical hash + PQ-hybrid signature verification

**Files:**
- Create: `src/main/plugins/verify.ts`
- Test: `test/plugin-verify.test.ts`

- [ ] **Step 1: Confirm the ML-DSA-65 API from the installed package (do NOT guess)**

Run: `cat node_modules/@noble/post-quantum/ml-dsa.d.ts | head -60` and confirm the export name (`ml_dsa65`), the import subpath (`@noble/post-quantum/ml-dsa.js`), and the **exact argument order** of `keygen`, `sign`, and `verify`. The code below assumes `ml_dsa65.sign(secretKey, msg)` and `ml_dsa65.verify(publicKey, msg, sig)`; if the installed types differ, adjust the calls in this task AND Task 16's signing script to match. (Ed25519 is known from `src/main/chat/crypto.ts`: `ed25519.sign(message, secretKey)`, `ed25519.verify(sig, message, pub)`.)

- [ ] **Step 2: Write the failing test** (`test/plugin-verify.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canonicalPluginHash, verifyPluginSignature, type PluginParts } from '../src/main/plugins/verify';
import type { TrustKeyset } from '../src/main/plugins/trust';

function makeKeyset(): { keyset: TrustKeyset; edSec: Uint8Array; pqSec: Uint8Array } {
  const edSec = ed25519.utils.randomPrivateKey();
  const edPub = ed25519.getPublicKey(edSec);
  const pq = ml_dsa65.keygen();
  return { keyset: { edPub, pqPub: pq.publicKey }, edSec, pqSec: pq.secretKey };
}

function sign(hash: Uint8Array, edSec: Uint8Array, pqSec: Uint8Array): Uint8Array {
  const ed = ed25519.sign(hash, edSec);
  const pq = ml_dsa65.sign(pqSec, hash);
  const out = new Uint8Array(ed.length + pq.length);
  out.set(ed, 0); out.set(pq, ed.length);
  return out;
}

const parts: PluginParts = {
  manifest: Buffer.from('{"id":"x"}'), main: Buffer.from('MAIN'), renderer: Buffer.from('REND'), assets: []
};

describe('plugin verify', () => {
  it('a valid hybrid signature verifies', () => {
    const { keyset, edSec, pqSec } = makeKeyset();
    const h = canonicalPluginHash(parts);
    const sig = sign(h, edSec, pqSec);
    expect(verifyPluginSignature(h, sig, [keyset])).toBe(true);
  });

  it('tampered content fails', () => {
    const { keyset, edSec, pqSec } = makeKeyset();
    const sig = sign(canonicalPluginHash(parts), edSec, pqSec);
    const tampered = canonicalPluginHash({ ...parts, main: Buffer.from('EVIL') });
    expect(verifyPluginSignature(tampered, sig, [keyset])).toBe(false);
  });

  it('a forged Ed leg fails even with a valid PQ leg', () => {
    const { keyset, pqSec } = makeKeyset();
    const h = canonicalPluginHash(parts);
    const badEd = new Uint8Array(64); // zeros
    const pq = ml_dsa65.sign(pqSec, h);
    const sig = new Uint8Array(64 + pq.length); sig.set(badEd, 0); sig.set(pq, 64);
    expect(verifyPluginSignature(h, sig, [keyset])).toBe(false);
  });

  it('a wrong keyset fails', () => {
    const a = makeKeyset(); const b = makeKeyset();
    const h = canonicalPluginHash(parts);
    const sig = sign(h, a.edSec, a.pqSec);
    expect(verifyPluginSignature(h, sig, [b.keyset])).toBe(false);
  });

  it('accepts a second pinned keyset (rotation)', () => {
    const a = makeKeyset(); const b = makeKeyset();
    const h = canonicalPluginHash(parts);
    const sig = sign(h, b.edSec, b.pqSec);
    expect(verifyPluginSignature(h, sig, [a.keyset, b.keyset])).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test plugin-verify` → Expected: FAIL (module not found).

- [ ] **Step 4: Write minimal implementation** (`src/main/plugins/verify.ts`)

```typescript
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { TrustKeyset } from './trust';

const DOMAIN = Buffer.from('DCS98-PLUGIN-v1');
const ED_SIG_LEN = 64;

export interface PluginAsset { path: string; bytes: Buffer; }
export interface PluginParts {
  manifest: Buffer;
  main: Buffer;
  renderer: Buffer;
  assets: PluginAsset[];
}

function lenPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(8);
  len.writeBigUInt64BE(BigInt(buf.length));
  return Buffer.concat([len, buf]);
}

/** SHA-512 over DOMAIN ∥ 0x00 ∥ len(manifest) ∥ len(main) ∥ len(renderer) ∥ for each sorted asset: len(path ∥ 0 ∥ bytes). */
export function canonicalPluginHash(p: PluginParts): Buffer {
  const h = createHash('sha512');
  h.update(DOMAIN);
  h.update(Buffer.from([0]));
  h.update(lenPrefixed(p.manifest));
  h.update(lenPrefixed(p.main));
  h.update(lenPrefixed(p.renderer));
  const sorted = [...p.assets].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const a of sorted) {
    h.update(lenPrefixed(Buffer.concat([Buffer.from(a.path), Buffer.from([0]), a.bytes])));
  }
  return h.digest();
}

/** True iff SOME keyset validates BOTH the Ed25519 and ML-DSA-65 legs. Fail-closed on any error. */
export function verifyPluginSignature(hash: Uint8Array, signature: Uint8Array, keysets: TrustKeyset[]): boolean {
  if (signature.length <= ED_SIG_LEN) return false;
  const edSig = signature.subarray(0, ED_SIG_LEN);
  const pqSig = signature.subarray(ED_SIG_LEN);
  for (const k of keysets) {
    try {
      if (ed25519.verify(edSig, hash, k.edPub) && ml_dsa65.verify(k.pqPub, hash, pqSig)) return true;
    } catch {
      /* try next keyset */
    }
  }
  return false;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test plugin-verify` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/plugins/verify.ts test/plugin-verify.test.ts
git commit -m "feat(plugins): canonical hash + PQ-hybrid signature verification"
```

---

## Task 5: Capability-scoped PluginContext

**Files:**
- Create: `src/main/plugins/context.ts`
- Test: `test/plugin-context.test.ts`

- [ ] **Step 1: Write the failing test** (`test/plugin-context.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createPluginContext, type ContextDeps } from '../src/main/plugins/context';

function deps(networkEnabled: boolean): ContextDeps {
  return {
    isNetworkEnabled: (id) => networkEnabled,
    rawFetch: vi.fn(async () => ({ status: 200, body: 'ok', finalUrl: 'https://x' })),
    validateUrl: (u) => u,
    secretBackend: { get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    entities: {} as never,
    timelineAppend: vi.fn(async () => {}),
    caseSidecar: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
    pluginStore: { read: vi.fn(async () => null), write: vi.fn(async () => {}), list: vi.fn(async () => []), delete: vi.fn(async () => {}) }
  };
}

describe('PluginContext capability scoping', () => {
  it('only declared capabilities are present', () => {
    const ctx = createPluginContext('osint', ['egress'], deps(true));
    expect(ctx.egress).toBeDefined();
    expect(ctx.secrets).toBeUndefined();
    expect(ctx.storage).toBeUndefined();
    expect(typeof ctx.registerHandler).toBe('function'); // always present
  });

  it('egress.fetch throws EEGRESSOFF and performs no fetch when disabled', async () => {
    const d = deps(false);
    const ctx = createPluginContext('osint', ['egress'], d);
    await expect(ctx.egress!.fetch('https://x')).rejects.toThrow(/EEGRESSOFF/);
    expect(d.rawFetch).not.toHaveBeenCalled();
  });

  it('secrets are namespaced to plugin:<id>:', async () => {
    const d = deps(true);
    const ctx = createPluginContext('osint', ['secrets'], d);
    await ctx.secrets!.set('shodan', 'k');
    expect(d.secretBackend.set).toHaveBeenCalledWith('plugin:osint:shodan', 'k');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-context` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/context.ts`)

```typescript
import type { Capability } from '../../shared/plugin-types';

export interface PluginFetchInit { method?: string; headers?: Record<string, string>; body?: string; direct?: boolean; }
export interface PluginFetchResponse { status: number; body: string; finalUrl: string; blocked?: boolean; }

export interface ContextDeps {
  isNetworkEnabled(id: string): boolean;
  rawFetch(url: string, init: PluginFetchInit): Promise<PluginFetchResponse>;
  validateUrl(url: string): string; // throws if SSRF-invalid
  secretBackend: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; delete(k: string): Promise<void> };
  entities: unknown; // entity-registry surface, wired in Task 9/loader
  timelineAppend(caseId: string, event: unknown): Promise<void>;
  caseSidecar: { read(caseId: string, name: string): Promise<string | null>; write(caseId: string, name: string, data: string): Promise<void> };
  pluginStore: { read(id: string, rel: string): Promise<Uint8Array | null>; write(id: string, rel: string, data: Uint8Array | string): Promise<void>; list(id: string, rel?: string): Promise<string[]>; delete(id: string, rel: string): Promise<void> };
}

export interface PluginContext {
  readonly id: string;
  readonly logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
  registerHandler(name: string, fn: (...args: unknown[]) => unknown): void;
  egress?: { fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>; isEnabled(): boolean };
  secrets?: { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<void> };
  entities?: unknown;
  timeline?: { append(caseId: string, event: unknown): Promise<void> };
  caseStorage?: { readSidecar(caseId: string, name: string): Promise<string | null>; writeSidecar(caseId: string, name: string, data: string): Promise<void> };
  storage?: { read(rel: string): Promise<Uint8Array | null>; write(rel: string, data: Uint8Array | string): Promise<void>; list(rel?: string): Promise<string[]>; delete(rel: string): Promise<void> };
}

export function createPluginContext(
  id: string,
  capabilities: Capability[],
  deps: ContextDeps,
  handlers: Map<string, (...args: unknown[]) => unknown> = new Map()
): PluginContext {
  const has = (c: Capability): boolean => capabilities.includes(c);
  const ctx: PluginContext = {
    id,
    logger: {
      info: (m) => console.log(`[plugin:${id}]`, m),
      warn: (m) => console.warn(`[plugin:${id}]`, m),
      error: (m) => console.error(`[plugin:${id}]`, m)
    },
    registerHandler(name, fn) { handlers.set(`${id}:${name}`, fn); }
  };

  if (has('egress')) {
    ctx.egress = {
      isEnabled: () => deps.isNetworkEnabled(id),
      async fetch(url, init = {}) {
        if (!deps.isNetworkEnabled(id)) {
          const e = new Error('EEGRESSOFF: plugin network is disabled');
          e.name = 'EEGRESSOFF';
          throw e;
        }
        const safe = deps.validateUrl(url);
        return deps.rawFetch(safe, init);
      }
    };
  }
  if (has('secrets')) {
    ctx.secrets = {
      get: (name) => deps.secretBackend.get(`plugin:${id}:${name}`),
      set: (name, v) => deps.secretBackend.set(`plugin:${id}:${name}`, v),
      delete: (name) => deps.secretBackend.delete(`plugin:${id}:${name}`)
    };
  }
  if (has('entity-registry')) ctx.entities = deps.entities;
  if (has('timeline')) ctx.timeline = { append: (caseId, event) => deps.timelineAppend(caseId, event) };
  if (has('case-storage')) {
    ctx.caseStorage = {
      readSidecar: (caseId, name) => deps.caseSidecar.read(caseId, name),
      writeSidecar: (caseId, name, data) => deps.caseSidecar.write(caseId, name, data)
    };
  }
  if (has('plugin-storage')) {
    ctx.storage = {
      read: (rel) => deps.pluginStore.read(id, rel),
      write: (rel, data) => deps.pluginStore.write(id, rel, data),
      list: (rel) => deps.pluginStore.list(id, rel),
      delete: (rel) => deps.pluginStore.delete(id, rel)
    };
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-context` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/context.ts test/plugin-context.test.ts
git commit -m "feat(plugins): capability-scoped PluginContext"
```

---

## Task 6: Renderer ModuleRegistry

**Files:**
- Create: `src/renderer/state/registry.ts`
- Test: `test/module-registry.test.ts`

- [ ] **Step 1: Write the failing test** (`test/module-registry.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { registerModule, getModule, listModules, _resetRegistryForTest, type ModuleDescriptor } from '../src/renderer/state/registry';

const Dummy = (() => null) as unknown as ModuleDescriptor['component'];

describe('ModuleRegistry', () => {
  beforeEach(() => _resetRegistryForTest());

  it('register / get / list round-trips', () => {
    registerModule({ key: 'cases', title: 'My Cases', glyph: '📁', component: Dummy, builtin: true });
    expect(getModule('cases')?.title).toBe('My Cases');
    expect(listModules().map((m) => m.key)).toContain('cases');
  });

  it('duplicate key throws', () => {
    registerModule({ key: 'cases', title: 'A', glyph: 'a', component: Dummy, builtin: true });
    expect(() => registerModule({ key: 'cases', title: 'B', glyph: 'b', component: Dummy, builtin: false })).toThrow();
  });

  it('unknown key returns undefined', () => {
    expect(getModule('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test module-registry` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/renderer/state/registry.ts`)

```typescript
import type React from 'react';
import type { WindowSpec } from './store';

export interface ModuleDescriptor {
  key: string;
  title: string;
  glyph: string;
  component: React.ComponentType<{ spec: WindowSpec }>;
  builtin: boolean;
}

const registry = new Map<string, ModuleDescriptor>();

export function registerModule(d: ModuleDescriptor): void {
  if (registry.has(d.key)) throw new Error(`module key already registered: ${d.key}`);
  registry.set(d.key, d);
}
export function getModule(key: string): ModuleDescriptor | undefined {
  return registry.get(key);
}
export function listModules(): ModuleDescriptor[] {
  return [...registry.values()];
}
/** test-only */
export function _resetRegistryForTest(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test module-registry` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/registry.ts test/module-registry.test.ts
git commit -m "feat(plugins): runtime ModuleRegistry"
```

---

## Task 7: Seed built-in modules into the registry

**Files:**
- Create: `src/renderer/modules/register-builtins.ts`
- Test: `test/register-builtins.test.ts`

**Context:** `ModuleHost.tsx` currently imports all module components and switches on `spec.module` (27 cases, `src/renderer/shell/ModuleHost.tsx:35`). This task moves the (component, title, glyph) triple for every built-in into one registration function, the single source of truth that the registry is seeded with. Pull titles verbatim from `moduleTitles` (`src/renderer/shell/Desktop.tsx:31`) and glyphs from `GLYPHS` (`src/renderer/shell/Icon.tsx:110`).

- [ ] **Step 1: Write the failing test** (`test/register-builtins.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { _resetRegistryForTest, listModules } from '../src/renderer/state/registry';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';

describe('registerBuiltins', () => {
  beforeEach(() => _resetRegistryForTest());

  it('registers every built-in ModuleKey exactly once', () => {
    registerBuiltins();
    const keys = listModules().map((m) => m.key).sort();
    expect(keys).toEqual([
      'ai-assistant', 'alarm', 'bookmarks', 'briefcase', 'calendar', 'cases', 'chat', 'chess',
      'dialterm', 'doc-viewer', 'eyespy', 'geoint', 'help', 'mail', 'markets', 'media-player',
      'minesweeper', 'net-explorer', 'notepad', 'pinball', 'reminders', 'search', 'settings',
      'shred', 'solitaire', 'whiteboard'
    ].sort());
    expect(listModules().every((m) => m.builtin)).toBe(true);
  });

  it('is idempotent-safe to call once (second call throws on duplicate)', () => {
    registerBuiltins();
    expect(() => registerBuiltins()).toThrow();
  });
});
```

Note: the 26-key list above is the 27 ModuleKeys minus none — count them against `ModuleKey` in `src/renderer/state/store.ts:10` when implementing; if the union has changed, update the expected array to match the union exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test register-builtins` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/renderer/modules/register-builtins.ts`)

Move the component imports out of `ModuleHost.tsx` into here, and register each with its title + glyph. Wrap components whose props differ (e.g. `cases` reads `spec.props.caseId`) in a tiny adapter so every registered component has the uniform `{ spec }` signature.

```typescript
import { registerModule } from '../state/registry';
import type { WindowSpec } from '../state/store';
import { CasesModule } from './cases/CasesModule';
import { NotepadModule } from './notepad/NotepadModule';
// ...import the remaining 25 module components (copy the import list from ModuleHost.tsx)...
import { HelpModule } from './help/HelpModule';

// Adapters: today ModuleHost passes specific props from spec.props to some modules.
// Preserve that exactly by reading the same keys here.
const Cases = ({ spec }: { spec: WindowSpec }) => (
  <CasesModule initialCaseId={spec.props?.['caseId'] as string | undefined} />
);
const Notepad = ({ spec }: { spec: WindowSpec }) => (
  <NotepadModule
    initialCaseId={spec.props?.['caseId'] as string | undefined}
    initialNoteName={spec.props?.['initialNoteName'] as string | undefined}
  />
);
// ...adapters for doc-viewer (caseId, fileName, originalName) and any other prop-taking modules,
//    matching ModuleHost.tsx's current cases verbatim...

export function registerBuiltins(): void {
  registerModule({ key: 'cases', title: 'My Cases', glyph: '📁', component: Cases, builtin: true });
  registerModule({ key: 'notepad', title: 'Notepad 98', glyph: '🗒', component: Notepad, builtin: true });
  // ...register the remaining 25, title verbatim from Desktop.tsx moduleTitles, glyph from Icon.tsx GLYPHS...
  registerModule({ key: 'help', title: 'RTFM', glyph: '?', component: ({ spec: _spec }) => <HelpModule />, builtin: true });
}
```

(This is a `.tsx` file because of JSX — name it `register-builtins.tsx`. Update the test import accordingly: `from '../src/renderer/modules/register-builtins'` resolves `.tsx`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test register-builtins` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/register-builtins.tsx test/register-builtins.test.ts
git commit -m "feat(plugins): seed built-in modules into the registry"
```

---

## Task 8: ModuleHost / Desktop / Icon read from the registry

**Files:**
- Modify: `src/renderer/shell/ModuleHost.tsx`
- Modify: `src/renderer/shell/Desktop.tsx`
- Modify: `src/renderer/shell/Icon.tsx`
- Modify: `src/renderer/main.tsx` (call `registerBuiltins()` once at boot, before render)
- Test: `test/module-host.test.tsx`

- [ ] **Step 1: Write the failing test** (`test/module-host.test.tsx`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react'; // if not present, assert via getModule instead (see note)
import { _resetRegistryForTest, registerModule } from '../src/renderer/state/registry';
import { ModuleHost } from '../src/renderer/shell/ModuleHost';

describe('ModuleHost renders from the registry', () => {
  beforeEach(() => _resetRegistryForTest());

  it('renders the registered component for the spec module key', () => {
    registerModule({ key: 'demo', title: 'Demo', glyph: 'd', builtin: false,
      component: () => <div data-testid="demo">hi</div> });
    const { getByTestId } = render(<ModuleHost spec={{ id: 'w1', module: 'demo', title: 'Demo' }} />);
    expect(getByTestId('demo').textContent).toBe('hi');
  });

  it('falls back to ComingSoon for an unknown key', () => {
    const { container } = render(<ModuleHost spec={{ id: 'w2', module: 'nope', title: 'x' }} />);
    expect(container.textContent).toContain('No module registered');
  });
});
```

Note: if `@testing-library/react` is not a dependency, do NOT add it. Instead test the pure selection helper: extract `function selectComponent(key: string)` from ModuleHost that returns `getModule(key)?.component ?? ComingSoonFor(key)` and unit-test that it returns the right component reference. Prefer this if RTL is absent — check `package.json` devDependencies first.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test module-host` → Expected: FAIL.

- [ ] **Step 3: Refactor `ModuleHost.tsx`**

Replace the 27-case switch with a registry lookup:

```typescript
import { getModule } from '../state/registry';
import { ComingSoon } from './ComingSoon'; // existing fallback component, or inline as today
import type { WindowSpec } from '../state/store';

export function ModuleHost({ spec }: { spec: WindowSpec }): JSX.Element {
  const d = getModule(spec.module);
  if (!d) return <ComingSoon name={spec.module} detail="No module registered for this key." />;
  const C = d.component;
  return <C spec={spec} />;
}
```

Delete the now-unused per-module imports from `ModuleHost.tsx` (they live in `register-builtins.tsx` now). `WindowSpec.module` widens from `ModuleKey` to `string` (Task 6's descriptor key is `string`) — confirm `store.ts` `WindowSpec.module` type; if it is `ModuleKey`, change it to `string` here in Task 8 and update `open()` callers (they pass string literals, so they still type-check).

- [ ] **Step 4: Point Desktop + Icon at the registry**

In `Desktop.tsx`, replace `moduleTitles[key]` lookups with `getModule(key)?.title ?? key`. In `Icon.tsx`, replace `GLYPHS[m]` with `getModule(m)?.glyph ?? '▢'`. Keep the `glyphNodeFor` custom-SVG path for `cases`/`notepad` as-is (those are SVG, not registry glyphs).

- [ ] **Step 5: Seed at boot** — in `src/renderer/main.tsx`, before `createRoot(...).render(...)`:

```typescript
import { registerBuiltins } from './modules/register-builtins';
registerBuiltins();
```

- [ ] **Step 6: Run tests + typecheck + full suite**

Run: `pnpm test module-host` → PASS. `pnpm typecheck` → clean. `pnpm test` → all green (the refactor must not regress any existing module test).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/shell/ModuleHost.tsx src/renderer/shell/Desktop.tsx src/renderer/shell/Icon.tsx src/renderer/main.tsx test/module-host.test.tsx
git commit -m "refactor(plugins): render modules from the runtime registry"
```

---

## Task 9: Loader — discover, verify, load (main)

**Files:**
- Create: `src/main/plugins/loader.ts`
- Test: `test/plugin-loader.test.ts`

**Context:** Orchestrates discovery + verification + main-entry load. It reads each `userData/plugins/<id>/`, parses+validates the manifest (Task 3), checks API compat (Task 2), reads files, computes the canonical hash and verifies the hybrid signature (Task 4), and on success `require`s `<dir>/main.js` and invokes its `register(ctx)` with a capability-scoped context (Task 5). All failures are isolated and logged; nothing throws out of `loadPlugins`.

- [ ] **Step 1: Write the failing test** (`test/plugin-loader.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { canonicalPluginHash } from '../src/main/plugins/verify';

const ROOT = mkdtempSync(join(tmpdir(), 'dcs98-plug-'));
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { loadPlugins, getVerified, getStatus, _resetLoaderForTest } from '../src/main/plugins/loader';
import * as trust from '../src/main/plugins/trust';

function writePlugin(id: string, sign: boolean) {
  const dir = join(ROOT, 'plugins', id);
  mkdirSync(dir, { recursive: true });
  const manifest = JSON.stringify({ id, name: id, version: '1.0.0', targetApiVersion: 1,
    modules: [{ key: `${id}:m`, title: id, glyph: 'x' }], capabilities: [], main: 'main.js', renderer: 'renderer.js' });
  const main = `module.exports.register = (ctx) => { globalThis.__loaded = (globalThis.__loaded||[]).concat(ctx.id); };`;
  const rend = `export const x = 1;`;
  writeFileSync(join(dir, 'manifest.json'), manifest);
  writeFileSync(join(dir, 'main.js'), main);
  writeFileSync(join(dir, 'renderer.js'), rend);
  const hash = canonicalPluginHash({ manifest: Buffer.from(manifest), main: Buffer.from(main), renderer: Buffer.from(rend), assets: [] });
  let sig = new Uint8Array(64 + 100);
  if (sign) {
    const ed = ed25519.sign(hash, ED_SEC);
    const pq = ml_dsa65.sign(PQ_SEC, hash);
    sig = new Uint8Array(ed.length + pq.length); sig.set(ed, 0); sig.set(pq, ed.length);
  }
  writeFileSync(join(dir, 'signature.bin'), Buffer.from(sig));
}

const ED_SEC = ed25519.utils.randomPrivateKey();
const PQ = ml_dsa65.keygen();
const PQ_SEC = PQ.secretKey;

beforeEach(() => {
  _resetLoaderForTest();
  (globalThis as Record<string, unknown>).__loaded = [];
  vi.spyOn(trust, 'PINNED_KEYSETS', 'get').mockReturnValue([{ edPub: ed25519.getPublicKey(ED_SEC), pqPub: PQ.publicKey }]);
});

describe('loadPlugins', () => {
  it('loads a validly-signed plugin and skips an unsigned one', async () => {
    writePlugin('good', true);
    writePlugin('bad', false);
    await loadPlugins({ isEnabled: () => true });
    expect((globalThis as Record<string, unknown>).__loaded).toEqual(['good']);
    expect(getVerified().map((v) => v.id)).toEqual(['good']);
    expect(getStatus().find((s) => s.id === 'bad')?.loaded).toBe(false);
  });

  it('does not throw when the plugins dir is absent', async () => {
    rmSync(join(ROOT, 'plugins'), { recursive: true, force: true });
    await expect(loadPlugins({ isEnabled: () => true })).resolves.toBeUndefined();
  });
});
```

Note: `PINNED_KEYSETS` is a `const` export; if `vi.spyOn(...,'get')` cannot stub it, refactor `trust.ts` to expose `getPinnedKeysets()` (a function) and have the loader call that — adjust Task 2 + Task 4 callers to use the function. Decide this when implementing; the function form is more testable, prefer it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-loader` → Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/loader.ts`)

```typescript
import { app } from 'electron';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest } from './manifest';
import { canonicalPluginHash, verifyPluginSignature, type PluginAsset } from './verify';
import { getPinnedKeysets } from './trust';
import { isApiCompatible } from './trust';
import { createPluginContext, type ContextDeps } from './context';
import type { VerifiedPluginInfo, PluginStatus } from '../../shared/plugin-types';

const verified: VerifiedPluginInfo[] = [];
const status: PluginStatus[] = [];
const handlers = new Map<string, (...args: unknown[]) => unknown>();

export function getVerified(): VerifiedPluginInfo[] { return [...verified]; }
export function getStatus(): PluginStatus[] { return [...status]; }
export function getHandlers(): Map<string, (...args: unknown[]) => unknown> { return handlers; }
export function _resetLoaderForTest(): void { verified.length = 0; status.length = 0; handlers.clear(); }

export interface LoaderOptions {
  isEnabled(id: string): boolean; // settings.plugins[id].enabled
  contextDeps?: Partial<ContextDeps>; // real deps injected by main wiring (Task 14)
}

function readAssets(dir: string): PluginAsset[] {
  const adir = join(dir, 'assets');
  if (!existsSync(adir)) return [];
  const out: PluginAsset[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(adir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const full = join(adir, r);
      if (statSync(full).isDirectory()) walk(r);
      else out.push({ path: r, bytes: readFileSync(full) });
    }
  };
  walk('');
  return out;
}

export async function loadPlugins(opts: LoaderOptions): Promise<void> {
  const root = join(app.getPath('userData'), 'plugins');
  if (!existsSync(root)) return;
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const manifestBuf = readFileSync(join(dir, 'manifest.json'));
      const manifest = parseManifest(JSON.parse(manifestBuf.toString('utf8')));
      if (manifest.id !== id) throw new Error(`manifest.id "${manifest.id}" != dir "${id}"`);
      if (!isApiCompatible(manifest.targetApiVersion)) throw new Error('incompatible API version');

      const mainBuf = readFileSync(join(dir, manifest.main));
      const rendBuf = readFileSync(join(dir, manifest.renderer));
      const sig = readFileSync(join(dir, 'signature.bin'));
      const hash = canonicalPluginHash({ manifest: manifestBuf, main: mainBuf, renderer: rendBuf, assets: readAssets(dir) });
      if (!verifyPluginSignature(hash, sig, getPinnedKeysets())) throw new Error('signature verification failed');

      // record as verified regardless of enabled state (renderer lists only enabled below)
      if (!opts.isEnabled(id)) { status.push({ id, loaded: false }); continue; }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(join(dir, manifest.main)) as { register?: (ctx: unknown) => void };
      if (typeof mod.register !== 'function') throw new Error('main entry has no register(ctx)');
      const ctx = createPluginContext(manifest.id, manifest.capabilities, fullDeps(opts.contextDeps), handlers);
      mod.register(ctx);

      verified.push({ id, name: manifest.name, version: manifest.version, modules: manifest.modules, renderer: manifest.renderer });
      status.push({ id, loaded: true });
    } catch (err) {
      const e = err as Error;
      console.error(`[plugin:${id}]`, e.name, e.message);
      status.push({ id, loaded: false, error: e.message });
    }
  }
}

function fullDeps(partial?: Partial<ContextDeps>): ContextDeps {
  // In tests, capabilities are [] so no dep is dereferenced; main wiring (Task 14) supplies real deps.
  return {
    isNetworkEnabled: () => false,
    rawFetch: async () => { throw new Error('egress not wired'); },
    validateUrl: (u) => u,
    secretBackend: { get: async () => null, set: async () => {}, delete: async () => {} },
    entities: {},
    timelineAppend: async () => {},
    caseSidecar: { read: async () => null, write: async () => {} },
    pluginStore: { read: async () => null, write: async () => {}, list: async () => [], delete: async () => {} },
    ...partial
  };
}
```

Also: add `getPinnedKeysets()` to `trust.ts` (`export function getPinnedKeysets(): TrustKeyset[] { return PINNED_KEYSETS; }`) and have Task 4's verify callers in the loader use it. Update the Task 4 test only if you changed verify's signature (you didn't — verify still takes keysets as a param).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-loader` → Expected: PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/loader.ts src/main/plugins/trust.ts test/plugin-loader.test.ts
git commit -m "feat(plugins): loader — discover, verify, load main entry"
```

---

## Task 10: Plugin-store path confinement helper

**Files:**
- Create: `src/main/plugins/paths.ts`
- Test: `test/plugin-paths.test.ts`

**Context:** Both the `plugin-storage` capability and the `dcs98-plugin://` protocol (Task 11) must resolve a plugin-relative path to an absolute path that is provably inside `userData/plugins/<id>/`. One tested helper, reused by both, prevents `..`/absolute-path escapes.

- [ ] **Step 1: Write the failing test** (`test/plugin-paths.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { resolveInside } from '../src/main/plugins/paths';

describe('resolveInside', () => {
  it('resolves a normal relative path under the base', () => {
    const p = resolveInside('/base/osint', 'data/bgp.bin');
    expect(p).toBe('/base/osint/data/bgp.bin');
  });
  it('rejects parent escapes', () => {
    expect(() => resolveInside('/base/osint', '../evil')).toThrow(/escape/);
    expect(() => resolveInside('/base/osint', 'a/../../evil')).toThrow(/escape/);
  });
  it('rejects absolute paths', () => {
    expect(() => resolveInside('/base/osint', '/etc/passwd')).toThrow(/escape/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-paths` → Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/paths.ts`)

```typescript
import { resolve, sep } from 'node:path';

/** Resolve `rel` under `base`, throwing if the result escapes `base`. */
export function resolveInside(base: string, rel: string): string {
  const full = resolve(base, rel);
  const baseNorm = resolve(base);
  if (full !== baseNorm && !full.startsWith(baseNorm + sep)) {
    throw new Error(`path escape: ${rel}`);
  }
  return full;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test plugin-paths` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/paths.ts test/plugin-paths.test.ts
git commit -m "feat(plugins): path-confinement helper"
```

---

## Task 11: `dcs98-plugin://` protocol (main)

**Files:**
- Create: `src/main/plugins/protocol.ts`
- Modify: `src/main/index.ts:21` (add scheme to `registerSchemesAsPrivileged`)
- Test: `test/plugin-protocol.test.ts` (tests the pure path-mapping; the live handler is smoke-tested in Task 16)

**Context:** Mirror the existing `ga98media`/`ga98model` pattern. The scheme is registered privileged before `app.ready`; the handler is installed after ready and serves files only from VERIFIED plugins, path-confined via Task 10.

- [ ] **Step 1: Write the failing test** (`test/plugin-protocol.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { mapPluginUrl } from '../src/main/plugins/protocol';

describe('mapPluginUrl', () => {
  const verifiedIds = new Set(['osint']);
  it('maps dcs98-plugin://osint/renderer.js to the plugin dir', () => {
    const p = mapPluginUrl('dcs98-plugin://osint/renderer.js', '/u/plugins', verifiedIds);
    expect(p).toBe('/u/plugins/osint/renderer.js');
  });
  it('returns null for an unverified id', () => {
    expect(mapPluginUrl('dcs98-plugin://evil/x.js', '/u/plugins', verifiedIds)).toBeNull();
  });
  it('returns null on path escape', () => {
    expect(mapPluginUrl('dcs98-plugin://osint/../../etc/passwd', '/u/plugins', verifiedIds)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-protocol` → Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** (`src/main/plugins/protocol.ts`)

```typescript
import { protocol, net } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { resolveInside } from './paths';
import { getVerified } from './loader';

export const PLUGIN_SCHEME = 'dcs98-plugin';

/** Pure mapping: dcs98-plugin://<id>/<path> -> absolute file path, or null if unverified / escapes. */
export function mapPluginUrl(url: string, pluginsRoot: string, verifiedIds: Set<string>): string | null {
  const u = new URL(url);
  const id = u.hostname;
  if (!verifiedIds.has(id)) return null;
  const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  try {
    return resolveInside(join(pluginsRoot, id), rel);
  } catch {
    return null;
  }
}

export function registerPluginProtocol(): void {
  const pluginsRoot = join(app.getPath('userData'), 'plugins');
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const verifiedIds = new Set(getVerified().map((v) => v.id));
    const file = mapPluginUrl(request.url, pluginsRoot, verifiedIds);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
```

- [ ] **Step 4: Register the scheme** — in `src/main/index.ts`, extend the existing `protocol.registerSchemesAsPrivileged([...])` call (around line 21) with:

```typescript
{ scheme: 'dcs98-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `pnpm test plugin-protocol` → PASS. `pnpm typecheck` → clean.

**Fallback note (if Task 16 smoke shows Chromium refuses dynamic `import()` of the scheme):** keep `registerPluginProtocol` for `assets`, but in Task 15 fetch the renderer chunk text over the scheme and `import()` a `Blob` URL instead; add `blob:` to `script-src` in the CSP (Task 13 already touches CSP).

- [ ] **Step 6: Commit**

```bash
git add src/main/plugins/protocol.ts src/main/index.ts test/plugin-protocol.test.ts
git commit -m "feat(plugins): dcs98-plugin:// protocol with path confinement"
```

---

## Task 12: IPC contracts + handlers + preload bridge

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (add `plugins` channels + contracts)
- Modify: `src/main/ipc/register.ts` (register handlers via `safeHandle`)
- Modify: `src/preload/index.ts` (`window.api.plugins.*` + `window.dcs98Plugin`)
- Test: `test/plugin-ipc.test.ts` (unit-test the invoke dispatcher)

- [ ] **Step 1: Write the failing test** (`test/plugin-ipc.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { _resetLoaderForTest, getHandlers } from '../src/main/plugins/loader';
import { invokePluginHandler } from '../src/main/plugins/invoke';

describe('invokePluginHandler', () => {
  it('dispatches to a registered handler by id+name', async () => {
    _resetLoaderForTest();
    getHandlers().set('osint:ping', (...a: unknown[]) => `pong:${String(a[0])}`);
    expect(await invokePluginHandler('osint', 'ping', ['hi'])).toBe('pong:hi');
  });
  it('throws for an unknown handler', async () => {
    _resetLoaderForTest();
    await expect(invokePluginHandler('osint', 'nope', [])).rejects.toThrow(/no handler/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-ipc` → Expected: FAIL.

- [ ] **Step 3: Implement the dispatcher** (`src/main/plugins/invoke.ts`)

```typescript
import { getHandlers } from './loader';

export async function invokePluginHandler(id: string, name: string, args: unknown[]): Promise<unknown> {
  const fn = getHandlers().get(`${id}:${name}`);
  if (!fn) throw new Error(`no handler: ${id}:${name}`);
  return await fn(...args);
}
```

- [ ] **Step 4: Add channels** in `src/shared/ipc-contracts.ts` — inside the `channels` object:

```typescript
plugins: {
  listVerified: 'plugins:listVerified',
  invoke: 'plugins:invoke',
  status: 'plugins:status'
},
```

and in `ApiContracts`:

```typescript
[channels.plugins.listVerified]: { args: []; returns: import('./plugin-types').VerifiedPluginInfo[] };
[channels.plugins.invoke]: { args: [string, string, unknown[]]; returns: unknown };
[channels.plugins.status]: { args: []; returns: import('./plugin-types').PluginStatus[] };
```

- [ ] **Step 5: Register handlers** in `src/main/ipc/register.ts` (use the existing `safeHandle`):

```typescript
import { getVerified, getStatus } from '../plugins/loader';
import { invokePluginHandler } from '../plugins/invoke';
// ...
safeHandle(channels.plugins.listVerified, async () => getVerified());
safeHandle(channels.plugins.status, async () => getStatus());
safeHandle(channels.plugins.invoke, async (id: unknown, name: unknown, args: unknown) =>
  invokePluginHandler(String(id), String(name), Array.isArray(args) ? args : []));
```

- [ ] **Step 6: Expose in preload** (`src/preload/index.ts`) — add to the `api` object:

```typescript
plugins: {
  listVerified: () => ipcRenderer.invoke(channels.plugins.listVerified),
  invoke: (id: string, name: string, args: unknown[]) => ipcRenderer.invoke(channels.plugins.invoke, id, name, args),
  status: () => ipcRenderer.invoke(channels.plugins.status)
},
```

and a separate bridge for plugin renderer chunks (so they share host React + the registry):

```typescript
import * as React from 'react';
import { registerModule } from '../renderer/state/registry'; // NOTE: preload cannot import renderer code.
```

**Correction:** preload runs in an isolated context and must NOT import renderer modules. Instead expose only primitives the renderer wires up. So `window.dcs98Plugin` is assembled in the RENDERER (Task 15), not preload. In preload, expose ONLY:

```typescript
contextBridge.exposeInMainWorld('apiPlugins', {
  listVerified: () => ipcRenderer.invoke(channels.plugins.listVerified),
  invoke: (id: string, name: string, args: unknown[]) => ipcRenderer.invoke(channels.plugins.invoke, id, name, args)
});
```

(Keep the `window.api.plugins.*` namespace too for app code; `apiPlugins` is the minimal surface a plugin chunk reaches.)

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm test plugin-ipc` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/main/plugins/invoke.ts test/plugin-ipc.test.ts
git commit -m "feat(plugins): IPC channels + invoke dispatcher + preload bridge"
```

---

## Task 13: Settings block for plugins

**Files:**
- Modify: `src/shared/types.ts` (`AppSettings.plugins` + `defaultSettings`)
- Modify: `src/renderer/index.html:15` (add `dcs98-plugin:` to `script-src` and `connect-src`)
- Test: `test/plugin-settings.test.ts`

- [ ] **Step 1: Write the failing test** (`test/plugin-settings.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('plugin settings defaults', () => {
  it('plugins block exists and defaults to empty', () => {
    expect(defaultSettings.plugins).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-settings` → Expected: FAIL (`plugins` undefined).

- [ ] **Step 3: Add the type + default** — in `src/shared/types.ts`, add to `AppSettings`:

```typescript
plugins: Record<string, { enabled: boolean; networkEnabled: boolean; settings?: Record<string, unknown> }>;
```

and to `defaultSettings`: `plugins: {},`

- [ ] **Step 4: Amend CSP** — in `src/renderer/index.html`, change the `script-src` and `connect-src` directives to include `dcs98-plugin:`:

```
script-src 'self' 'wasm-unsafe-eval' dcs98-plugin:;
... connect-src 'self' ga98model: dcs98-plugin: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;
```

(Leave every other directive byte-for-byte unchanged.)

- [ ] **Step 5: Run test + typecheck + full suite**

Run: `pnpm test plugin-settings` → PASS. `pnpm typecheck` → clean. `pnpm test` → green (settings shape change must not break settings-reading tests; `read()` merges with defaults so existing on-disk settings without `plugins` get `{}`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/index.html test/plugin-settings.test.ts
git commit -m "feat(plugins): settings.plugins block + CSP allows dcs98-plugin:"
```

---

## Task 14: Main bootstrap wiring + real context deps

**Files:**
- Modify: `src/main/index.ts` (`whenReady`: `await loadPlugins(...)` + `registerPluginProtocol()`)
- Create: `src/main/plugins/wire-deps.ts` (build real `ContextDeps` from existing stores)
- Test: `test/plugin-wire-deps.test.ts`

**Context:** Connect the loader's `ContextDeps` to the real stores: egress gating from `settingsStore`, SSRF validation from `src/main/security/validate.ts`, Tor-routed fetch, the secrets backend (`src/main/secrets`), entities (`src/main/storage/entities.ts`), timeline append, per-case sidecars + the plugin-global store (both via `secure-fs` with `resolveInside` confinement).

- [ ] **Step 1: Write the failing test** (`test/plugin-wire-deps.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ROOT = mkdtempSync(join(tmpdir(), 'dcs98-wire-'));
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { buildContextDeps } from '../src/main/plugins/wire-deps';

describe('buildContextDeps', () => {
  it('isNetworkEnabled reflects settings.plugins[id].networkEnabled', async () => {
    const deps = buildContextDeps({
      readSettings: async () => ({ plugins: { osint: { enabled: true, networkEnabled: true } } } as never),
      // other store stubs:
    } as never);
    // isNetworkEnabled is sync over a cached snapshot; the wiring caches settings at load time.
    expect(typeof deps.isNetworkEnabled).toBe('function');
  });
});
```

Note: `isNetworkEnabled` must be synchronous (the context's `egress.fetch` checks it inline). The wiring snapshots `settings.plugins` at load and refreshes the snapshot on settings update. Implement `buildContextDeps` to accept a `getPluginNetEnabled(id): boolean` closure backed by a cached settings snapshot kept current via the existing settings-update path. Keep the test asserting the function shape; the live behavior is covered by Task 16 smoke.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test plugin-wire-deps` → Expected: FAIL.

- [ ] **Step 3: Implement `wire-deps.ts`** — build `ContextDeps` from the real stores:

```typescript
import { join } from 'node:path';
import { app } from 'electron';
import type { ContextDeps } from './context';
import { resolveInside } from './paths';
import { secureReadFile, secureWriteFile, secureReadText } from '../storage/secure-fs';
import { secretStore } from '../secrets';
import { validateExternalUrl } from '../security/validate';
// entities + timeline + tor fetch imports per the real module surfaces

export interface WireInputs {
  getPluginNetEnabled(id: string): boolean;       // backed by cached settings snapshot
  torFetch(url: string, init: unknown): Promise<{ status: number; body: string; finalUrl: string }>;
  entities: unknown;
  timelineAppend(caseId: string, event: unknown): Promise<void>;
  caseSidecarPath(caseId: string, name: string): string;
}

export function buildContextDeps(w: WireInputs): ContextDeps {
  const pluginsRoot = join(app.getPath('userData'), 'plugins');
  return {
    isNetworkEnabled: (id) => w.getPluginNetEnabled(id),
    rawFetch: (url, init) => w.torFetch(url, init),
    validateUrl: (u) => validateExternalUrl(u),
    secretBackend: { get: (k) => secretStore.get(k), set: (k, v) => secretStore.set(k, v), delete: (k) => secretStore.delete(k) },
    entities: w.entities,
    timelineAppend: w.timelineAppend,
    caseSidecar: {
      read: (caseId, name) => secureReadText(w.caseSidecarPath(caseId, name)).catch(() => null),
      write: (caseId, name, data) => secureWriteFile(w.caseSidecarPath(caseId, name), data)
    },
    pluginStore: {
      read: async (id, rel) => { try { return await secureReadFile(resolveInside(join(pluginsRoot, id, 'data'), rel)); } catch { return null; } },
      write: (id, rel, data) => secureWriteFile(resolveInside(join(pluginsRoot, id, 'data'), rel), typeof data === 'string' ? data : Buffer.from(data)),
      list: async (id, rel) => {
        const base = resolveInside(join(pluginsRoot, id, 'data'), rel ?? '');
        const { readdir } = await import('node:fs/promises');
        try { return await readdir(base); } catch { return []; }
      },
      delete: async (id, rel) => {
        const target = resolveInside(join(pluginsRoot, id, 'data'), rel);
        const { rm } = await import('node:fs/promises');
        await rm(target, { force: true, recursive: true });
      }
    }
  };
}
```

Confirm the exact names of `secureReadText`/`validateExternalUrl`/the Tor fetch helper against the code (spec §9 grounding) and adjust imports. If a Tor-routed generic fetch helper does not yet exist (the existing Tor code is the chat `TorTransport`), implement a minimal one in this task: a `fetch` through the bundled Tor SOCKS port that the chat transport already manages, OR (if that is too coupled) gate to direct fetch + `validateExternalUrl` for v1 and note Tor-routing of plugin egress as a follow-up — **but do not silently skip the egress gate.**

- [ ] **Step 4: Wire into `whenReady`** — in `src/main/index.ts`, after `vault.refreshEnabled()` and before `registerIpc(...)`:

```typescript
import { loadPlugins } from './plugins/loader';
import { registerPluginProtocol } from './plugins/protocol';
import { buildContextDeps } from './plugins/wire-deps';
// ...
await loadPlugins({
  isEnabled: (id) => /* settingsSnapshot.plugins[id]?.enabled ?? true */ true,
  contextDeps: buildContextDeps(/* wire inputs */)
});
registerPluginProtocol();
```

- [ ] **Step 5: Run tests + typecheck + full suite**

Run: `pnpm test plugin-wire-deps` → PASS. `pnpm typecheck` → clean. `pnpm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/main/plugins/wire-deps.ts src/main/index.ts test/plugin-wire-deps.test.ts
git commit -m "feat(plugins): wire real context deps + load plugins at startup"
```

---

## Task 15: Renderer imports verified plugin chunks at boot

**Files:**
- Modify: `src/renderer/App.tsx` (on boot, import each verified plugin's renderer chunk)
- Create: `src/renderer/plugins/load-renderer-plugins.ts` (build `window.dcs98Plugin`, import chunks)
- Test: `test/load-renderer-plugins.test.ts`

- [ ] **Step 1: Write the failing test** (`test/load-renderer-plugins.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRegistryForTest, listModules } from '../src/renderer/state/registry';
import { installPluginBridge, importPluginChunks } from '../src/renderer/plugins/load-renderer-plugins';

beforeEach(() => _resetRegistryForTest());

describe('renderer plugin loading', () => {
  it('installs window.dcs98Plugin with React + registerModule + api', () => {
    installPluginBridge();
    const w = window as unknown as { dcs98Plugin: { React: unknown; registerModule: unknown; api: unknown } };
    expect(w.dcs98Plugin.React).toBeDefined();
    expect(typeof w.dcs98Plugin.registerModule).toBe('function');
  });

  it('imports each chunk via an injected importer and tolerates a failing one', async () => {
    installPluginBridge();
    const importer = vi.fn(async (url: string) => {
      if (url.includes('good')) (window as never as { dcs98Plugin: { registerModule: (d: unknown) => void } })
        .dcs98Plugin.registerModule({ key: 'good:m', title: 'G', glyph: 'g', component: () => null, builtin: false });
      else throw new Error('boom');
    });
    await importPluginChunks(
      [{ id: 'good', name: 'G', version: '1', modules: [], renderer: 'renderer.js' },
       { id: 'bad', name: 'B', version: '1', modules: [], renderer: 'renderer.js' }],
      importer
    );
    expect(listModules().map((m) => m.key)).toContain('good:m');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test load-renderer-plugins` → Expected: FAIL.

- [ ] **Step 3: Implement** (`src/renderer/plugins/load-renderer-plugins.ts`)

```typescript
import * as React from 'react';
import { registerModule } from '../state/registry';
import type { VerifiedPluginInfo } from '../../shared/plugin-types';

export function installPluginBridge(): void {
  const api = (window as unknown as { apiPlugins?: unknown }).apiPlugins;
  (window as unknown as { dcs98Plugin: unknown }).dcs98Plugin = { React, registerModule, api };
}

export type ChunkImporter = (url: string) => Promise<unknown>;

export async function importPluginChunks(
  plugins: VerifiedPluginInfo[],
  importer: ChunkImporter = (url) => import(/* @vite-ignore */ url)
): Promise<void> {
  for (const p of plugins) {
    try {
      await importer(`dcs98-plugin://${p.id}/${p.renderer}`);
    } catch (e) {
      console.error(`[plugin:${p.id}] renderer chunk failed to load`, e);
    }
  }
}
```

- [ ] **Step 4: Wire into App.tsx boot** — in `src/renderer/App.tsx`, in the boot `useEffect` (after `loadSettings()`):

```typescript
import { installPluginBridge, importPluginChunks } from './plugins/load-renderer-plugins';
// inside the effect:
installPluginBridge();
void window.api.plugins.listVerified().then((list) => importPluginChunks(list));
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm test load-renderer-plugins` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/plugins/load-renderer-plugins.ts src/renderer/App.tsx test/load-renderer-plugins.test.ts
git commit -m "feat(plugins): renderer imports verified plugin chunks + dcs98Plugin bridge"
```

---

## Task 16: Dev keyset, fixture plugin, end-to-end smoke (the spike)

**Files:**
- Create: `scripts/gen-plugin-devkey.mjs` (generate + print a dev keyset; pin its pubkeys in `trust.ts`)
- Create: `scripts/sign-plugin.mjs` (sign a built plugin dir; this is also the script the private OSINT repo will use)
- Create: `test/fixtures/hello-plugin/` (a trivial signed plugin: a module that renders "Hello plugin" and a `ping` handler)
- Modify: `src/main/plugins/trust.ts` (paste the generated dev pubkeys into `PINNED_KEYSETS`)
- Test: `test/plugin-smoke.test.ts` (loader→verify→register→invoke round-trip with the fixture)

- [ ] **Step 1: Generate a dev keyset**

Write `scripts/gen-plugin-devkey.mjs`:

```javascript
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
const edSec = ed25519.utils.randomPrivateKey();
const pq = ml_dsa65.keygen();
const hex = (u) => Buffer.from(u).toString('hex');
console.log('ED_PUB', hex(ed25519.getPublicKey(edSec)));
console.log('PQ_PUB', hex(pq.publicKey));
console.log('ED_SEC', hex(edSec));
console.log('PQ_SEC', hex(pq.secretKey));
```

Run: `node scripts/gen-plugin-devkey.mjs`. Save `ED_SEC`/`PQ_SEC` to a local untracked file (`.plugin-devkey.json`, add to `.gitignore`). Paste `ED_PUB`/`PQ_PUB` (hex-decoded) into `trust.ts`:

```typescript
const hexToBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
export const PINNED_KEYSETS: TrustKeyset[] = [
  { edPub: hexToBytes('<ED_PUB>'), pqPub: hexToBytes('<PQ_PUB>') }
];
```

**Release note (do NOT skip):** this is a DEV key. Before any public release the operator regenerates the keyset OFFLINE, replaces `PINNED_KEYSETS` with the offline public keys, and keeps the private keys off all build hosts. Add a `// DEV KEY — replace with offline release key before publishing` comment.

- [ ] **Step 2: Write `scripts/sign-plugin.mjs`** (reused by the private OSINT repo)

```javascript
// usage: node scripts/sign-plugin.mjs <plugin-dir> <devkey.json>
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
const [dir, keyfile] = process.argv.slice(2);
const k = JSON.parse(readFileSync(keyfile, 'utf8'));
const lp = (b) => { const l = Buffer.alloc(8); l.writeBigUInt64BE(BigInt(b.length)); return Buffer.concat([l, b]); };
const man = readFileSync(join(dir, 'manifest.json'));
const m = JSON.parse(man.toString());
const main = readFileSync(join(dir, m.main));
const rend = readFileSync(join(dir, m.renderer));
const assets = [];
const adir = join(dir, 'assets');
if (existsSync(adir)) { const walk = (rel) => { for (const n of readdirSync(join(adir, rel))) { const r = rel ? `${rel}/${n}` : n; const f = join(adir, r); if (statSync(f).isDirectory()) walk(r); else assets.push({ path: r, bytes: readFileSync(f) }); } }; walk(''); }
const h = createHash('sha512'); h.update(Buffer.from('DCS98-PLUGIN-v1')); h.update(Buffer.from([0]));
h.update(lp(man)); h.update(lp(main)); h.update(lp(rend));
for (const a of assets.sort((x, y) => x.path < y.path ? -1 : 1)) h.update(lp(Buffer.concat([Buffer.from(a.path), Buffer.from([0]), a.bytes])));
const hash = h.digest();
const ed = ed25519.sign(hash, Buffer.from(k.ED_SEC, 'hex'));
const pq = ml_dsa65.sign(Buffer.from(k.PQ_SEC, 'hex'), hash);
writeFileSync(join(dir, 'signature.bin'), Buffer.concat([Buffer.from(ed), Buffer.from(pq)]));
console.log('signed', dir);
```

(Match the hashing to `verify.ts` exactly — it does. Match the ml_dsa65 arg order to what Task 4 Step 1 confirmed.)

- [ ] **Step 3: Build the fixture plugin** under `test/fixtures/hello-plugin/`:

`manifest.json`:
```json
{ "id": "hello", "name": "Hello", "version": "1.0.0", "targetApiVersion": 1,
  "modules": [{ "key": "hello:panel", "title": "Hello", "glyph": "👋" }],
  "capabilities": [], "main": "main.js", "renderer": "renderer.js" }
```
`main.js`:
```javascript
module.exports.register = (ctx) => { ctx.registerHandler('ping', (x) => `pong:${x}`); };
```
`renderer.js`:
```javascript
const { React, registerModule } = window.dcs98Plugin;
registerModule({ key: 'hello:panel', title: 'Hello', glyph: '👋', builtin: false,
  component: () => React.createElement('div', { 'data-testid': 'hello' }, 'Hello plugin') });
```
Then sign it: `node scripts/sign-plugin.mjs test/fixtures/hello-plugin .plugin-devkey.json`.

- [ ] **Step 4: Write the smoke test** (`test/plugin-smoke.test.ts`)

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ROOT = mkdtempSync(join(tmpdir(), 'dcs98-smoke-'));
mkdirSync(join(ROOT, 'plugins'), { recursive: true });
cpSync(join(__dirname, 'fixtures/hello-plugin'), join(ROOT, 'plugins/hello'), { recursive: true });
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { loadPlugins, getVerified } from '../src/main/plugins/loader';
import { invokePluginHandler } from '../src/main/plugins/invoke';

describe('plugin smoke (load → verify against PINNED dev key → register → invoke)', () => {
  beforeAll(async () => { await loadPlugins({ isEnabled: () => true }); });

  it('the fixture verifies against the pinned dev key and loads', () => {
    expect(getVerified().map((v) => v.id)).toContain('hello');
  });
  it('its registered handler is invokable', async () => {
    expect(await invokePluginHandler('hello', 'ping', ['x'])).toBe('pong:x');
  });
});
```

This test exercises the real `PINNED_KEYSETS` (no stubbing) — it proves the dev key in `trust.ts` matches the signature `sign-plugin.mjs` produced, i.e. the whole verify path is internally consistent.

- [ ] **Step 5: Run the smoke test + manual renderer check**

Run: `pnpm test plugin-smoke` → Expected: PASS.
Then `pnpm dev`, confirm in the running app: the `hello:panel` module appears (Access menu / desktop), opening it shows "Hello plugin", and **the dynamic `import('dcs98-plugin://hello/renderer.js')` resolved without a CSP violation in DevTools console.** If a CSP error appears, apply the Blob-URL fallback (Task 11 Step 5 note + Task 15 importer) and re-run.

- [ ] **Step 6: gitignore the dev secret + commit**

```bash
echo '.plugin-devkey.json' >> .gitignore
git add .gitignore scripts/gen-plugin-devkey.mjs scripts/sign-plugin.mjs src/main/plugins/trust.ts test/fixtures/hello-plugin test/plugin-smoke.test.ts
git commit -m "feat(plugins): dev keyset, signing script, fixture plugin, e2e smoke"
```

---

## Final verification (after all tasks)

- [ ] `pnpm typecheck` (both tsconfigs) → clean.
- [ ] `pnpm test` → full suite green, including the 9 new test files.
- [ ] `pnpm dev` → app boots, all 27 built-in modules work (registry refactor caused no regression), the fixture plugin loads and round-trips `ping`, and DevTools shows no CSP violation for the plugin chunk import.
- [ ] Charter check: with `settings.plugins.hello.networkEnabled` absent/false, a plugin egress call throws `EEGRESSOFF` and emits no packet; no telemetry added.
- [ ] Confirm `signature.bin` for the fixture verifies against the pinned key (the smoke test asserts this) and that `.plugin-devkey.json` is gitignored and not committed.
- [ ] Dispatch the final code-reviewer over the whole branch before merge.

## Out of scope (this plan)

- The OSINT plugin itself (subsystem 2, private repo) — its own spec→plan→build cycle.
- The collection backend (Shodan/Censys/passive-DNS equivalent) — deferred strategic spec.
- Plugin delivery/installer UX, marketplace, auto-update, key rotation tooling beyond the pin-list, and an unsigned dev-mode loader.
