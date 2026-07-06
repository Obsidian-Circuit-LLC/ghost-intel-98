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
  // Request-sequencing: a slow list() for a folder the user has since left must NOT overwrite the
  // current folder's contents. `dirRef` always holds the live dir; `reqSeq` orders concurrent
  // refreshes so only the latest-issued result for the still-current dir is applied.
  const dirRef = useRef(dir);
  const reqSeq = useRef(0);
  useEffect(() => { dirRef.current = dir; }, [dir]);

  const refresh = useCallback(async (target = dirRef.current) => {
    const seq = ++reqSeq.current;
    try {
      const list = await window.api.documents.list(target);
      if (seq !== reqSeq.current || target !== dirRef.current) return; // superseded / user navigated away
      setEntries(list);
      setError(null);
    } catch (e) {
      if (seq !== reqSeq.current || target !== dirRef.current) return;
      setError((e as Error).message);
      setEntries([]);
    }
  }, []);

  useEffect(() => { void refresh(dir); }, [dir, refresh]);

  const enter = useCallback((folder: string) => setDir((d) => joinRel(d, folder)), []);
  const up = useCallback(() => setDir((d) => parentRel(d)), []);
  const goRoot = useCallback(() => setDir(''), []);

  const newFolder = useCallback(async (name: string) => {
    try {
      await window.api.documents.mkdir(dir, name);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [dir, refresh]);
  const rename = useCallback(async (rel: string, newName: string) => {
    try {
      await window.api.documents.rename(rel, newName);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [refresh]);
  const remove = useCallback(async (rel: string) => {
    try {
      await window.api.documents.remove(rel);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [refresh]);
  const paste = useCallback(async () => {
    const c = clipboard.current;
    if (!c) return;
    try {
      if (c.op === 'copy') await window.api.documents.copy(c.relPath, dir);
      else { await window.api.documents.move(c.relPath, dir); clipboard.current = null; }
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [dir, refresh]);
  const importFiles = useCallback(async (files: { sourcePath: string; originalName: string }[]) => {
    try {
      const res = await window.api.documents.importDropped(dir, files);
      await refresh(); // clears error on a clean list; the failure notice below re-sets it if needed
      if (res.failures.length > 0) {
        const names = res.failures.map((f) => f.originalName).join(', ');
        setError(`Failed to import ${res.failures.length} file(s): ${names}`);
      }
    } catch (e) { setError((e as Error).message); }
  }, [dir, refresh]);
  const reveal = useCallback((rel = dir) => { void window.api.documents.reveal(rel); }, [dir]);

  return { dir, entries, error, clipboard, enter, up, goRoot, refresh, newFolder, rename, remove, paste, importFiles, reveal };
}
