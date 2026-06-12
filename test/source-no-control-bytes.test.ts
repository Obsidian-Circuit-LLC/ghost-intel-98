import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against raw, non-printing control bytes sneaking into source. A literal NUL (byte 0x00) -- or
 * any other C0 control / DEL written as a raw byte rather than an escape -- makes the file read as
 * binary, which breaks grep, diffs, and text-based CI tooling, and is invisible in code review. This
 * actually happened in src/main/security/validate.ts (a control-stripping regex whose character class
 * was authored with raw bytes instead of the escape form). Control characters in regexes and strings
 * must be written as escapes, never as raw bytes. Tab (0x09), LF (0x0a), and CR (0x0d) are the only
 * control bytes allowed in source text.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

const ALLOWED = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

describe('source hygiene: no raw control bytes', () => {
  it('every src/ and test/ file is clean text (only tab/LF/CR as control bytes)', () => {
    const roots = [join(__dirname, '..', 'src'), __dirname];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const buf = readFileSync(file);
        for (let i = 0; i < buf.length; i++) {
          const b = buf[i];
          if ((b < 0x20 && !ALLOWED.has(b)) || b === 0x7f) {
            const line = buf.subarray(0, i).toString('latin1').split('\n').length;
            offenders.push(`${file}:${line} byte 0x${b.toString(16).padStart(2, '0')}`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
