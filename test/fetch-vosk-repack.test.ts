import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
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
// `modes` lets callers give each synthesized tree DIFFERENT (but internally consistent) permission
// bits — real-world nondeterminism comes from unzip/host umask producing different mode bits on
// each extraction, NOT from anything content-related. A determinism test that builds both trees
// identically (same modes) can never exercise repackModelTar's mode-normalization step.
function synthModel(opts: { fileMode?: number; dirMode?: number } = {}): { extractedDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'vosk-synth-'));
  dirs.push(root);
  const top = join(root, 'vosk-model-small-en-us-0.15');
  for (const rel of MODEL_FILES) {
    const f = join(top, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `stub:${rel}`);
    if (opts.fileMode !== undefined) chmodSync(f, opts.fileMode);
  }
  if (opts.dirMode !== undefined) {
    // chmod every directory under top, deepest-first, so parent chmods don't get overwritten.
    const dirsUnderTop = new Set<string>();
    for (const rel of MODEL_FILES) {
      let d = dirname(join(top, rel));
      while (d.startsWith(top)) { dirsUnderTop.add(d); d = dirname(d); }
    }
    for (const d of [...dirsUnderTop].sort((a, b) => b.length - a.length)) chmodSync(d, opts.dirMode);
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

  it('is byte-reproducible even when the two extractions have DIFFERENT permission bits', () => {
    // Simulates two build hosts whose unzip/umask left different (but internally consistent)
    // mode bits on the extracted tree — the real-world nondeterminism source this repo hit
    // (one file group-writable, the rest not). repackModelTar must normalize this away.
    const a = synthModel({ fileMode: 0o644, dirMode: 0o755 });
    const outA = join(a.root, 'a.tar.gz');
    repackModelTar({ extractedDir: a.extractedDir, outFile: outA });

    const b = synthModel({ fileMode: 0o664, dirMode: 0o750 });
    const outB = join(b.root, 'b.tar.gz');
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
