/**
 * Global My Documents store. Every method takes an ALREADY-VALIDATED relative path
 * (the IPC boundary applies ensureDocRelPath/ensureDocName); this module adds the second
 * defence — realpath-prefix confinement — so nothing escapes documentsRoot even via symlink.
 * File content routes through secure-fs (encrypted at rest iff login is on). Copy/move (Task 3)
 * use raw fs ops because at-rest bytes are already valid under the current vault DEK.
 */
import { readdir, stat, lstat, rename as fsRename, rm, realpath, mkdir as fsMkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, sep, extname, basename, relative } from 'node:path';
import { shell } from 'electron';
import type { DocEntry, DocImportResult } from '../../shared/documents-types';
import { documentsRoot, resolveWithin, ensureDocumentsRoot } from './paths';
import { secureWriteFile, isEncryptedFile, secureReadFile } from '../storage/secure-fs';
import { stageDecryptedTemp } from './open-temp';

/** Realpath of the root, computed after ensuring it exists. Throws if root is missing. */
async function rootReal(): Promise<string> {
  await ensureDocumentsRoot();
  return realpath(documentsRoot());
}

function assertInside(root: string, candidate: string): void {
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    const e = new Error('Path resolves outside the documents root (confinement refused).');
    (e as Error & { code?: string }).code = 'EOUTSIDE';
    throw e;
  }
}

/** Realpath an EXISTING candidate and assert it is inside the root. Returns the real path. */
export async function confineExisting(rel: string): Promise<string> {
  const root = await rootReal();
  const real = await realpath(resolveWithin(rel));
  assertInside(root, real);
  return real;
}

/** Realpath the PARENT of a to-be-created leaf and assert it is inside the root. Returns real parent. */
async function confineParent(relDir: string): Promise<string> {
  const root = await rootReal();
  const real = await realpath(resolveWithin(relDir));
  assertInside(root, real);
  return real;
}

/** Given a real directory and a desired leaf name, return a name that does not collide,
 *  appending " (n)" before the extension. Deterministic given the directory contents. */
