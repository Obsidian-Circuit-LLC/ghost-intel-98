/**
 * Net Explorer v2 — multi-tab internal browser with bookmark bar and history panel.
 *
 * Implementation notes: each tab owns its own <webview>. We keep all webviews mounted
 * but only the active one visible (so back/forward + scroll state survives tab switches).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import type { Bookmark, HistoryEntry } from '../../../preload/api';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog, promptDialog } from '../../state/dialogs';

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
}

interface Tab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

function newTabId(): string {
  return `tab-${crypto.randomUUID()}`;
}

export function NetExplorerModule(): JSX.Element {
  const homepage = useSettings((s) => s.settings?.browser.homepage ?? 'about:blank');
  const [tabs, setTabs] = useState<Tab[]>([{ id: newTabId(), url: homepage, title: 'New tab', loading: false }]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const [address, setAddress] = useState(homepage);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [saveCase, setSaveCase] = useState('');
  const refs = useRef<Map<string, WebviewElement | null>>(new Map());

  const activeTab = tabs.find((t) => t.id === activeId);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);
  useEffect(() => { void refreshBookmarks(); }, []);

  async function refreshBookmarks(): Promise<void> {
    setBookmarks(await window.api.browser.listBookmarks());
  }
  async function refreshHistory(): Promise<void> {
    setHistory(await window.api.browser.listHistory(200));
  }

  // Per-tab webview event wiring
  useEffect(() => {
    const wv = refs.current.get(activeId);
    if (!wv) return;
    function onStart(): void {
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, loading: true } : t));
    }
    function onStop(): void {
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, loading: false } : t));
    }
    function onNav(e: Event & { url?: string }): void {
      const u = e.url ?? (wv?.getURL() ?? '');
      setAddress(u);
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, url: u } : t));
      // Log to history (best-effort; failures are user-visible only via toast if persistent)
      void window.api.browser.addHistory(u, wv?.getTitle() ?? u).catch(() => {});
    }
    function onTitle(e: Event & { title?: string }): void {
      const title = e.title ?? wv?.getTitle() ?? '';
      setTabs((ts) => ts.map((t) => t.id === activeId ? { ...t, title } : t));
    }
    if (!wv) return;
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-navigate', onNav as EventListener);
    wv.addEventListener('did-navigate-in-page', onNav as EventListener);
    wv.addEventListener('page-title-updated', onTitle as EventListener);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-navigate', onNav as EventListener);
      wv.removeEventListener('did-navigate-in-page', onNav as EventListener);
      wv.removeEventListener('page-title-updated', onTitle as EventListener);
    };
  }, [activeId]);

  useEffect(() => {
    setAddress(activeTab?.url ?? '');
  }, [activeId, activeTab?.url]);

  const go = useCallback((u?: string) => {
    const wv = refs.current.get(activeId);
    if (!wv) return;
    const raw = u ?? address;
    const normalised = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    wv.src = normalised;
    setAddress(normalised);
  }, [address, activeId]);

  function newTab(initial = 'about:blank'): void {
    const t: Tab = { id: newTabId(), url: initial, title: 'New tab', loading: false };
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }

  function closeTab(id: string): void {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh: Tab = { id: newTabId(), url: 'about:blank', title: 'New tab', loading: false };
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) {
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
    refs.current.delete(id);
  }

  async function bookmarkCurrent(): Promise<void> {
    if (!activeTab) return;
    const title = await promptDialog('Bookmark title:', activeTab.title, 'Add bookmark');
    if (!title) return;
    try {
      await window.api.browser.addBookmark(title, activeTab.url);
      await refreshBookmarks();
      toast.success('Bookmark added.');
    } catch (err) {
      toast.error(`Bookmark failed: ${(err as Error).message}`);
    }
  }

  async function deleteBookmark(id: string): Promise<void> {
    const ok = await confirmDialog('Remove this bookmark?', 'Delete bookmark');
    if (!ok) return;
    await window.api.browser.deleteBookmark(id);
    await refreshBookmarks();
  }

  async function openHistoryPanel(): Promise<void> {
    setShowHistory(true);
    await refreshHistory();
  }

  async function saveToCase(): Promise<void> {
    if (!saveCase || !activeTab) return;
    try {
      await window.api.cases.addLink(saveCase, activeTab.url, activeTab.title || activeTab.url);
      const c = cases.find((x) => x.id === saveCase);
      toast.success(`Link added to ${c?.title ?? 'case'}.`);
    } catch (err) {
      toast.error(`Add link failed: ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div className="ga98-tabbar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className="ga98-tab"
            data-active={t.id === activeId}
            onClick={() => setActiveId(t.id)}
            title={t.url}
          >
            <span className="ga98-tab-title">{t.loading ? '⟳ ' : ''}{t.title || t.url}</span>
            <button
              className="ga98-tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              aria-label="Close tab"
            >×</button>
          </div>
        ))}
        <button className="ga98-tab-new" onClick={() => newTab()} title="New tab">+</button>
      </div>

      {/* Toolbar */}
      <div className="ga98-toolbar">
        <button onClick={() => refs.current.get(activeId)?.goBack()} title="Back">‹</button>
        <button onClick={() => refs.current.get(activeId)?.goForward()} title="Forward">›</button>
        <button onClick={() => refs.current.get(activeId)?.reload()} title="Reload">↻</button>
        <input
          className="ga98-text"
          style={{ flex: 1 }}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        />
        <button onClick={() => go()} title="Go">Go</button>
        <button onClick={() => void bookmarkCurrent()} title="Add bookmark">★</button>
        <button onClick={() => void openHistoryPanel()} title="History">History</button>
        <select className="ga98-text" value={saveCase} onChange={(e) => setSaveCase(e.target.value)}>
          <option value="">(select case…)</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={() => void saveToCase()} disabled={!saveCase}>Save URL</button>
      </div>

      {/* Bookmark bar */}
      {bookmarks.length > 0 && (
        <div className="ga98-bookmark-bar">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              className="ga98-bookmark"
              onClick={() => go(bm.url)}
              onContextMenu={(e) => { e.preventDefault(); void deleteBookmark(bm.id); }}
              title={`${bm.url} — right-click to remove`}
            >
              {bm.title}
            </button>
          ))}
        </div>
      )}

      {/* Webview stack — all mounted, only active one visible */}
      <div style={{ flex: 1, background: '#fff', position: 'relative' }}>
        {tabs.map((t) => (
          <webview
            key={t.id}
            ref={(el) => { refs.current.set(t.id, el as unknown as WebviewElement); }}
            src={t.url}
            style={{
              position: 'absolute',
              inset: 0,
              display: t.id === activeId ? 'inline-flex' : 'none'
            }}
            partition="persist:netexplorer"
          />
        ))}
      </div>

      <div className="ga98-statusbar">
        <span>{activeTab?.loading ? 'Loading…' : 'Idle'}</span>
        <span style={{ flex: 1 }} />
        <span>{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
      </div>

      {showHistory && (
        <HistoryPanel
          entries={history}
          onClose={() => setShowHistory(false)}
          onOpen={(url) => { go(url); setShowHistory(false); }}
          onClear={async () => { await window.api.browser.clearHistory(); await refreshHistory(); toast.success('History cleared.'); }}
        />
      )}
    </div>
  );
}

function HistoryPanel({ entries, onClose, onOpen, onClear }: {
  entries: HistoryEntry[];
  onClose: () => void;
  onOpen: (url: string) => void;
  onClear: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="ga98-dialog-veil">
      <div className="window" style={{ width: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="title-bar">
          <div className="title-bar-text">History</div>
          <div className="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="window-body" style={{ overflow: 'auto', flex: 1 }}>
          {entries.length === 0
            ? <p style={{ color: '#666' }}>No history yet.</p>
            : (
              <ul className="ga98-list">
                {entries.map((h) => (
                  <li key={h.id} onClick={() => onOpen(h.url)} style={{ cursor: 'pointer' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b>{h.title || h.url}</b>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{h.url}</div>
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{new Date(h.visitedAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #808080' }}>
          <button onClick={() => void onClear()} disabled={entries.length === 0}>Clear all</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
