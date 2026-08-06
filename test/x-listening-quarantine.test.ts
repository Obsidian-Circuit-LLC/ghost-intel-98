/**
 * X — CLEARNET-QUARANTINE import-graph guard.
 *
 * The load-bearing trust-domain invariant of the X Listening Station: the X module
 * is a CLEARNET-only quarantine surface. It talks to x.com/twitter.com over the
 * operator's own IP + cookies and must NEVER pull in any Tor / bgconn / socks
 * transport, nor the socmint collector graph, nor telegram — importing any of them
 * would cross a trust boundary (route clearnet X traffic through Tor, or entangle X
 * capture with a different collection domain).
 *
 * This is a STATIC import-graph scan. It is intentionally source-text based (not a
 * runtime import) so it holds even for lazy/dynamic `import(...)` calls and type-only
 * imports.
 *
 * TRANSITIVITY: the scan is seeded with every source file under the two X module
 * directories and then walks the *first-party runtime* import graph reachable from
 * them — following relative (`./`, `../`) and aliased (`@renderer/*`, `@shared/*`)
 * specifiers into `src/`, recursively. This closes the "X → some shared module → Tor"
 * hole that a shallow single-directory scan would miss. Traversal boundary, stated
 * honestly:
 *   - Type-only edges are NOT followed (they are erased at compile time and create no
 *     runtime dependency) — but they ARE still checked by name against the matchers.
 *   - Bare / node_modules / otherwise-unresolvable specifiers are NOT followed (we do
 *     not vendor-scan) — but they ARE still checked by name, so a direct
 *     `import 'tor-socks-proxy'` is caught even though its package tree isn't walked.
 *
 * The ONE tolerated cross-reference is the type-only `@shared/socmint/types` import
 * (the shared `HarvestedItem` shape) — it is erased at compile time and carries no
 * runtime code, so it does not place any socmint RUNTIME module in the X graph.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOTS = ['src/main/x-listening', 'src/renderer/modules/x-listening'] as const;

/** tsconfig path aliases that resolve into first-party `src/`. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['@renderer/', 'src/renderer/'],
  ['@shared/', 'src/shared/'],
];

/** Recursively collect every .ts/.tsx file under a directory. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface ImportRef {
  file: string;
  spec: string;
  typeOnly: boolean;
}

/**
 * Extract every module specifier referenced by a source file — static `import`/`export
 * … from`, dynamic `import('…')`, and `require('…')` — with a best-effort `typeOnly`
 * flag for `import type` / `export type`. Comments are stripped first so a specifier
 * mentioned only inside a doc-comment is never counted as an edge.
 */
function extractImports(file: string): ImportRef[] {
  const raw = readFileSync(file, 'utf8');
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (leave URLs like http:// alone)
  const refs: ImportRef[] = [];

  // static: import ... from 'x' / export ... from 'x' (capture a leading `type` keyword).
  // The clause between the keyword and `from` never contains a `;`, so `[^;]*?` (not
  // `[\s\S]*?`) keeps the lazy gap from bridging across a statement boundary — e.g. an
  // `export interface Foo { …; }` declaration (which has no `from`) must not glue itself
  // onto the NEXT statement's `from '…'` and mis-attribute that import's `type` flag.
  const staticRe = /\b(?:import|export)\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g;
  // bare side-effect import: import 'x'
  const bareRe = /\bimport\s+['"]([^'"]+)['"]/g;
  // dynamic import('x') and require('x')
  const dynRe = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(src))) refs.push({ file, spec: m[2], typeOnly: Boolean(m[1]) });
  while ((m = bareRe.exec(src))) refs.push({ file, spec: m[1], typeOnly: false });
  while ((m = dynRe.exec(src))) refs.push({ file, spec: m[1], typeOnly: false });
  return refs;
}

/**
 * Resolve a module specifier to a first-party source file, or `null` if it cannot be
 * resolved into `src/` (bare package, node: builtin, node_modules, missing). Tries
 * `.ts`, `.tsx`, and `index.{ts,tsx}` — matching how the bundler resolves.
 */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    for (const [alias, target] of ALIASES) {
      if (spec.startsWith(alias)) {
        base = resolve(process.cwd(), target + spec.slice(alias.length));
        break;
      }
    }
  }
  if (!base) return null; // bare / node: builtin / unaliased — not first-party
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

