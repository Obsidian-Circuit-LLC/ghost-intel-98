import { describe, it, expect, vi } from 'vitest';
import { makeBgConnSecrets } from '../src/main/bgconn/secrets';

describe('BgConnSecrets', () => {
  it('namespaces under bgconn:<plugin>:<conn>: and delegates to the backend', async () => {
    const backend = { get: vi.fn(async () => 'v'), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    const s = makeBgConnSecrets(backend);
    await s.set('osint', 'c1', 'session', 'tok');
    expect(backend.set).toHaveBeenCalledWith('bgconn:osint:c1:session', 'tok');
    await s.get('osint', 'c1', 'phone');
    expect(backend.get).toHaveBeenCalledWith('bgconn:osint:c1:phone');
    await s.clear('osint', 'c1', ['session', 'phone']);
    expect(backend.delete).toHaveBeenCalledWith('bgconn:osint:c1:session');
    expect(backend.delete).toHaveBeenCalledWith('bgconn:osint:c1:phone');
  });
});
