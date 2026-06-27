/**
 * X-2: Clearnet-quarantine import sentinel.
 *
 * Statically scans every TypeScript file under src/main/x/ and asserts that
 * none of them import from the Tor/bgconn/Telegram-transport modules that are
 * forbidden by the X-collector clearnet-quarantine invariant (spec §3.2).
 *
 * Also verifies that settings.x and settings.socmint are structurally distinct
 * top-level keys with separate field shapes.
 *
 * Passes trivially when src/main/x/ is empty or absent (pre-X-3 state).
 * Enforces the quarantine once implementation files appear under src/main/x/.
 *
 * Forbidden import targets (absolute canonical paths, no extension):
 *   - src/main/bgconn/* (entire directory)
 *   - src/main/chat/transport-tor
 *   - src/main/chat/socks5
 *   - src/main/searchlight/tor-socks
 *   - src/main/socmint/collector
 *
 * Both relative imports (../bgconn/...) and @main/* alias imports are caught.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { defaultSettings } from '@shared/types';

// ---------------------------------------------------------------------------
// Canonical forbidden paths
// ---------------------------------------------------------------------------

const SRC_MAIN = resolve(__dirname, '..', 'src', 'main');

/**
 * Forbidden DIRECTORY: any file whose resolved canonical path starts with
 * this prefix (including the trailing separator) is off-limits.
 */
const FORBIDDEN_DIRS: string[] = [
  resolve(SRC_MAIN, 'bgconn'),
];

/**
 * Forbidden EXACT FILES (no extension — extensions are stripped during
 * comparison because TS imports omit them).
 */
const FORBIDDEN_FILES: string[] = [
  resolve(SRC_MAIN, 'chat', 'transport-tor'),
  resolve(SRC_MAIN, 'chat', 'socks5'),
  resolve(SRC_MAIN, 'searchlight', 'tor-socks'),
  resolve(SRC_MAIN, 'socmint', 'collector'),
];

/**
 * Permitted cross-directory in-tree imports for src/main/x/* (canonical, no ext). Any
 * in-tree (@main / relative) import from x/* that resolves OUTSIDE src/main/x/ and is NOT
 * in this allowlist fails the sentinel. The plain forbidden-list above only catches a
 * DIRECT import of a known-bad module; this allowlist additionally forces a conscious
 * review whenever x/* gains ANY new bridge into another main-process directory — closing
 * the "quarantine break one hop away through a shared module" gap. Keep this minimal.
 */
