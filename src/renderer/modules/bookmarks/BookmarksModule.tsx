/**
 * Bookmarks — an offline, self-owned start.me-style link dashboard.
 *
 * A board of category "cards" (widgets), each an ordered list of named links. Add categories
 * and links, drag to reorganize, and Share/Import the whole board as a portable .ghostbookmarks
 * file. Per-link icon is your choice: a default glyph, an emoji you pick, or a real favicon
 * (fetched only when you enable network — off by default, the only egress this module can do).
 * Clicking a link opens it in the bundled Firefox launcher. The board persists encrypted-at-rest
 * when login is on. Nothing here depends on a third-party site staying up.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookmarkBoard, BookmarkCategory, BookmarkLink } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';

function uid(): string { return crypto.randomUUID(); }
const EMPTY: BookmarkBoard = { categories: [], networkEnabled: false };

interface Editing { catId: string; link: BookmarkLink; isNew: boolean }

export function BookmarksModule(): JSX.Element {
  const [board, setBoard] = useState<BookmarkBoard>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Drag state: a card index, or a link with its source category.
  const drag = useRef<{ kind: 'card'; catId: string } | { kind: 'link'; catId: string; linkId: string } | null>(null);

  useEffect(() => {
    void window.api.bookmarks.get().then((b) => { setBoard(b ?? EMPTY); setLoaded(true); });
  }, []);

  // Persist on every mutation (board is small; no debounce needed).
  const persist = useCallback((next: BookmarkBoard) => {
    setBoard(next);
    void window.api.bookmarks.save(next).catch((err) => toast.error(`Save failed: ${(err as Error).message}`));
  }, []);

  const mutateCats = useCallback((fn: (cats: BookmarkCategory[]) => BookmarkCategory[]) => {
    persist({ ...board, categories: fn(board.categories) });
  }, [board, persist]);

  function addCategory(): void {
    mutateCats((cats) => [...cats, { id: uid(), title: 'New category', links: [] }]);
  }
  function renameCategory(catId: string, title: string): void {
    mutateCats((cats) => cats.map((c) => c.id === catId ? { ...c, title } : c));
  }
  async function deleteCategory(catId: string): Promise<void> {
    const c = board.categories.find((x) => x.id === catId);
    if (c && c.links.length > 0 && !(await confirmDialog(`Delete "${c.title}" and its ${c.links.length} link(s)?`, 'Delete category'))) return;
    mutateCats((cats) => cats.filter((x) => x.id !== catId));
  }
  function saveLink(catId: string, link: BookmarkLink): void {
    mutateCats((cats) => cats.map((c) => {
      if (c.id !== catId) return c;
      const exists = c.links.some((l) => l.id === link.id);
      return { ...c, links: exists ? c.links.map((l) => l.id === link.id ? link : l) : [...c.links, link] };
    }));
  }
  function deleteLink(catId: string, linkId: string): void {
    mutateCats((cats) => cats.map((c) => c.id === catId ? { ...c, links: c.links.filter((l) => l.id !== linkId) } : c));
  }
  // --- drag/drop reorganize ---
  function moveCardBefore(targetCatId: string): void {
    const d = drag.current;
    if (!d || d.kind !== 'card' || d.catId === targetCatId) return;
    mutateCats((cats) => {
      const from = cats.findIndex((c) => c.id === d.catId);
      const moving = cats[from];
      const rest = cats.filter((c) => c.id !== d.catId);
      const to = rest.findIndex((c) => c.id === targetCatId);
      rest.splice(to < 0 ? rest.length : to, 0, moving);
      return rest;
    });
  }
  function dropLinkOnCategory(targetCatId: string, beforeLinkId?: string): void {
    const d = drag.current;
    if (!d || d.kind !== 'link') return;
    mutateCats((cats) => {
      const src = cats.find((c) => c.id === d.catId);
      const moving = src?.links.find((l) => l.id === d.linkId);
      if (!moving) return cats;
      return cats.map((c) => {
        if (c.id === d.catId) c = { ...c, links: c.links.filter((l) => l.id !== d.linkId) };
        if (c.id === targetCatId) {
          const links = [...c.links];
          const idx = beforeLinkId ? links.findIndex((l) => l.id === beforeLinkId) : -1;
          links.splice(idx < 0 ? links.length : idx, 0, moving);
          c = { ...c, links };
        }
        return c;
      });
    });
  }

  function open(url: string, name: string): void {
    void window.api.browser.launchFirefox(url, name).catch((err) => toast.error(`Could not open: ${(err as Error).message}`));
  }

  async function shareBoard(): Promise<void> {
    try {
      const path = await window.api.bookmarks.exportBoard();
      if (path) toast.success(`Shared board → ${path}`);
    } catch (err) { toast.error(`Export failed: ${(err as Error).message}`); }
  }
  async function importBoard(): Promise<void> {
    try {
      const incoming = await window.api.bookmarks.importBoard();
      if (!incoming) return;
      const replace = await confirmDialog(
        `Import ${incoming.categories.length} categor${incoming.categories.length === 1 ? 'y' : 'ies'}. ` +
          'OK = REPLACE your board; Cancel = MERGE (append).',
        'Import bookmarks'
      );
      const next = replace
        ? { ...board, categories: incoming.categories }
        : { ...board, categories: [...board.categories, ...incoming.categories] };
      persist(next);
      toast.success(replace ? 'Board replaced.' : 'Board merged.');
    } catch (err) { toast.error(`Import failed: ${(err as Error).message}`); }
  }

  if (!loaded) return <div style={{ padding: 16, color: '#666' }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={addCategory}>+ Category</button>
        <button onClick={() => void shareBoard()} disabled={board.categories.length === 0} title="Export this board to a .ghostbookmarks file to share">Share…</button>
        <button onClick={() => void importBoard()}>Import…</button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }} title="Allow fetching real favicons over the network. Off by default — links still work offline with a glyph or emoji.">
          <input
            type="checkbox"
            checked={board.networkEnabled}
            onChange={(e) => persist({ ...board, networkEnabled: e.target.checked })}
          /> Fetch favicons (network)
        </label>
      </div>

      <div className="ga98-bm-board">
        {board.categories.length === 0 && (
          <div style={{ color: '#666', padding: 16 }}>No categories yet. Click <b>+ Category</b> to start your board.</div>
        )}
        {board.categories.map((c) => (
          <div
            key={c.id}
            className="ga98-bm-card window"
            onDragOver={(e) => { if (drag.current?.kind === 'link') e.preventDefault(); }}
            onDrop={() => { if (drag.current?.kind === 'link') dropLinkOnCategory(c.id); }}
          >
            <div
              className="title-bar"
              draggable
              onDragStart={() => { drag.current = { kind: 'card', catId: c.id }; }}
              onDragEnd={() => { drag.current = null; }}
              onDragOver={(e) => { if (drag.current?.kind === 'card') e.preventDefault(); }}
              onDrop={() => { if (drag.current?.kind === 'card') moveCardBefore(c.id); }}
              title="Drag to reorder this card"
            >
              <input
                className="ga98-bm-title-input"
                value={c.title}
                onChange={(e) => renameCategory(c.id, e.target.value)}
                aria-label="Category title"
              />
              <div className="title-bar-controls">
                <button aria-label="Close" onClick={() => void deleteCategory(c.id)} />
              </div>
            </div>
            <div className="window-body ga98-bm-links">
              {c.links.map((l) => (
                <div
                  key={l.id}
                  className="ga98-bm-link"
                  draggable
                  onDragStart={(e) => { drag.current = { kind: 'link', catId: c.id, linkId: l.id }; e.stopPropagation(); }}
                  onDragEnd={() => { drag.current = null; }}
                  onDragOver={(e) => { if (drag.current?.kind === 'link') { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={(e) => { if (drag.current?.kind === 'link') { e.stopPropagation(); dropLinkOnCategory(c.id, l.id); } }}
                >
                  <span className="ga98-bm-icon" aria-hidden="true">
                    {l.emoji ? l.emoji : l.favicon ? <img src={l.favicon} alt="" width={16} height={16} /> : '🔖'}
                  </span>
                  <button className="ga98-bm-link-open" onClick={() => open(l.url, l.name)} title={l.url}>{l.name}</button>
                  <button className="ga98-bm-link-edit" onClick={() => setEditing({ catId: c.id, link: { ...l }, isNew: false })} title="Edit">✎</button>
                  <button className="ga98-bm-link-edit" onClick={() => deleteLink(c.id, l.id)} title="Remove">×</button>
                </div>
              ))}
              <button
                className="ga98-bm-add-link"
                onClick={() => setEditing({ catId: c.id, link: { id: uid(), name: '', url: 'https://' }, isNew: true })}
              >+ Add link</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <LinkEditor
          editing={editing}
          networkEnabled={board.networkEnabled}
          onCancel={() => setEditing(null)}
          onSave={(link) => { saveLink(editing.catId, link); setEditing(null); }}
        />
      )}
    </div>
  );
}

function LinkEditor({ editing, networkEnabled, onCancel, onSave }: {
  editing: Editing;
  networkEnabled: boolean;
  onCancel: () => void;
  onSave: (link: BookmarkLink) => void;
}): JSX.Element {
  const [name, setName] = useState(editing.link.name);
  const [url, setUrl] = useState(editing.link.url);
  const [emoji, setEmoji] = useState(editing.link.emoji ?? '');
  const [favicon, setFavicon] = useState(editing.link.favicon);
  const [fetching, setFetching] = useState(false);

  async function fetchIcon(): Promise<void> {
    setFetching(true);
    try {
      const data = await window.api.bookmarks.fetchFavicon(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (data) { setFavicon(data); setEmoji(''); toast.success('Favicon fetched.'); }
      else toast.warn('No favicon found (or network is off).');
    } catch (err) { toast.error(`Fetch failed: ${(err as Error).message}`); }
    finally { setFetching(false); }
  }

  function commit(): void {
    const u = url.trim();
    if (!u) { toast.warn('URL is required.'); return; }
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    onSave({ id: editing.link.id, name: name.trim() || full, url: full, emoji: emoji || undefined, favicon: emoji ? undefined : favicon });
  }

  return (
    <div className="ga98-dialog-veil">
      <div className="window" style={{ width: 420 }}>
        <div className="title-bar"><div className="title-bar-text">{editing.isNew ? 'Add link' : 'Edit link'}</div></div>
        <div className="window-body ga98-stack">
          <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center' }}>
            <label>Name:</label>
            <input className="ga98-text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
            <label>URL:</label>
            <input className="ga98-text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
            <label>Emoji:</label>
            <input className="ga98-text" value={emoji} maxLength={4} onChange={(e) => { setEmoji(e.target.value); if (e.target.value) setFavicon(undefined); }} placeholder="optional, e.g. 🦊" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span>Icon:</span>
            <span className="ga98-bm-icon">{emoji ? emoji : favicon ? <img src={favicon} alt="" width={16} height={16} /> : '🔖'}</span>
            <button onClick={() => void fetchIcon()} disabled={!networkEnabled || fetching} title={networkEnabled ? 'Fetch the real favicon' : 'Enable "Fetch favicons (network)" first'}>
              {fetching ? 'Fetching…' : 'Fetch favicon'}
            </button>
            {favicon && <button onClick={() => setFavicon(undefined)}>Clear icon</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={commit}>Save</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
