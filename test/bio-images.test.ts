import { describe, it, expect, afterAll, vi } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-bio-test' } }));

import * as bio from '../src/main/storage/bio-images';

const CASE = '33333333-3333-4333-8333-cccccccccccc';
// 1x1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

afterAll(async () => { await rm('/tmp/ga98-bio-test', { recursive: true, force: true }); });

describe('bio images store', () => {
  it('adds, lists with thumb data-uri, re-points primary, and removes', async () => {
    const a = await bio.add(CASE, { originalName: 'a.png', mime: 'image/png', width: 1, height: 1, originalBase64: PNG, thumbBase64: PNG });
    expect(a.id).toMatch(/^bio-/);

    let list = await bio.listResolved(CASE);
    expect(list).toHaveLength(1);
    expect(list[0].isPrimary).toBe(true);
    expect(list[0].thumbDataUri).toContain('data:image/png;base64,');

    const b = await bio.add(CASE, { originalName: 'b.png', mime: 'image/png', width: 1, height: 1, originalBase64: PNG, thumbBase64: PNG });
    expect((await bio.listResolved(CASE)).find((x) => x.id === b.id)?.isPrimary).toBe(false);

    await bio.setPrimary(CASE, b.id);
    list = await bio.listResolved(CASE);
    expect(list.find((x) => x.id === b.id)?.isPrimary).toBe(true);
    expect(list.find((x) => x.id === a.id)?.isPrimary).toBe(false);

    expect(await bio.primaryThumb(CASE)).toContain('data:image/png');
    expect(await bio.readOriginalDataUri(CASE, b.id)).toContain('data:image/png;base64,');

    await bio.remove(CASE, a.id);
    expect(await bio.listResolved(CASE)).toHaveLength(1);
  });

  it('rejects oversize payloads', async () => {
    const huge = 'A'.repeat(45 * 1024 * 1024);
    await expect(bio.add(CASE, { originalName: 'big.png', mime: 'image/png', width: 1, height: 1, originalBase64: huge, thumbBase64: PNG }))
      .rejects.toThrow();
  });
});
