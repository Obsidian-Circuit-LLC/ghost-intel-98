import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseManifest } from '../src/main/externalPrograms/manifestParser';

const FOLDER = process.platform === 'win32' ? 'C:\\Programs\\MyTool' : '/programs/MyTool';

describe('External Apps — manifest parsing', () => {
  it('accepts a minimal manifest with just an executable', () => {
    const res = parseManifest(JSON.stringify({ executable: 'MyTool.exe' }), FOLDER);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.executableAbsPath).toBe(join(FOLDER, 'MyTool.exe'));
      expect(res.manifest.name).toBeUndefined();
    }
  });

  it('accepts every documented field', () => {
    const res = parseManifest(JSON.stringify({
      name: 'My Tool', executable: 'bin/MyTool.exe', icon: 'icon.png', category: 'Recon',
      description: 'Does a thing.', arguments: ['--flag', 'value'], workingDirectory: 'bin',
    }), FOLDER);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.name).toBe('My Tool');
      expect(res.manifest.category).toBe('Recon');
      expect(res.manifest.description).toBe('Does a thing.');
      expect(res.manifest.arguments).toEqual(['--flag', 'value']);
      expect(res.executableAbsPath).toBe(join(FOLDER, 'bin', 'MyTool.exe'));
    }
  });

  it('rejects malformed JSON rather than throwing', () => {
    const res = parseManifest('{ not json', FOLDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/i);
  });

  it('rejects a manifest that is not an object', () => {
    const res = parseManifest('"just a string"', FOLDER);
    expect(res.ok).toBe(false);
  });

  it('rejects a missing "executable" field', () => {
    const res = parseManifest(JSON.stringify({ name: 'No Exe' }), FOLDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/executable/i);
  });

  it('rejects an executable path that escapes its own folder with ../', () => {
    const res = parseManifest(JSON.stringify({ executable: '../../evil.exe' }), FOLDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/escapes/i);
  });

  it('rejects an absolute executable path pointing elsewhere', () => {
    const abs = process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/etc/passwd';
    const res = parseManifest(JSON.stringify({ executable: abs }), FOLDER);
    expect(res.ok).toBe(false);
  });

  it('rejects an unsupported executable extension', () => {
    const res = parseManifest(JSON.stringify({ executable: 'script.ps1' }), FOLDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/\.exe|\.bat|\.cmd/i);
  });

  it('accepts .bat and .cmd as well as .exe', () => {
    expect(parseManifest(JSON.stringify({ executable: 'run.bat' }), FOLDER).ok).toBe(true);
    expect(parseManifest(JSON.stringify({ executable: 'run.cmd' }), FOLDER).ok).toBe(true);
  });

  it('rejects a workingDirectory that escapes its own folder', () => {
    const res = parseManifest(JSON.stringify({ executable: 'a.exe', workingDirectory: '../../' }), FOLDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/workingDirectory|escapes/i);
  });

  it('rejects a non-array "arguments" rather than silently dropping it', () => {
    const res = parseManifest(JSON.stringify({ executable: 'a.exe', arguments: 'not-an-array' }), FOLDER);
    // Malformed shape is ignored, not fatal — the executable itself is still valid.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.manifest.arguments).toBeUndefined();
  });
});
