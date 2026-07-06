import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocEntry } from '../../../shared/documents-types';

export interface ClipboardRef { op: 'copy' | 'cut'; relPath: string; }

/** Joins the current dir with a leaf, avoiding a leading slash at the root. */
export function joinRel(dir: string, leaf: string): string {
  return dir === '' ? leaf : `${dir}/${leaf}`;
}
/** Parent directory of a relative path (`''` if already at the top level). */
export function parentRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export function useDocuments() {
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clipboard = useRef<ClipboardRef | null>(null);

  const refresh = useCallback(async (target = dir) => {
    try {
      setEntries(await window.api.documents.list(target));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    }
  }, [dir]);

  useEffect(() => { void refresh(dir); }, [dir, refresh]);

  const enter = useCallback((folder: string) => setDir((d) => joinRel(d, folder)), []);
  const up = useCallback(() => setDir((d) => parentRel(d)), []);

  const newFolder = useCallback(async (name: string) => {
    await window.api.documents.mkdir(dir, name);
    await refresh();
  }, [dir, refresh]);
  const rename = useCallback(async (rel: string, newName: string) => {
    await window.api.documents.rename(rel, newName);
    await refresh();
  }, [refresh]);
  const remove = useCallback(async (rel: string) => {
    await window.api.documents.remove(rel);
    await refresh();
  }, [refresh]);
  const paste = useCallback(async () => {
    const c = clipboard.current;
    if (!c) return;
    if (c.op === 'copy') await window.api.documents.copy(c.relPath, dir);
    else { await window.api.documents.move(c.relPath, dir); clipboard.current = null; }
    await refresh();
  }, [dir, refresh]);
  const importFiles = useCallback(async (files: { sourcePath: string; originalName: string }[]) => {
    await window.api.documents.importDropped(dir, files);
    await refresh();
  }, [dir, refresh]);
  const reveal = useCallback((rel = dir) => { void window.api.documents.reveal(rel); }, [dir]);

  return { dir, entries, error, clipboard, enter, up, refresh, newFolder, rename, remove, paste, importFiles, reveal };
}
