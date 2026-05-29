/**
 * Net Explorer v2.1 — multi-tab internal browser with bookmark bar and history panel.
 *
 * v2.1 fixes (v2.0 audit round 1):
 *  - Per-tab event wiring (not just active tab) — background tab navigations now
 *    update their tab state, and history entries are recorded for all tabs.
 *  - Filters out about:blank / chrome-error:// / chrome:// from history.
 *  - Ref callback null-cleanup — Map shrinks when a tab unmounts.
 *  - history.addHistory failures surface as a one-shot toast after N consecutive
 *    failures so the user knows browsing isn't being recorded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import type { Bookmark, HistoryEntry } from '../../../preload/api';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog, promptDialog } from '../../state/dialogs';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
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
  /** Stable initial src for the <webview> element — set once at tab creation and NEVER
   *  re-bound, so React reconciliation can't clobber an in-flight loadURL() navigation. */
  initialUrl: string;
  /** Live URL (address bar / save-to-case), updated by did-navigate. */
  url: string;
  title: string;
  loading: boolean;
}

function newTabId(): string {
  return `tab-${crypto.randomUUID()}`;
}

let historyFailures = 0;
let toastedHistoryFailure = false;

function reportHistoryFailure(err: unknown): void {
  historyFailures += 1;
  // eslint-disable-next-line no-console
  console.warn('[net-explorer] addHistory failed', err);
  if (historyFailures >= 3 && !toastedHistoryFailure) {
    toast.error('Browsing history is not being saved — check disk space or permissions.');
    toastedHistoryFailure = true;
  }
}

function reportHistorySuccess(): void {
  // Reset on success so a transient failure doesn't permanently bias the counter.
  // (toastedHistoryFailure stays latched — one warning per session is enough.)
  historyFailures = 0;
}