/**
 * Walk the first-party RUNTIME import graph reachable from the seed files. Returns the
 * set of reachable files and every import edge observed in any reachable file. Type-only
 * edges are recorded (so they are still checked) but not traversed — they create no
 * runtime dependency.
 */
function buildGraph(seeds: string[]): { files: Set<string>; edges: ImportRef[] } {
  const seen = new Set<string>(seeds);
  const queue: string[] = [...seeds];
  const edges: ImportRef[] = [];
  while (queue.length) {
    const file = queue.shift()!;
    for (const ref of extractImports(file)) {
      edges.push(ref);
      if (ref.typeOnly) continue; // erased at runtime — do not follow
      // Record forbidden / socmint edges (the checks below flag them) but do NOT walk
      // into their graphs: following a forbidden transport or the socmint types module
      // would pull an unrelated trust-domain's subtree into the X scan and manufacture
      // false positives. Reachability of the forbidden edge itself is the violation.
      if (isForbiddenTransport(ref.spec) || isSocmintSpec(ref.spec)) continue;
      const resolved = resolveSpec(ref.spec, file);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { files: seen, edges };
}

/**
 * A forbidden trust-domain module: Tor/bgconn/socks transports and telegram. The token
 * may appear as a whole path segment (`net/tor/index`), a scope (`@x/tor`), a bare
 * specifier (`tor`), OR a hyphenated suffix/prefix (`transport-tor`, `tor-egress`) —
 * hence `-` is a boundary character on both sides.
 */
function isForbiddenTransport(spec: string): boolean {
  return (
    /(^|[/@-])bgconn([-/.]|$)/i.test(spec) ||
    /(^|[/@-])torrc([-/.]|$)/i.test(spec) ||
    /(^|[/@-])tor([-/.]|$)/i.test(spec) || // tor, tor-egress, tor-socks, transport-tor, net/tor/…
    /(^|[/@-])socks5?([-/.]|$)/i.test(spec) ||
    /telegram/i.test(spec) // telegram, telegram-mtproto, foo-telegram, net/telegram/…
  );
}

/** True iff a specifier references the socmint graph at all (segment/scope/suffix aware). */
function isSocmintSpec(spec: string): boolean {
  return /(^|[/@-])socmint([-/.]|$)/i.test(spec);
}

/**
 * A socmint reference that is NOT the tolerated `socmint/types` shape import. Any RUNTIME
 * socmint import (collector, ipc, module) is a quarantine breach.
 *
 * Tolerance is keyword-agnostic: the socmint `types` module is a pure type declaration
 * carrying no runtime code, so a reference to it never places a socmint runtime module in
 * the graph — whether written `import type … socmint/types` (X's own code, and the strict
 * form enforced separately for X-owned files) or a plain value-form import of the same
 * shape by an upstream shared module (e.g. `@shared/ipc-contracts`) that X transitively
 * pulls in. Only a specifier reaching a NON-`types` socmint module is a runtime breach.
 */
function isForbiddenSocmint(ref: ImportRef): boolean {
  if (!isSocmintSpec(ref.spec)) return false;
  return !/socmint\/types$/.test(ref.spec);
}

describe('X module clearnet-quarantine import graph', () => {
  const seeds = ROOTS.flatMap((r) => collectSources(resolve(process.cwd(), r)));
  const graph = buildGraph(seeds);
  const allRefs = graph.edges;
  const rel = (f: string) => relative(process.cwd(), f);

  it('scans a non-empty, transitively-expanded set of X module source files', () => {
    // Guard against a mis-pathed root silently making the whole test vacuous, and
    // against the transitive walk collapsing to just the seeds (a resolver regression).
    expect(seeds.length).toBeGreaterThan(0);
    expect(graph.files.size).toBeGreaterThan(seeds.length);
  });

  it('imports NOTHING from bgconn / Tor / socks / telegram (no transport trust-domain crossing)', () => {
    const violations = allRefs
      .filter((r) => isForbiddenTransport(r.spec))
      .map((r) => `${rel(r.file)} → ${r.spec}`);
    expect(violations).toEqual([]);
  });

  it('imports NO runtime socmint module (only the type-only @shared/socmint/types is tolerated)', () => {
    const violations = allRefs
      .filter(isForbiddenSocmint)
      .map((r) => `${rel(r.file)} → ${r.spec}${r.typeOnly ? ' (type)' : ''}`);
    expect(violations).toEqual([]);
  });

  it('every X-OWNED socmint edge is the strict erased type-only types import', () => {
    // Strict form, scoped to files the X quarantine owns (the seeds): X's own author must
    // write `import type … socmint/types`. Upstream shared files that X transitively pulls
    // in are held to the weaker-but-still-correct "only the types module" rule below.
    const seedSet = new Set(seeds);
    const socmint = allRefs.filter((r) => seedSet.has(r.file) && isSocmintSpec(r.spec));
    for (const r of socmint) {
      expect(r.typeOnly, `${rel(r.file)} → ${r.spec} must be a type-only import`).toBe(true);
      expect(/socmint\/types$/.test(r.spec), `${rel(r.file)} → ${r.spec}`).toBe(true);
    }
  });

  it('NO socmint edge anywhere in the transitive graph reaches a non-types socmint module', () => {
    // Across the full reachable graph, every socmint reference must resolve to the pure
    // `socmint/types` shape — no runtime socmint module is reachable from X, directly or
    // through any shared module it depends on.
    const runtimeSocmint = allRefs
      .filter((r) => isSocmintSpec(r.spec) && !/socmint\/types$/.test(r.spec))
      .map((r) => `${rel(r.file)} → ${r.spec}`);
    expect(runtimeSocmint).toEqual([]);
  });

  // POSITIVE CONTROLS — prove the matchers actually fire on known-bad specifiers, so a
  // green "no violations" result means the guard works, not that the matcher is dead.
  it('isForbiddenTransport fires on every known-bad transport specifier (incl. -tor suffix)', () => {
    const bad = [
      'tor',
      'net/tor',
      'net/tor/index',
      '@x/tor',
      'tor-egress',
      'tor-socks',
      '../chat/transport-tor', // the repo's REAL transport module, reached via relative path
      '@main/chat/transport-tor',
      'bgconn',
      'net/bgconn',
      'transport-bgconn',
      'torrc',
      'socks',
      'socks5',
      '../net/socks5-proxy',
      'telegram',
      'telegram-mtproto',
      'gramjs-telegram',
      'net/telegram/client',
    ];
    for (const spec of bad) {
      expect(isForbiddenTransport(spec), `expected FORBIDDEN transport: ${spec}`).toBe(true);
    }
  });

  it('isForbiddenTransport does NOT fire on benign specifiers (no over-matching)', () => {
    const ok = [
      'react',
      'electron',
      'node:crypto',
      '@shared/reports-types',
      '../capture/capture-window',
      '../security/validate',
      'mentor', // contains "tor" but not on a boundary
      'refactor',
      'directory',
      'history',
    ];
    for (const spec of ok) {
      expect(isForbiddenTransport(spec), `expected ALLOWED: ${spec}`).toBe(false);
    }
  });

  it('isForbiddenSocmint fires on runtime socmint specifiers and spares the type-only shape', () => {
    const badRuntime = [
      '@shared/socmint/collector',
      '@shared/socmint/ipc',
      '../socmint/module',
      'socmint',
      'socmint-telegram',
    ];
    for (const spec of badRuntime) {
      expect(isForbiddenSocmint({ file: 'x', spec, typeOnly: false }), `runtime socmint: ${spec}`).toBe(true);
    }
    // The tolerated shape: the pure `socmint/types` module carries no runtime, so a
    // reference to it is not a breach regardless of the import keyword.
    expect(isForbiddenSocmint({ file: 'x', spec: '@shared/socmint/types', typeOnly: true })).toBe(false);
    expect(isForbiddenSocmint({ file: 'x', spec: '@shared/socmint/types', typeOnly: false })).toBe(false);
    // A non-socmint spec is never a socmint violation.
    expect(isForbiddenSocmint({ file: 'x', spec: 'react', typeOnly: false })).toBe(false);
  });
});
