// @vitest-environment jsdom
// T1: the desktop icon grid must expose ONLY the OSINT Toolkit launcher as the OSINT entry point.
// The individual OSINT tools (Searchlight, SOCMINT) are reached through the Toolkit flyout, not as
// their own desktop icons. desktopShortcutDefaults is the single source of desktop icons, so we
// assert directly against it.
import { describe, it, expect } from 'vitest';
import { desktopShortcutDefaults } from '../src/renderer/shell/Desktop';

describe('Desktop OSINT icons', () => {
  it('keeps the OSINT Toolkit launcher as the single OSINT desktop entry point', () => {
    const modules = desktopShortcutDefaults.map((s) => s.module);
    expect(modules).toContain('osint-toolkit');
    expect(modules).not.toContain('searchlight');
    expect(modules).not.toContain('socmint');
  });
});
