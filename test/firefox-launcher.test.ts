import { describe, it, expect, vi } from 'vitest';

// firefox.ts resolves the bundled executable from app.getAppPath()/resources/firefox in dev.
// Point it at a dir with no Firefox payload so resolveExecutable() returns null.
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/ga98-nonexistent-app-root' } }));

import * as firefox from '../src/main/services/firefox';
import { ValidationError } from '../src/main/security/validate';

describe('firefox launcher service', () => {
  it('reports not-installed when no payload is bundled', () => {
    expect(firefox.resolveExecutable()).toBeNull();
    expect(firefox.status()).toMatchObject({ installed: false, path: null });
    expect(firefox.status().dir).toMatch(/firefox/);
  });

  it('refuses non-http(s) URLs before touching the filesystem (no file:/javascript: launch)', () => {
    expect(() => firefox.launch('file:///etc/passwd')).toThrow(ValidationError);
    expect(() => firefox.launch('javascript:alert(1)')).toThrow();
    expect(() => firefox.launch('ftp://host/x')).toThrow();
  });

  it('throws a clear error when asked to launch with no bundled binary', () => {
    expect(() => firefox.launch('https://example.com')).toThrow(/isn't installed yet/i);
  });
});
