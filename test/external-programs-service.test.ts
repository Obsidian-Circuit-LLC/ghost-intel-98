import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanExternalPrograms } from '../src/main/externalPrograms/service';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ga98-external-programs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('External Apps — directory discovery', () => {
  it('reports an empty, non-fatal scan for a folder that does not exist yet', async () => {
    const { result } = await scanExternalPrograms(join(root, 'does-not-exist'));
    expect(result).toEqual({ programs: [], diagnostics: [] });
  });

  it('finds a bare .exe with no manifest, named from its filename', async () => {
    await writeFile(join(root, 'MyTool.exe'), 'stub');
    const { result, resolved } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]).toMatchObject({ name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false });
    expect(resolved.get(result.programs[0].id)?.executableAbsPath).toBe(join(root, 'MyTool.exe'));
  });

  it('recognizes .bat and .cmd bare files too, and ignores everything else', async () => {
    await writeFile(join(root, 'a.bat'), '');
    await writeFile(join(root, 'b.cmd'), '');
    await writeFile(join(root, 'readme.txt'), '');
    await writeFile(join(root, 'notes.md'), '');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs.map((p) => p.executableName).sort()).toEqual(['a.bat', 'b.cmd']);
  });

  it('uses a subfolder\'s app.json when present', async () => {
    const dir = join(root, 'ToolFolder');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'app.json'), JSON.stringify({
      name: 'Fancy Tool', executable: 'bin/fancy.exe', category: 'Recon', description: 'It scans things.',
    }));
    await mkdir(join(dir, 'bin'), { recursive: true });
    await writeFile(join(dir, 'bin', 'fancy.exe'), 'stub');

    const { result, resolved } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]).toMatchObject({
      name: 'Fancy Tool', executableName: 'fancy.exe', category: 'Recon',
      description: 'It scans things.', hasManifest: true,
    });
    expect(resolved.get(result.programs[0].id)?.executableAbsPath).toBe(join(dir, 'bin', 'fancy.exe'));
  });

  it('falls back to a single discovered executable when a subfolder has no app.json', async () => {
    const dir = join(root, 'PortableApp');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'PortableApp.exe'), 'stub');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]).toMatchObject({ name: 'PortableApp', executableName: 'PortableApp.exe', hasManifest: false });
  });

  it('skips (with a diagnostic) a subfolder with no app.json and no executable', async () => {
    const dir = join(root, 'EmptyFolder');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'readme.txt'), '');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.includes('EmptyFolder'))).toBe(true);
  });

  it('skips (with a diagnostic) a subfolder with no app.json and MORE than one executable — ambiguous', async () => {
    const dir = join(root, 'Ambiguous');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'one.exe'), '');
    await writeFile(join(dir, 'two.exe'), '');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.includes('Ambiguous'))).toBe(true);
  });

  it('skips (with a diagnostic) a malformed app.json rather than throwing', async () => {
    const dir = join(root, 'Broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'app.json'), '{ not valid json');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.includes('Broken'))).toBe(true);
  });

  it('skips (with a diagnostic) an app.json whose executable escapes the folder, rather than launching it', async () => {
    const dir = join(root, 'Sneaky');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'app.json'), JSON.stringify({ executable: '../../evil.exe' }));
    const { result } = await scanExternalPrograms(root);
    expect(result.programs).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.includes('Sneaky'))).toBe(true);
  });

  it('is sorted by directory-entry name, so the list order is stable and predictable', async () => {
    await writeFile(join(root, 'Zeta.exe'), '');
    await writeFile(join(root, 'Alpha.exe'), '');
    const { result } = await scanExternalPrograms(root);
    expect(result.programs.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('never returns a filesystem path to the caller\'s result — only the resolved map holds one', async () => {
    await writeFile(join(root, 'MyTool.exe'), 'stub');
    const { result } = await scanExternalPrograms(root);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(root);
  });
});
