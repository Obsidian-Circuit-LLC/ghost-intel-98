// @vitest-environment jsdom
/**
 * One-click-capture fix: the target field accepts a bare handle, `@handle`, or a full profile URL.
 * GhostExodus pasted "https://x.com/ExodusGhost" into it, which must resolve to "ExodusGhost" before
 * the capture channel (which wants a username, not a URL) is called.
 */
import { describe, it, expect } from 'vitest';
import { extractXUsername } from '../src/renderer/modules/x-listening/XListeningModule';

describe('extractXUsername — bare handle, @handle, or full profile URL', () => {
  it('extracts the username from a full x.com / twitter.com URL', () => {
    expect(extractXUsername('https://x.com/ExodusGhost')).toBe('ExodusGhost');
    expect(extractXUsername('https://twitter.com/@ExodusGhost')).toBe('ExodusGhost');
    expect(extractXUsername('x.com/dcs_vortex/status/123')).toBe('dcs_vortex');
  });
  it('strips a leading @ and trims a bare handle', () => {
    expect(extractXUsername('  @ExodusGhost ')).toBe('ExodusGhost');
    expect(extractXUsername('ExodusGhost')).toBe('ExodusGhost');
  });
  it('returns empty for empty/whitespace input', () => {
    expect(extractXUsername('')).toBe('');
    expect(extractXUsername('   ')).toBe('');
  });
});
