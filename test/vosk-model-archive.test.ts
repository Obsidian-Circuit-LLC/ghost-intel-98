import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The produced artifact must conform to vosk-browser's documented model/ layout. These are the
// documented model files that THIS model actually ships (small model = HCLr.fst + Gr.fst split,
// never a single HCLG.fst). Verified against the real zip contents 2026-07-06.
const MODEL = join(process.cwd(), 'resources', 'vosk', 'model.tar.gz');
const REQUIRED = [
  'model/am/final.mdl',
  'model/conf/mfcc.conf',
  'model/conf/model.conf',
  'model/graph/HCLr.fst',
  'model/graph/Gr.fst',
  'model/graph/phones/word_boundary.int',
  'model/ivector/final.dubm'
];

const suite = existsSync(MODEL) ? describe : describe.skip;

suite('bundled Vosk model archive conforms to vosk-browser model/ layout', () => {
  let entries: string[] = [];
  beforeAll(() => {
    entries = execFileSync('tar', ['-tzf', MODEL], { encoding: 'utf8' }).split('\n').filter(Boolean);
  });

  it('every documented model file is present under the model/ prefix', () => {
    for (const req of REQUIRED) expect(entries).toContain(req);
  });

  it('no entry retains the upstream vosk-model-small-en-us-0.15/ prefix', () => {
    expect(entries.some((e) => e.startsWith('vosk-model-small-en-us-0.15/'))).toBe(false);
  });

  it('does not (falsely) contain a single HCLG.fst — this model uses the lookahead split', () => {
    expect(entries).not.toContain('model/graph/HCLG.fst');
  });
});