export async function uniqueLeaf(realDir: string, name: string): Promise<string> {
  const existing = new Set(await readdir(realDir).catch(() => []));
  if (!existing.has(name)) return name;
  const ext = extname(name);
  const stem = basename(name, ext);
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export async function list(relDir: string): Promise<DocEntry[]> {
  let realDir: string;
  try {
    realDir = await confineExisting(relDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let names: string[];
  try {
    names = await readdir(realDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: DocEntry[] = [];
  for (const name of names) {
    try {
      const s = await stat(join(realDir, name));
      out.push({
        name,
        kind: s.isDirectory() ? 'folder' : 'file',
        size: s.isDirectory() ? 0 : s.size,
        modifiedAt: s.mtime.toISOString()
      });
    } catch { /* entry vanished mid-scan — skip */ }
  }
  // Deterministic: folders first, then codepoint name order (no clock, no readdir order).
  out.sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'folder' ? -1 : 1));
  return out;
}

export async function mkdir(relDir: string, name: string): Promise<void> {
  const realParent = await confineParent(relDir);
  // Non-recursive fsMkdir → throws EEXIST if the folder already exists (New Folder can't silently no-op).
  await fsMkdir(join(realParent, name));
}

export async function rename(relPath: string, newName: string): Promise<void> {
  // Mirror remove()'s root guard: an empty relPath resolves to documentsRoot itself, whose parent
  // is OUTSIDE the confinement root — renaming it would move the entire tree out and wipe the store.
  if (relPath === '') throw new Error('Refusing to rename the documents root.');
  const realSrc = await confineExisting(relPath);
  if (realSrc === (await rootReal())) throw new Error('Refusing to rename the documents root.');
  const dest = join(dirname(realSrc), newName);
  // Refuse to clobber an existing entry.
  const clash = await stat(dest).then(() => true, () => false);
  if (clash) throw new Error(`"${newName}" already exists.`);
  await fsRename(realSrc, dest);
}

export async function remove(relPath: string): Promise<void> {
  if (relPath === '') throw new Error('Refusing to remove the documents root.');
  const realSrc = await confineExisting(relPath);
  await rm(realSrc, { recursive: true, force: false });
}

export function reveal(relPath: string): void {
  // No realpath (target may be the root); resolveWithin is safe because relPath is validated.
  shell.showItemInFolder(resolveWithin(relPath));
}

/** The relative path (from documentsRoot) of a real absolute path already known to be inside it. */
async function relOf(realAbs: string): Promise<string> {
  const root = await rootReal();
  return relative(root, realAbs).split(sep).join('/');
}

/** Refuse a transfer of a directory into itself or one of its own descendants — that would
 *  orphan the tree (move) or recurse infinitely (copy). `verb` shapes the error message. */
function refuseIntoDescendant(realSrc: string, realDstDir: string, verb: string): void {
  const srcPrefix = realSrc.endsWith(sep) ? realSrc : realSrc + sep;
  if (realDstDir === realSrc || realDstDir.startsWith(srcPrefix)) {
    throw new Error(`Cannot ${verb} a folder into itself or a descendant.`);
  }
}

export async function copy(srcRel: string, destDir: string): Promise<string> {
  const realSrc = await confineExisting(srcRel);
  const realDstDir = await confineExisting(destDir);
  refuseIntoDescendant(realSrc, realDstDir, 'copy');
  const leaf = await uniqueLeaf(realDstDir, basename(realSrc));
  const dest = join(realDstDir, leaf);
  // Raw byte copy: at-rest bytes are already valid under the current vault DEK.
  await cp(realSrc, dest, { recursive: true });
  return relOf(dest);
}

export async function move(srcRel: string, destDir: string): Promise<string> {
  const realSrc = await confineExisting(srcRel);
  const realDstDir = await confineExisting(destDir);
  refuseIntoDescendant(realSrc, realDstDir, 'move');
  const leaf = await uniqueLeaf(realDstDir, basename(realSrc));
  const dest = join(realDstDir, leaf);
  await fsRename(realSrc, dest);
  return relOf(dest);
}

export async function importDropped(
  destDir: string,
  files: { sourcePath: string; originalName: string }[]
): Promise<DocImportResult> {
  const realDstDir = await confineExisting(destDir); // dest folder must exist + be inside root
  const imported: DocEntry[] = [];
  const failures: { originalName: string; error: string }[] = [];
  for (const f of files) {
    try {
      const leaf = await uniqueLeaf(realDstDir, f.originalName);
      const dest = join(realDstDir, leaf);
      const bytes = await readFile(f.sourcePath); // plaintext host file, outside dataRoot
      await secureWriteFile(dest, bytes); // encrypts iff the vault is unlocked
      const s = await stat(dest);
      imported.push({ name: leaf, kind: 'file', size: bytes.length, modifiedAt: s.mtime.toISOString() });
    } catch (err) {
      failures.push({ originalName: f.originalName, error: (err as Error).message });
    }
  }
  return { imported, failures };
}

/** Open a FILE in the OS default app. Encrypted-at-rest files are decrypted into a session-scoped
 *  temp (shredded on quit); plaintext files (vault off) are opened in place. Folders are refused. */
export async function openEntry(relPath: string): Promise<void> {
  const real = await confineExisting(relPath);
  if ((await stat(real)).isDirectory()) throw new Error('Refusing to open a folder.');
  let target = real;
  if (await isEncryptedFile(real)) {
    target = await stageDecryptedTemp(await secureReadFile(real), basename(real));
  }
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
}

/** Export one decrypted copy of a FILE to a user-chosen destination (outside the confinement root,
 *  by design). Refuses a folder and a symlink destination (can't be redirected to clobber a file). */
export async function exportEntry(relPath: string, destPath: string): Promise<void> {
  const real = await confineExisting(relPath);
  if ((await stat(real)).isDirectory()) throw new Error('Refusing to export a folder.');
  const existing = await lstat(destPath).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error('Refusing to export onto a symlink.');
  // Export writes PLAINTEXT — refuse a destination inside the encrypted documents store, or the copy
  // would sit as cleartext among the ciphertext corpus (weakening encrypt-at-rest and breaking the
  // magic-byte assumption). realpath the parent (destPath itself may not exist yet — it's a save target).
  const root = await realpath(documentsRoot());
  const destParent = await realpath(dirname(destPath));
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (destParent === root || destParent.startsWith(prefix)) {
    throw new Error('Choose a destination outside My Documents — exporting into the encrypted store would leave a plaintext copy.');
  }
  await writeFile(destPath, await secureReadFile(real));
}
