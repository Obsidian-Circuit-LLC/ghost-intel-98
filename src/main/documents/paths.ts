/**
 * On-disk paths for the global My Documents store. Rooted at dataRoot()/documents.
 * resolveWithin() assumes its argument was already validated by ensureDocRelPath;
 * confinement (realpath prefix) is enforced by the store, not here.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';

export function documentsRoot(): string {
  return join(dataRoot(), 'documents');
}

/** Join the (already-validated) relative path onto documentsRoot. `''` returns the root. */
export function resolveWithin(rel: string): string {
  return rel === '' ? documentsRoot() : join(documentsRoot(), rel);
}

export async function ensureDocumentsRoot(): Promise<void> {
  await mkdir(documentsRoot(), { recursive: true });
}
