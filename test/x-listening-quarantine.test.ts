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
 * This is a STATIC import-graph scan of every source file under the two X module
 * directories. It is intentionally source-text based (not a runtime import) so it
 * holds even for lazy/dynamic `import(...)` calls and type-only imports.
 *
 * The ONE tolerated cross-reference is the type-only `@shared/socmint/types` import
 * (the shared `HarvestedItem` shape) — it is erased at compile time and carries no
 * runtime code, so it does not place any socmint RUNTIME module in the X graph.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOTS = ['src/main/x-listening', 'src/renderer/modules/x-listening'] as const;

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

  // static: import ... from 'x' / export ... from 'x' (capture a leading `type` keyword)
  const staticRe = /\b(?:import|export)\s+(type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g;
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

/** A forbidden trust-domain module: Tor/bgconn/socks transports and telegram. */
function isForbiddenTransport(spec: string): boolean {
  return (
    /(^|[/@])bgconn([/.]|$)/i.test(spec) ||
    /(^|[/@])torrc([/.]|$)/i.test(spec) ||
    /(^|[/@])tor([-/.]|$)/i.test(spec) || // tor, tor-egress, tor-socks, tor-connect, …
    /(^|[/@])socks5?([/.]|$)/i.test(spec) ||
    /telegram/i.test(spec)
  );
}

/**
 * A socmint reference that is NOT the tolerated type-only `socmint/types` import.
 * Any RUNTIME socmint import (collector, ipc, module) is a quarantine breach.
 */
function isForbiddenSocmint(ref: ImportRef): boolean {
  if (!/(^|[/@])socmint([/.]|$)/i.test(ref.spec)) return false;
  const isSharedTypes = /socmint\/types$/.test(ref.spec) && ref.typeOnly;
  return !isSharedTypes;
}

describe('X module clearnet-quarantine import graph', () => {
  const files = ROOTS.flatMap((r) => collectSources(resolve(process.cwd(), r)));
  const rel = (f: string) => relative(process.cwd(), f);

  it('scans a non-empty set of X module source files', () => {
    // Guard against a mis-pathed root silently making the whole test vacuous.
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports NOTHING from bgconn / Tor / socks / telegram (no transport trust-domain crossing)', () => {
    const violations = files
      .flatMap(extractImports)
      .filter((r) => isForbiddenTransport(r.spec))
      .map((r) => `${rel(r.file)} → ${r.spec}`);
    expect(violations).toEqual([]);
  });

  it('imports NO runtime socmint module (only the type-only @shared/socmint/types is tolerated)', () => {
    const violations = files
      .flatMap(extractImports)
      .filter(isForbiddenSocmint)
      .map((r) => `${rel(r.file)} → ${r.spec}${r.typeOnly ? ' (type)' : ''}`);
    expect(violations).toEqual([]);
  });

  it('the only socmint edge that exists at all is the erased type-only types import', () => {
    const socmint = files
      .flatMap(extractImports)
      .filter((r) => /(^|[/@])socmint([/.]|$)/i.test(r.spec));
    // Every socmint reference present must be `import type … socmint/types`.
    for (const r of socmint) {
      expect(r.typeOnly, `${rel(r.file)} → ${r.spec} must be a type-only import`).toBe(true);
      expect(/socmint\/types$/.test(r.spec), `${rel(r.file)} → ${r.spec}`).toBe(true);
    }
  });
});
