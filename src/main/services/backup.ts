/**
 * Full session backup / restore. A backup is a .ga98 zip of the entire userData data root;
 * restore extracts it back over the data root (overwrite-merge). Note: secrets.enc is bound
 * to the OS keyring (DPAPI on Windows) so it won't decrypt after a move to another machine —
 * Mail/SSH/AI credentials must be re-entered there (surfaced in the UI).
 *
 * SECURITY: restore guards every entry against Zip-Slip via ensureWithin — a crafted archive
 * cannot write outside the data root.
 */
import AdmZip from 'adm-zip';
import { join, dirname } from 'node:path';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dataRoot, caseDir, caseFile } from '../storage/paths';
import { ensureWithin } from '../security/validate';
import { resolveCaseEntities, importEntities } from '../storage/entities';
import { secureReadFile, secureReadText, secureWriteFile } from '../storage/secure-fs';

/** Zip the whole data root to destPath. Skips transient *.tmp write files. */
export async function createBackup(destPath: string): Promise<void> {
  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const zip = new AdmZip();
  await zip.addLocalFolderPromise(root, { filter: (p: string) => !p.endsWith('.tmp') });
  await zip.writeZipPromise(destPath);
}

/** Extract a backup over the data root. Returns the count of files written. */
export async function restoreBackup(srcPath: string): Promise<{ files: number }> {
  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const zip = new AdmZip(srcPath);
  let files = 0;
  for (const entry of zip.getEntries()) {
    // ensureWithin throws if the resolved target escapes the data root (Zip-Slip guard).
    const target = ensureWithin(root, join(root, entry.entryName));
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.getData());
    files += 1;
  }
  return { files };
}

// ---------- per-case share (.ga98case) ----------

/** Recursively add a case dir to the zip under `case/`, DECRYPTING each file as it goes.
 *  A share bundle crosses to another user whose vault DEK differs from ours, so it must be
 *  plaintext — secureReadFile is a passthrough when the vault is off and decrypts when on. */
async function addCaseDirDecrypted(zip: AdmZip, caseId: string): Promise<void> {
  const base = caseDir(caseId);
  const walk = async (absDir: string, rel: string): Promise<void> => {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.endsWith('.tmp')) continue;
      const abs = join(absDir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { await walk(abs, childRel); continue; }
      zip.addFile(`case/${childRel}`, await secureReadFile(abs));
    }
  };
  await walk(base, '');
}

/** Export one case to a portable .ga98case bundle: the case dir under `case/`, the entity
 *  records it references, and a manifest. Shareable with another GA98 user.
 *  The bundle is PLAINTEXT by design (the recipient holds a different key); transmit it over
 *  a confidential channel. The importer re-encrypts it under their own vault on arrival. */
export async function exportCase(caseId: string, destPath: string): Promise<void> {
  const entities = (await resolveCaseEntities(caseId)).map((r) => r.entity);
  const manifest = { kind: 'ga98case', version: 1, originalCaseId: caseId, exportedAt: new Date().toISOString() };
  const zip = new AdmZip();
  await addCaseDirDecrypted(zip, caseId);
  zip.addFile('entities.json', Buffer.from(JSON.stringify(entities, null, 2), 'utf8'));
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  await zip.writeZipPromise(destPath);
}

/** Import a .ga98case bundle as a NEW case (fresh id), merging referenced entities into the
 *  registry. Zip-Slip guarded. Returns the new case id. */
export async function importCase(srcPath: string): Promise<{ caseId: string }> {
  const zip = new AdmZip(srcPath);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Not a Ghost Access 98 case bundle (no manifest).');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as { kind?: string };
  if (manifest.kind !== 'ga98case') throw new Error('Unrecognized bundle format.');

  const newId = randomUUID();
  const dest = caseDir(newId);
  await mkdir(dest, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith('case/')) continue;
    const rel = entry.entryName.slice('case/'.length);
    if (!rel) continue;
    const target = ensureWithin(dest, join(dest, rel)); // Zip-Slip guard
    if (entry.isDirectory) { await mkdir(target, { recursive: true }); continue; }
    await mkdir(dirname(target), { recursive: true });
    // Re-encrypt the (plaintext) bundle contents under THIS user's vault, if enabled.
    await secureWriteFile(target, entry.getData());
  }

  // Rewrite case.json to the new id (and mark it imported).
  try {
    const meta = JSON.parse(await secureReadText(caseFile(newId))) as Record<string, unknown>;
    meta['id'] = newId;
    meta['title'] = typeof meta['title'] === 'string' && meta['title'] ? `${meta['title']} (imported)` : 'Imported case';
    meta['updatedAt'] = new Date().toISOString();
    await secureWriteFile(caseFile(newId), JSON.stringify(meta, null, 2));
  } catch {
    throw new Error('Bundle is missing a valid case.json.');
  }

  // Merge the bundled entity records into the global registry.
  const entEntry = zip.getEntry('entities.json');
  if (entEntry) {
    try {
      const records = JSON.parse(entEntry.getData().toString('utf8'));
      if (Array.isArray(records)) await importEntities(records);
    } catch { /* tolerate a malformed entities.json — the case still imports */ }
  }
  return { caseId: newId };
}
