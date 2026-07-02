import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard for the opt-in "remove previous-install data" NSIS installer feature (T1).
 *
 * The installer must offer a DEFAULT-UNCHECKED checkbox that, only when the user ticks it,
 * deletes the app's %APPDATA% data directories left by a prior install (including the two
 * prior product names). The destructive-op safety contract is load-bearing:
 *   - opt-in: checkbox created but never NSD_Check'd (starts unchecked)
 *   - gated: RMDir runs only IF $CleanPrevData == 1
 *   - scoped: only the three %APPDATA% app dirs; NEVER INSTDIR or anything outside them
 *
 * This test reads the two artefacts statically (no NSIS toolchain, no Electron runtime).
 */
const repoRoot = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const nsh = readFileSync(join(repoRoot, 'resources', 'installer.nsh'), 'utf8');

describe('installer cleanup: package.json wiring', () => {
  it('build.nsis.include points at installer.nsh', () => {
    expect(pkg.build.nsis.include).toBe('installer.nsh');
  });
});

describe('installer cleanup: installer.nsh macros', () => {
  it('defines both the custom page and custom install hooks', () => {
    expect(nsh).toMatch(/!macro\s+customPageAfterChangeDir\b/);
    expect(nsh).toMatch(/!macro\s+customInstall\b/);
  });

  it('creates a checkbox but never auto-checks it (opt-in, default off)', () => {
    expect(nsh).toMatch(/NSD_CreateCheckbox/);
    // The cleanup checkbox must NOT be pre-checked: no ${NSD_Check} anywhere in the file.
    expect(nsh).not.toMatch(/NSD_Check\b/);
  });

  it('stores the checkbox state into $CleanPrevData', () => {
    expect(nsh).toMatch(/Var\s+CleanPrevData/);
    expect(nsh).toMatch(/NSD_GetState/);
    expect(nsh).toMatch(/NSD_OnClick/);
  });

  it('gates deletion on $CleanPrevData == 1', () => {
    expect(nsh).toMatch(/\$\{If\}\s+\$CleanPrevData\s*==\s*1/);
  });

  it('removes the current + both prior-name %APPDATA% dirs', () => {
    expect(nsh).toContain('$APPDATA\\Ghost Intel 98');
    expect(nsh).toContain('$APPDATA\\Dead Cyber Society 98');
    expect(nsh).toContain('$APPDATA\\Ghost Access 98');
  });

  it('never RMDir/Delete the install dir or anything outside the %APPDATA% app dirs', () => {
    // Inspect only real directives, not NSIS comments (which start with ';').
    const code = nsh
      .split('\n')
      .filter((l) => !l.trim().startsWith(';'))
      .join('\n');
    // No RMDir/Delete targeting $INSTDIR.
    expect(code).not.toMatch(/RMDir[^\n]*\$INSTDIR/);
    expect(code).not.toMatch(/Delete[^\n]*\$INSTDIR/);
    // Every RMDir target must be one of the three whitelisted %APPDATA% app dirs.
    const rmdirLines = code.split('\n').filter((l) => /\bRMDir\b/.test(l));
    expect(rmdirLines.length).toBeGreaterThan(0);
    const allowed = [
      '$APPDATA\\Ghost Intel 98',
      '$APPDATA\\Dead Cyber Society 98',
      '$APPDATA\\Ghost Access 98'
    ];
    for (const line of rmdirLines) {
      expect(allowed.some((a) => line.includes(a))).toBe(true);
    }
  });
});
