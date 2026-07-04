import { describe, it, expect } from 'vitest';
import { createBonds, type BondIO } from '../src/main/services/memory/bonds';

/** In-memory fake IO — no real secure-fs, no filesystem. */
function makeFakeIO(): BondIO {
  let text: string | null = null;
  return {
    async read() { return text; },
    async write(t: string) { text = t; }
  };
}

describe('createBonds', () => {
  it('add(a,b) then add(b,a) yields ONE bond; neighbors reflects it; remove clears it', async () => {
    const bonds = createBonds(makeFakeIO());
    await bonds.add('a', 'b');
    await bonds.add('b', 'a');
    const list = await bonds.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ a: 'a', b: 'b' });

    expect(await bonds.neighbors('a')).toEqual(['b']);
    expect(await bonds.neighbors('b')).toEqual(['a']);

    await bonds.remove('a', 'b');
    expect(await bonds.list()).toHaveLength(0);
    expect(await bonds.neighbors('a')).toEqual([]);
  });

  it('ignores a self-bond', async () => {
    const bonds = createBonds(makeFakeIO());
    await bonds.add('x', 'x');
    expect(await bonds.list()).toHaveLength(0);
    expect(await bonds.neighbors('x')).toEqual([]);
  });

  it('normalizes order regardless of remove argument order', async () => {
    const bonds = createBonds(makeFakeIO());
    await bonds.add('z', 'a');
    expect(await bonds.list()).toEqual([{ a: 'a', b: 'z' }]);
    await bonds.remove('z', 'a');
    expect(await bonds.list()).toHaveLength(0);
  });
});
