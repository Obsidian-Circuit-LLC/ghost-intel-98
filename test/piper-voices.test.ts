import { describe, it, expect } from 'vitest';
import { listUserVoices, resolveUserModelPath, type VoicesDeps } from '../src/main/services/piper-voices';

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
