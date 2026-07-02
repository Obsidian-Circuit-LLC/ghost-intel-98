import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

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
const nshPath = join(repoRoot, 'resources', 'installer.nsh');
const nsh = readFileSync(nshPath, 'utf8');

/** True if a `makensis` binary is on PATH (Windows CI / dev boxes with NSIS installed). */
function hasMakensis(): boolean {
  const probe = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' });
  return probe.status === 0;
}

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

  it('registers the cleanup page via a Page/PageEx custom directive (not raw nsDialogs at page scope)', () => {
    // customPageAfterChangeDir is expanded at page-declaration scope by electron-builder's
    // assistedInstaller.nsh, so it must emit a `Page custom` (or `PageEx custom`) directive.
    // Raw nsDialogs::Create/${NSD_Create*} instructions there do not compile.
    expect(nsh).toMatch(/\b(Page|PageEx)\s+custom\b/);
    // The nsDialogs page body must live inside a Function, not the macro body.
    expect(nsh).toMatch(/Function\s+cleanPrevDataPageShow\b/);
    // The Page directive must reference that page-show Function.
    expect(nsh).toMatch(/\bPage\s+custom\s+cleanPrevDataPageShow\b/);
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

describe('installer cleanup: makensis compile gate', () => {
  const makensisAvailable = hasMakensis();

  // When NSIS is installed (Windows build box / CI), prove the script actually compiles
  // through electron-builder's hook points — the static greps above cannot catch a
  // non-compilable page structure. On boxes without NSIS this is skipped; the structural
  // `Page custom` assertion in the block above still guards the requirement.
  it.runIf(makensisAvailable)('installer.nsh compiles via the electron-builder hook points', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nsh-compile-'));
    // Minimal harness that includes installer.nsh and exercises both hook points at the
    // same scopes electron-builder uses: customPageAfterChangeDir between MUI pages,
    // customInstall inside the install Section.
    const harness = [
      '!include "MUI2.nsh"',
      '!include "nsDialogs.nsh"',
      '!include "LogicLib.nsh"',
      'Name "nsh-compile-harness"',
      `OutFile "${join(dir, 'harness.exe').replace(/\\/g, '\\\\')}"`,
      `!include "${nshPath.replace(/\\/g, '\\\\')}"`,
      '!insertmacro MUI_PAGE_DIRECTORY',
      '!insertmacro customPageAfterChangeDir',
      '!insertmacro MUI_PAGE_INSTFILES',
      '!insertmacro MUI_LANGUAGE "English"',
      'Section "Install"',
      '  !insertmacro customInstall',
      'SectionEnd',
      ''
    ].join('\n');
    const harnessPath = join(dir, 'harness.nsi');
    writeFileSync(harnessPath, harness, 'utf8');
    // Throws (failing the test) on non-zero makensis exit.
    execFileSync('makensis', ['-V2', harnessPath], { stdio: 'pipe' });
  });

  it.skipIf(makensisAvailable)('structural gate stands in when makensis is unavailable', () => {
    // No NSIS toolchain here: the `Page custom cleanPrevDataPageShow` structural assertion
    // in the macros block is the compile-requirement proxy. Keep this marker so the skip is
    // visible in the reporter rather than silently absent.
    expect(nsh).toMatch(/\bPage\s+custom\s+cleanPrevDataPageShow\b/);
  });
});
