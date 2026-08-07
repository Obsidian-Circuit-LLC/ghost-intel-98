/**
 * TG-R — mtcute engine retirement guard.
 *
 * The Telegram engine was swapped to the Tor-fail-closed capture-window collector
 * (`telegram-hunter/collector.ts`, TG5). This regression guard pins the retirement so
 * the dead `@mtcute/*` dependency and the removed `makeMtcuteCollector` / `MtcuteClientLike`
 * symbols can never silently return:
 *
 *   1. No `@mtcute/*` entry survives in package.json dependencies / devDependencies.
 *   2. No source or test file statically imports `@mtcute/*`.
 *   3. `collector.ts` exports the stable `SocmintCollector` interface + `MockCollector`,
 *      but NOT `makeMtcuteCollector` / `MtcuteClientLike`.
 *
 * WhatsApp (tor-identity.ts, whatsapp-*.ts) is deliberately out of scope — it still uses
 * the shared transport helpers and is untouched by the Telegram engine retirement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as collectorModule from '../src/main/socmint/collector';

const REPO_ROOT = resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('TG-R: mtcute engine retirement', () => {
  it('drops every @mtcute/* dependency from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const mtcuteDeps = Object.keys(all).filter((name) => name.startsWith('@mtcute/'));
    expect(mtcuteDeps).toEqual([]);
  });

  it('has no static @mtcute/* import anywhere in src/ or test/', () => {
    // Match real module resolution (import/require/dynamic-import), not the bare string —
    // so this guard file's own prose/regex mentioning the package name is not a false hit.
    const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]@mtcute\//;
    const files = [...walk(join(REPO_ROOT, 'src')), ...walk(join(REPO_ROOT, 'test'))];
    const offenders = files.filter((f) => IMPORT_RE.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('collector.ts keeps the SocmintCollector seam but not the mtcute engine symbols', () => {
    const mod = collectorModule as Record<string, unknown>;
    // The stable swap seam survives.
    expect(typeof mod.MockCollector).toBe('function');
    // The retired engine symbols are gone.
    expect(mod.makeMtcuteCollector).toBeUndefined();
    expect(mod.MtcuteClientLike).toBeUndefined();
  });
});
