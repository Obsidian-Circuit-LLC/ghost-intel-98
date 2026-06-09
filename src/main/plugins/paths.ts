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
