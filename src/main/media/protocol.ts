/**
 * ga98media:// — privileged custom protocol for local audio playback.
 *
 * SECURITY: this is the only bridge between a renderer-supplied URL and the
 * filesystem. `isAuthorizedMediaPath` is the gate: a path is served only if its
 * realpath (symlinks resolved) lives inside a remembered library root OR is in the
 * session ad-hoc allowlist. Everything else fails closed. The handler (added in a
 * later task) calls this before opening any stream.
 */

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';

/**
 * True iff `candidate` resolves (realpath, following symlinks) to a path that is
 * inside one of `roots`, OR whose realpath is present in `allowlist`. Any error
 * (missing file, unreadable root) results in `false` — fail closed.
 */
export function isAuthorizedMediaPath(candidate: string, roots: string[], allowlist: Set<string>): boolean {
  let real: string;
  try { real = realpathSync(candidate); } catch { return false; }
  if (allowlist.has(real)) return true;
  for (const root of roots) {
    let realRoot: string;
    try { realRoot = realpathSync(root); } catch { continue; }
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (real === realRoot || real.startsWith(prefix)) return true;
  }
  return false;
}
