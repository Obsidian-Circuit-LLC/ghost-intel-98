import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { repackModelTar, assertSha } from '../scripts/fetch-vosk.mjs';

const MODEL_FILES = [
  'am/final.mdl', 'conf/mfcc.conf', 'conf/model.conf',
  'graph/HCLr.fst', 'graph/Gr.fst', 'graph/phones/word_boundary.int',
  'ivector/final.dubm', 'README'
];

const dirs: string[] = [];
function synthModel(): { extractedDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'vosk-synth-'));
  dirs.push(root);
  const top = join(root, 'vosk-model-small-en-us-0.15');
  for (const rel of MODEL_FILES) {
    const f = join(top, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `stub:${rel}`);
  }
  return { extractedDir: top, root };
}
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('repackModelTar → model/-rooted deterministic tar', () => {
  it('re-roots every entry under model/ and drops the upstream folder name', () => {
    const { extractedDir, root } = synthModel();
    const out = join(root, 'model.tar.gz');
    repackModelTar({ extractedDir, outFile: out });
    const entries = execFileSync('tar', ['-tzf', out], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(entries).toContain('model/am/final.mdl');
    expect(entries).toContain('model/graph/HCLr.fst');
    expect(entries.some((e) => e.startsWith('vosk-model-small-en-us-0.15/'))).toBe(false);
  });

  it('is byte-reproducible across independent runs (deterministic)', () => {
    const a = synthModel(); const outA = join(a.root, 'a.tar.gz');
    repackModelTar({ extractedDir: a.extractedDir, outFile: outA });
    const b = synthModel(); const outB = join(b.root, 'b.tar.gz');
    repackModelTar({ extractedDir: b.extractedDir, outFile: outB });
    expect(sha(outA)).toBe(sha(outB));
  });
});

describe('assertSha', () => {
  it('is a no-op when the hashes match', () => {
    expect(() => assertSha('abc', 'abc')).not.toThrow();
  });
  it('throws with both hashes on mismatch', () => {
    expect(() => assertSha('got1', 'want2', 'model.zip')).toThrow(/model\.zip[\s\S]*want2[\s\S]*got1/);
  });
});
