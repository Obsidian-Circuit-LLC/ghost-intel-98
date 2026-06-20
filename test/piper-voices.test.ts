import { describe, it, expect } from 'vitest';
import { listUserVoices, resolveUserModelPath, listBundledVoices, resolveBundledModelPath, DEFAULT_BUNDLED_ID, type VoicesDeps } from '../src/main/services/piper-voices';

/** Fake voices dir: `files` lists readdir entries; `json` maps a sidecar name → its text content. */
function deps(files: string[], json: Record<string, string> = {}, throwReaddir = false): VoicesDeps {
  return {
    dir: '/voices',
    readdir: async () => { if (throwReaddir) throw new Error('ENOENT'); return files; },
    readText: async (p: string) => {
      const name = p.replace('/voices/', '');
      if (name in json) return json[name];
      throw new Error('no such file');
    }
  };
}

describe('listUserVoices', () => {
  it('returns a complete .onnx + valid-JSON .onnx.json pair', async () => {
    const d = deps(['jarvis.onnx', 'jarvis.onnx.json'], { 'jarvis.onnx.json': '{"sample_rate":22050}' });
    expect(await listUserVoices(d)).toEqual([{ id: 'jarvis.onnx', name: 'jarvis' }]);
  });
  it('ignores a lone .onnx with no sidecar', async () => {
    expect(await listUserVoices(deps(['lone.onnx']))).toEqual([]);
  });
  it('ignores a pair whose sidecar is not valid JSON', async () => {
    const d = deps(['bad.onnx', 'bad.onnx.json'], { 'bad.onnx.json': '{ not json' });
    expect(await listUserVoices(d)).toEqual([]);
  });
  it('a missing/unreadable dir is empty, not an error', async () => {
    expect(await listUserVoices(deps([], {}, true))).toEqual([]);
  });
  it('sorts results by name', async () => {
    const d = deps(['z.onnx', 'z.onnx.json', 'a.onnx', 'a.onnx.json'], { 'z.onnx.json': '{}', 'a.onnx.json': '{}' });
    expect((await listUserVoices(d)).map((v) => v.name)).toEqual(['a', 'z']);
  });
});

describe('resolveUserModelPath', () => {
  const ok = deps(['v.onnx', 'v.onnx.json'], { 'v.onnx.json': '{}' });
  it('resolves a known id to a path under the voices dir', async () => {
    expect(await resolveUserModelPath('v.onnx', ok)).toBe('/voices/v.onnx');
  });
  it('returns null for an unknown id', async () => {
    expect(await resolveUserModelPath('nope.onnx', ok)).toBeNull();
  });
  it('returns null for a path-traversal id (security)', async () => {
    expect(await resolveUserModelPath('../../etc/passwd', ok)).toBeNull();
  });
  it('returns null for an absolute path (security)', async () => {
    expect(await resolveUserModelPath('/etc/passwd', ok)).toBeNull();
  });
  it('returns null for null/empty', async () => {
    expect(await resolveUserModelPath(null, ok)).toBeNull();
    expect(await resolveUserModelPath('', ok)).toBeNull();
  });
});

function bdeps(files: string[], json: Record<string, string> = {}): VoicesDeps {
  return {
    dir: '/bundled',
    readdir: async () => files,
    readText: async (p: string) => { const n = p.replace('/bundled/', ''); if (n in json) return json[n]; throw new Error('no'); }
  };
}
const J = '{}';

describe('listBundledVoices', () => {
  it('lists valid pairs with friendly names and EXCLUDES the default voice', async () => {
    const d = bdeps(
      [DEFAULT_BUNDLED_ID, `${DEFAULT_BUNDLED_ID}.json`, 'jarvis-medium.onnx', 'jarvis-medium.onnx.json', 'hal.onnx', 'hal.onnx.json'],
      { [`${DEFAULT_BUNDLED_ID}.json`]: J, 'jarvis-medium.onnx.json': J, 'hal.onnx.json': J }
    );
    const got = await listBundledVoices(d);
    expect(got.find((v) => v.id === DEFAULT_BUNDLED_ID)).toBeUndefined(); // default excluded
    expect(got).toEqual([
      { id: 'hal.onnx', name: 'HAL 9000' },
      { id: 'jarvis-medium.onnx', name: 'Jarvis' }
    ]); // sorted by name
  });
  it('falls back to the filename (minus .onnx) for an unmapped voice', async () => {
    const d = bdeps(['custom.onnx', 'custom.onnx.json'], { 'custom.onnx.json': J });
    expect(await listBundledVoices(d)).toEqual([{ id: 'custom.onnx', name: 'custom' }]);
  });
  it('ignores lone .onnx / bad-JSON sidecar; missing dir → []', async () => {
    const lone = bdeps(['x.onnx']);
    expect(await listBundledVoices(lone)).toEqual([]);
    const bad = bdeps(['x.onnx', 'x.onnx.json'], { 'x.onnx.json': '{ no' });
    expect(await listBundledVoices(bad)).toEqual([]);
  });
});

describe('resolveBundledModelPath', () => {
  const d = bdeps(['jarvis-medium.onnx', 'jarvis-medium.onnx.json', DEFAULT_BUNDLED_ID, `${DEFAULT_BUNDLED_ID}.json`],
    { 'jarvis-medium.onnx.json': J, [`${DEFAULT_BUNDLED_ID}.json`]: J });
  it('resolves a known bundled id (incl. the default id when passed explicitly)', async () => {
    expect(await resolveBundledModelPath('jarvis-medium.onnx', d)).toBe('/bundled/jarvis-medium.onnx');
    expect(await resolveBundledModelPath(DEFAULT_BUNDLED_ID, d)).toBe(`/bundled/${DEFAULT_BUNDLED_ID}`);
  });
  it('returns null for traversal / absolute / unknown / null (security)', async () => {
    expect(await resolveBundledModelPath('../../etc/passwd', d)).toBeNull();
    expect(await resolveBundledModelPath('/etc/passwd', d)).toBeNull();
    expect(await resolveBundledModelPath('nope.onnx', d)).toBeNull();
    expect(await resolveBundledModelPath(null, d)).toBeNull();
  });
});