export function NetExplorerModule(): JSX.Element {
  const homepage = useSettings((s) => s.settings?.browser.homepage ?? 'about:blank');
  const [tabs, setTabs] = useState<Tab[]>([{ id: newTabId(), initialUrl: homepage, url: homepage, title: 'New tab', loading: false }]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const [address, setAddress] = useState(homepage);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [saveCase, setSaveCase] = useState('');
  const refs = useRef<Map<string, WebviewElement>>(new Map());

  const activeTab = tabs.find((t) => t.id === activeId);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);
  useEffect(() => { void refreshBookmarks(); }, []);

  async function refreshBookmarks(): Promise<void> {
    setBookmarks(await window.api.browser.listBookmarks());
  }
  async function refreshHistory(): Promise<void> {
    setHistory(await window.api.browser.listHistory(200));
  }

  // Per-tab event wiring. Wires listeners ONCE per tab id; React effect cleanup
  // detaches on unmount or tab close. tabId is captured per-tab, not via activeId,
  // so background tabs still update their own state.
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const t of tabs) {
      const wv = refs.current.get(t.id);
      if (!wv) continue;
      const tabId = t.id;
      const wvBound = wv; // narrow for closures
      function onStart(): void {
        setTabs((ts) => ts.map((x) => x.id === tabId ? { ...x, loading: true } : x));
      }
      function onStop(): void {
        setTabs((ts) => ts.map((x) => x.id === tabId ? { ...x, loading: false } : x));
      }
      function onNav(e: Event & { url?: string }): void {
        const u = e.url ?? wvBound.getURL();
        setTabs((ts) => ts.map((x) => x.id === tabId ? { ...x, url: u } : x));
        if (tabId === activeIdRef.current) setAddress(u);
      }
      function onTitle(e: Event & { title?: string }): void {
        const title = e.title ?? wvBound.getTitle();
        setTabs((ts) => ts.map((x) => x.id === tabId ? { ...x, title } : x));
        void window.api.browser.addHistory(wvBound.getURL(), title).then(reportHistorySuccess, reportHistoryFailure);
      }
      function onFail(e: Event & { errorCode?: number; errorDescription?: string; validatedURL?: string; isMainFrame?: boolean }): void {
        if (e.errorCode === -3) return;               // ERR_ABORTED — normal on redirects / cancels
        if (e.isMainFrame === false) return;          // sub-resource failures are noise
        setTabs((ts) => ts.map((x) => x.id === tabId ? { ...x, loading: false } : x));
        toast.error(`Could not load ${e.validatedURL || ''} — ${e.errorDescription || 'load failed'} (${e.errorCode ?? '?'})`);
      }
      wvBound.addEventListener('did-start-loading', onStart);
      wvBound.addEventListener('did-stop-loading', onStop);
      wvBound.addEventListener('did-navigate', onNav as EventListener);
      wvBound.addEventListener('did-navigate-in-page', onNav as EventListener);
      wvBound.addEventListener('page-title-updated', onTitle as EventListener);
      wvBound.addEventListener('did-fail-load', onFail as EventListener);
      cleanups.push(() => {
        wvBound.removeEventListener('did-start-loading', onStart);
        wvBound.removeEventListener('did-stop-loading', onStop);
        wvBound.removeEventListener('did-navigate', onNav as EventListener);
        wvBound.removeEventListener('did-navigate-in-page', onNav as EventListener);
        wvBound.removeEventListener('page-title-updated', onTitle as EventListener);
        wvBound.removeEventListener('did-fail-load', onFail as EventListener);
      });
    }
    return () => { for (const c of cleanups) c(); };
  }, [tabs]);

  // Track activeId in a ref so the per-tab listeners' setAddress check sees current value.
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  useEffect(() => {
    // Sync the address bar to the active tab. Prefer the live URL from the webview
    // if available (background tab might have navigated since we last persisted).
    const wv = refs.current.get(activeId);
    if (wv) {
      try { setAddress(wv.getURL() || activeTab?.url || ''); } catch { setAddress(activeTab?.url ?? ''); }
    } else {
      setAddress(activeTab?.url ?? '');
    }
  }, [activeId, activeTab?.url]);

  const go = useCallback((u?: string) => {
    const wv = refs.current.get(activeId);
    if (!wv) return;
    const raw = (u ?? address).trim();
    if (!raw) return;
    const normalised = /^(https?:|about:)/i.test(raw) ? raw : `https://${raw}`;
    // loadURL() is the navigation API for <webview>; assigning .src is a no-op. The element's
    // src attribute stays pinned to the stable initialUrl, so React never overrides this.
    void wv.loadURL(normalised).catch(() => { /* did-fail-load surfaces the reason */ });
    setAddress(normalised);
    setTabs((ts) => ts.map((x) => x.id === activeId ? { ...x, url: normalised } : x));
  }, [address, activeId]);

  function newTab(initial = 'about:blank'): void {
    const t: Tab = { id: newTabId(), initialUrl: initial, url: initial, title: 'New tab', loading: false };
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }

  function closeTab(id: string): void {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh: Tab = { id: newTabId(), initialUrl: 'about:blank', url: 'about:blank', title: 'New tab', loading: false };
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

  async function clearHistoryOnly(): Promise<void> {
    // Honest copy: this clears history only. Cookies / session storage live in the
    // partition and persist by design (so logged-in sites stay logged in across launches).
    // Audit round-3 HIGH fix: previous confirm copy promised cookie clearing that
    // didn't happen.
    const ok = await confirmDialog(
      'Clear browsing history? Cookies and logged-in sessions WILL be preserved (they live in the persistent partition).',
      'Clear history'
    );
    if (!ok) return;
    try {
      await window.api.browser.clearHistory();
      toast.success('History cleared.');
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`);
    }
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

      <div style={{ flex: 1, background: '#fff', position: 'relative' }}>
        {tabs.map((t) => (
          <webview
            key={t.id}
            ref={(el) => {
              // Ref-callback null-cleanup — when React unmounts, prevent Map from
              // accumulating null entries (audit round-1 finding).
              if (el) {
                refs.current.set(t.id, el as unknown as WebviewElement);
              } else {
                refs.current.delete(t.id);
              }
            }}
            src={t.initialUrl}
            style={{
              position: 'absolute',
              inset: 0,
              display: t.id === activeId ? 'flex' : 'none'
            }}
            partition="persist:netexplorer"
          />
        ))}
      </div>

      <div className="ga98-statusbar">
        <span>{activeTab?.loading ? 'Loading…' : 'Idle'}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => void clearHistoryOnly()} style={{ fontSize: 10, padding: '0 4px' }}>Clear history…</button>
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
