/**
 * External Apps — folder scan. Dynamic and read-only: every call re-lists the folder, nothing is
 * cached to disk, and nothing here executes a thing it finds — discovery only ever produces a
 * descriptor (`ExternalProgramsScanResult`) plus a main-process-only resolved map for the launcher
 * to look an id up in. Never hard-code a program; the folder on disk is the only source of truth.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { ExternalProgram, ExternalProgramsScanResult } from '@shared/external-programs/types';
import { externalProgramsDir } from '../storage/paths';
import { parseManifest } from './manifestParser';

const ALLOWED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd']);

/** A discovered program plus what the launcher needs — kept OUT of `ExternalProgramsScanResult` so
 *  a filesystem path never crosses the IPC boundary; the renderer only ever holds `id`. */
export interface ScannedProgram extends ExternalProgram {
  executableAbsPath: string;
  arguments: string[];
  workingDirectory: string;
}

export interface ScanOutcome {
  result: ExternalProgramsScanResult;
  resolved: Map<string, ScannedProgram>;
}

function isAllowedExecutable(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filename).toLowerCase());
}

export async function scanExternalPrograms(rootDir: string = externalProgramsDir()): Promise<ScanOutcome> {
  const programs: ExternalProgram[] = [];
  const diagnostics: string[] = [];
  const resolved = new Map<string, ScannedProgram>();
  const seenExecutables = new Set<string>();

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    // Folder doesn't exist yet (nobody has dropped anything in) — an empty list, not an error.
    return { result: { programs, diagnostics }, resolved };
  }

  entries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = join(rootDir, entry.name);

    if (entry.isFile()) {
      if (!isAllowedExecutable(entry.name)) continue;
      if (seenExecutables.has(entryPath)) { diagnostics.push(`Skipped duplicate: ${entry.name}`); continue; }
      seenExecutables.add(entryPath);
      const id = `file:${entry.name}`;
      const name = basename(entry.name, extname(entry.name));
      const program: ExternalProgram = { id, name, executableName: entry.name, hasManifest: false };
      programs.push(program);
      resolved.set(id, { ...program, executableAbsPath: entryPath, arguments: [], workingDirectory: rootDir });
      continue;
    }

    if (!entry.isDirectory()) continue;

    const manifestPath = join(entryPath, 'app.json');
    let manifestJson: string | null = null;
    try { manifestJson = await readFile(manifestPath, 'utf8'); } catch { manifestJson = null; }

    if (manifestJson !== null) {
      const parsed = parseManifest(manifestJson, entryPath);
      if (!parsed.ok) { diagnostics.push(`${entry.name}/app.json: ${parsed.error}`); continue; }
      if (seenExecutables.has(parsed.executableAbsPath)) { diagnostics.push(`Skipped duplicate: ${entry.name}`); continue; }
      seenExecutables.add(parsed.executableAbsPath);
      const id = `dir:${entry.name}`;
      const name = parsed.manifest.name ?? entry.name;
      const executableName = basename(parsed.executableAbsPath);
      const workingDirectory = parsed.manifest.workingDirectory
        ? join(entryPath, parsed.manifest.workingDirectory)
        : entryPath;
      const program: ExternalProgram = {
        id, name, executableName, hasManifest: true,
        ...(parsed.manifest.category ? { category: parsed.manifest.category } : {}),
        ...(parsed.manifest.description ? { description: parsed.manifest.description } : {}),
      };
      programs.push(program);
      resolved.set(id, {
        ...program, executableAbsPath: parsed.executableAbsPath,
        arguments: parsed.manifest.arguments ?? [], workingDirectory,
      });
      continue;
    }

    // No manifest — the Firefox Portable convenience GhostExodus asked for: drop a folder in and
    // it just works, PROVIDED there's exactly one executable to run. More than one is ambiguous
    // (which one?) and gets a diagnostic asking for an app.json instead of guessing.
    let inner;
    try { inner = await readdir(entryPath, { withFileTypes: true }); } catch { diagnostics.push(`${entry.name}: could not be read`); continue; }
    const exeCandidates = inner.filter((f) => f.isFile() && isAllowedExecutable(f.name));
    if (exeCandidates.length === 0) { diagnostics.push(`${entry.name}: no app.json and no executable found`); continue; }
    if (exeCandidates.length > 1) { diagnostics.push(`${entry.name}: no app.json and more than one executable found — add an app.json to pick one`); continue; }
    const exe = exeCandidates[0];
    const exeAbsPath = join(entryPath, exe.name);
    if (seenExecutables.has(exeAbsPath)) { diagnostics.push(`Skipped duplicate: ${entry.name}`); continue; }
    seenExecutables.add(exeAbsPath);
    const id = `dir:${entry.name}`;
    const program: ExternalProgram = { id, name: entry.name, executableName: exe.name, hasManifest: false };
    programs.push(program);
    resolved.set(id, { ...program, executableAbsPath: exeAbsPath, arguments: [], workingDirectory: entryPath });
  }

  return { result: { programs, diagnostics }, resolved };
}
