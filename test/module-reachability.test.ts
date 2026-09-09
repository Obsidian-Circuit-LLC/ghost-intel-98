/**
 * Every built-in module must be OPENABLE.
 *
 * THE BUG THIS EXISTS TO CATCH. v3.83.0 shipped the Address Book: store, IPC, renderer, tests, all
 * green, present in the packaged asar — and no way whatsoever to open it. `registerModule` puts a
 * module in the REGISTRY; the Access menu's five category flyouts are a HAND-WRITTEN list, and the
 * new key was never added to one. From the field: "The address book doesn't seem to be anywhere
 * within the app. Is it there, but didn't get indexed?" It was, and it wasn't.
 *
 * The existing registry test could not catch it: it asserts the module is REGISTERED, which was
 * true. Registration and reachability are different properties, and only one of them is what a user
 * experiences.
 *
 * So this asserts reachability across every route the shell actually offers — the Access menu
 * categories, the Games submenu, the desktop icons, and the OSINT Toolkit submenu (which derives
 * itself from the registry, so OSINT modules earn their place automatically). Anything reachable
 * only from inside another module is listed below WITH ITS OPENER, so "unreachable" can never be
 * waved through as "probably intentional".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Modules with no launcher entry BY DESIGN — each opened by another module, named here. */
const OPENED_FROM_ELSEWHERE: Record<string, string> = {
  'doc-viewer': 'opened by My Documents / Briefcase when a document is opened',
  'whiteboard': 'opened from within a case, not launched standalone',
  'minds-eye': 'opened from the Investigation Graph / OSINT Toolkit surfaces',
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Every `key:` passed to registerModule — the built-in set as the app actually registers it. */
function registeredKeys(): string[] {
  const src = read('src/renderer/modules/register-builtins.tsx');
  return [...src.matchAll(/registerModule\(\{\s*key: '([a-z0-9-]+)'/g)].map((m) => m[1]);
}

/** Keys the OSINT Toolkit submenu derives from the registry at render time. */
function osintKeys(): Set<string> {
  const src = read('src/renderer/modules/register-builtins.tsx');
  return new Set([...src.matchAll(/key: '([a-z0-9-]+)'[^}]*category: 'osint'/g)].map((m) => m[1]));
}

/** Keys any launcher surface offers: Access menu categories, Games submenu, desktop icons. */
function launchableKeys(): Set<string> {
  const sources = [read('src/renderer/shell/AccessMenu.tsx'), read('src/renderer/shell/Desktop.tsx')];
  const keys = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/module: '([a-z0-9-]+)'/g)) keys.add(m[1]);
  }
  return keys;
}

describe('module reachability', () => {
  it('every registered module can be opened from a launcher, or names the module that opens it', () => {
    const launchable = launchableKeys();
    const osint = osintKeys();

    const orphans = registeredKeys().filter(
      (key) => !launchable.has(key) && !osint.has(key) && !(key in OPENED_FROM_ELSEWHERE),
    );

    expect(
      orphans,
      `registered but unreachable — add each to a category in AccessMenu.tsx, to the desktop, or ` +
        `to OPENED_FROM_ELSEWHERE with the module that opens it`,
    ).toEqual([]);
  });

  it('the Address Book is reachable, since shipping it invisible is what prompted this', () => {
    expect(launchableKeys().has('address-book')).toBe(true);
  });

  it('every exemption names a real registered module, so the list cannot rot', () => {
    const registered = new Set(registeredKeys());
    for (const key of Object.keys(OPENED_FROM_ELSEWHERE)) {
      expect(registered.has(key), `${key} is exempted but no longer registered`).toBe(true);
    }
  });
});