const ALLOWED_CROSS_DIR: string[] = [
  resolve(SRC_MAIN, 'socmint', 'store'),
  resolve(SRC_MAIN, 'socmint', 'rank'),
  resolve(SRC_MAIN, 'socmint', 'utils'),
  resolve(SRC_MAIN, 'security', 'validate'),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all .ts / .tsx files under dir, recursively. */
function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Extract every static/dynamic import path string from TypeScript source. */
function extractImportPaths(source: string): string[] {
  const paths: string[] = [];
  // import ... from '...' and import '...'
  for (const m of source.matchAll(/\bimport\s+(?:[^'"]*\bfrom\s+)?['"]([^'"]+)['"]/g)) {
    paths.push(m[1]);
  }
  // import('...')
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    paths.push(m[1]);
  }
  // require('...')
  for (const m of source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    paths.push(m[1]);
  }
  // export ... from '...' and export * from '...' (re-export edge — was a blind spot)
  for (const m of source.matchAll(/\bexport\s+[^'"]*\bfrom\s+['"]([^'"]+)['"]/g)) {
    paths.push(m[1]);
  }
  return paths;
}

/** Strip a TypeScript/JavaScript file extension from a path string. */
function stripExt(p: string): string {
  return p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
}

/**
 * Resolve an import specifier to a canonical absolute path (no extension).
 * Supports:
 *   - Relative paths (./foo, ../bar/baz) — resolved against the containing file.
 *   - @main/* alias — resolved against src/main/ (as in vitest.config.ts).
 * Returns null for bare module specifiers (e.g. 'electron', 'node:fs') that
 * cannot be forbidden in-tree paths.
 */
function resolveImport(importPath: string, fromFile: string): string | null {
  if (importPath.startsWith('.')) {
    return stripExt(resolve(dirname(fromFile), importPath));
  }
  if (importPath.startsWith('@main/')) {
    return stripExt(resolve(SRC_MAIN, importPath.slice('@main/'.length)));
  }
  // All other specifiers (node:*, electron, @shared/*, third-party) cannot be
  // in-tree forbidden paths.
  return null;
}

/**
 * Return true when a resolved canonical path (no extension) points into one
 * of the forbidden zones.
 */
function isForbidden(canonical: string): boolean {
  // Forbidden directory: path starts with FORBIDDEN_DIR + path separator.
  for (const dir of FORBIDDEN_DIRS) {
    if (canonical === dir || canonical.startsWith(dir + '/')) return true;
  }
  // Forbidden exact file (extension already stripped from both sides).
  for (const file of FORBIDDEN_FILES) {
    if (canonical === file) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Static scan — runs once at module load; results used across all tests below.
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  importPath: string;
  resolvedCanonical: string;
}

const X_DIR = resolve(__dirname, '..', 'src', 'main', 'x');
const xFiles = walkTs(X_DIR);
const violations: Violation[] = [];

for (const file of xFiles) {
  const source = readFileSync(file, 'utf8');
  for (const imp of extractImportPaths(source)) {
    const canonical = resolveImport(imp, file);
    if (canonical !== null && isForbidden(canonical)) {
      violations.push({ file, importPath: imp, resolvedCanonical: canonical });
    }
  }
}

// Cross-directory allowlist scan: any in-tree main import from x/* that leaves src/main/x/
// and is not explicitly permitted is a quarantine-bridge risk (a shared module could itself
// reach forbidden Tor/transport code one hop away).
const X_DIR_PREFIX = resolve(__dirname, '..', 'src', 'main', 'x') + '/';
const crossDirOutsideAllowlist: Violation[] = [];
for (const file of xFiles) {
  const source = readFileSync(file, 'utf8');
  for (const imp of extractImportPaths(source)) {
    const canonical = resolveImport(imp, file);
    if (canonical === null) continue;                               // external / @shared / node:*
    if (canonical === X_DIR_PREFIX.slice(0, -1) || canonical.startsWith(X_DIR_PREFIX)) continue; // internal to x/
    if (ALLOWED_CROSS_DIR.includes(canonical)) continue;            // explicitly permitted
    crossDirOutsideAllowlist.push({ file, importPath: imp, resolvedCanonical: canonical });
  }
}

// ---------------------------------------------------------------------------
// Tests — import-quarantine assertions
// ---------------------------------------------------------------------------

describe('X-2: clearnet-quarantine import sentinel — src/main/x/*', () => {
  it('src/main/x/ has no import from src/main/bgconn/* (Tor egress must not be reachable from X collector)', () => {
    const bgconnViolations = violations.filter((v) =>
      FORBIDDEN_DIRS.some((d) => v.resolvedCanonical === d || v.resolvedCanonical.startsWith(d + '/')),
    );
    if (bgconnViolations.length > 0) {
      const detail = bgconnViolations.map((v) => `${v.file}: '${v.importPath}'`).join('\n  ');
      throw new Error(
        `X-2 quarantine violated — bgconn import(s) in src/main/x/:\n  ${detail}\n` +
        'The X collector must NEVER import from src/main/bgconn/*.',
      );
    }
    expect(bgconnViolations).toEqual([]);
  });

  it('src/main/x/ has no import from src/main/chat/transport-tor (Tor transport blocked)', () => {
    const target = resolve(SRC_MAIN, 'chat', 'transport-tor');
    const v = violations.filter((x) => x.resolvedCanonical === target);
    if (v.length > 0) {
      const detail = v.map((x) => `${x.file}: '${x.importPath}'`).join('\n  ');
      throw new Error(`X-2 quarantine violated — transport-tor import(s) in src/main/x/:\n  ${detail}`);
    }
    expect(v).toEqual([]);
  });

  it('src/main/x/ has no import from src/main/chat/socks5 (SOCKS5 transport blocked)', () => {
    const target = resolve(SRC_MAIN, 'chat', 'socks5');
    const v = violations.filter((x) => x.resolvedCanonical === target);
    if (v.length > 0) {
      const detail = v.map((x) => `${x.file}: '${x.importPath}'`).join('\n  ');
      throw new Error(`X-2 quarantine violated — socks5 import(s) in src/main/x/:\n  ${detail}`);
    }
    expect(v).toEqual([]);
  });

  it('src/main/x/ has no import from src/main/searchlight/tor-socks (Tor-SOCKS helper blocked)', () => {
    const target = resolve(SRC_MAIN, 'searchlight', 'tor-socks');
    const v = violations.filter((x) => x.resolvedCanonical === target);
    if (v.length > 0) {
      const detail = v.map((x) => `${x.file}: '${x.importPath}'`).join('\n  ');
      throw new Error(`X-2 quarantine violated — tor-socks import(s) in src/main/x/:\n  ${detail}`);
    }
    expect(v).toEqual([]);
  });

  it('src/main/x/ has no import from src/main/socmint/collector (Telegram collector base blocked)', () => {
    const target = resolve(SRC_MAIN, 'socmint', 'collector');
    const v = violations.filter((x) => x.resolvedCanonical === target);
    if (v.length > 0) {
      const detail = v.map((x) => `${x.file}: '${x.importPath}'`).join('\n  ');
      throw new Error(`X-2 quarantine violated — socmint/collector import(s) in src/main/x/:\n  ${detail}`);
    }
    expect(v).toEqual([]);
  });

  it('no quarantine violations in src/main/x/ (full-set guard — fails on any forbidden import)', () => {
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `${v.file}\n    import '${v.importPath}' → ${v.resolvedCanonical}`)
        .join('\n  ');
      throw new Error(
        `X-2: ${violations.length} quarantine violation(s) detected in src/main/x/:\n  ${detail}\n\n` +
        'The X collector module must NEVER import from:\n' +
        '  • src/main/bgconn/* (any file)\n' +
        '  • src/main/chat/transport-tor\n' +
        '  • src/main/chat/socks5\n' +
        '  • src/main/searchlight/tor-socks\n' +
        '  • src/main/socmint/collector',
      );
    }
    expect(violations).toEqual([]);
  });

  it('passes trivially when src/main/x/ is absent or empty (pre-implementation state)', () => {
    // This assertion is always true: if the directory is absent/empty, xFiles is
    // empty and violations is empty, which is the expected pre-X-3 state.
    // The test documents that X-2 is intentionally non-blocking before X-3 lands.
    const absentOrEmpty = !existsSync(X_DIR) || xFiles.length === 0;
    if (absentOrEmpty) {
      expect(violations).toEqual([]);
    } else {
      // Directory has files — the full-set guard above is the enforcer.
      expect(xFiles.length).toBeGreaterThan(0);
    }
  });

  it('src/main/x/ imports nothing cross-directory outside the allowlist (bridge guard)', () => {
    if (crossDirOutsideAllowlist.length > 0) {
      const detail = crossDirOutsideAllowlist
        .map((v) => `${v.file}: '${v.importPath}' → ${v.resolvedCanonical}`)
        .join('\n  ');
      throw new Error(
        `X-2: src/main/x/ imports an in-tree main module outside the allowlist:\n  ${detail}\n` +
        'Add to ALLOWED_CROSS_DIR only after confirming it does not transitively reach a ' +
        'forbidden Tor/transport module.',
      );
    }
    expect(crossDirOutsideAllowlist).toEqual([]);
  });

  it('the detector itself flags synthetic forbidden imports (positive self-test, incl. export-from)', () => {
    const synthetic =
      "import { socksDial } from '../bgconn/socks';\n" +
      "export * from '../chat/socks5';\n" +
      "export { x } from '../searchlight/tor-socks';\n";
    const fakeFile = resolve(SRC_MAIN, 'x', 'synthetic.ts');
    const flagged = extractImportPaths(synthetic)
      .map((p) => resolveImport(p, fakeFile))
      .filter((c): c is string => c !== null && isForbidden(c));
    // bgconn (dir match) + chat/socks5 (export *) + searchlight/tor-socks (export-from) all caught.
    expect(flagged).toContain(resolve(SRC_MAIN, 'bgconn', 'socks'));
    expect(flagged).toContain(resolve(SRC_MAIN, 'chat', 'socks5'));
    expect(flagged).toContain(resolve(SRC_MAIN, 'searchlight', 'tor-socks'));
  });
});

// ---------------------------------------------------------------------------
// Tests — settings.x ≠ settings.socmint structural distinction
// ---------------------------------------------------------------------------

describe('X-2: settings.x and settings.socmint are distinct top-level namespaces', () => {
  it('settings.x and settings.socmint are not the same object reference', () => {
    expect(defaultSettings.x).not.toBe(defaultSettings.socmint);
  });

  it('settings.x has exactly the fields { networkEnabled, clearnetAcknowledged }', () => {
    expect(Object.keys(defaultSettings.x).sort()).toEqual(
      ['clearnetAcknowledged', 'networkEnabled'],
    );
  });

  it('settings.socmint key set differs from settings.x key set (transport present, clearnetAcknowledged absent)', () => {
    const xKeys = Object.keys(defaultSettings.x).sort();
    const socmintKeys = Object.keys(defaultSettings.socmint).sort();
    expect(xKeys).not.toEqual(socmintKeys);
    // Structural marker: socmint has transport, x does not.
    expect(socmintKeys).toContain('transport');
    expect(xKeys).not.toContain('transport');
    // Structural marker: x has clearnetAcknowledged, socmint does not.
    expect(xKeys).toContain('clearnetAcknowledged');
    expect(socmintKeys).not.toContain('clearnetAcknowledged');
  });

  it('settings.x.networkEnabled defaults to false', () => {
    expect(defaultSettings.x.networkEnabled).toBe(false);
  });

  it('settings.x.clearnetAcknowledged defaults to false', () => {
    expect(defaultSettings.x.clearnetAcknowledged).toBe(false);
  });

  it('settings.socmint.networkEnabled still defaults to false (no regression)', () => {
    expect(defaultSettings.socmint.networkEnabled).toBe(false);
  });

  it('settings.socmint.transport still defaults to direct (no regression)', () => {
    expect(defaultSettings.socmint.transport).toBe('direct');
  });
});
