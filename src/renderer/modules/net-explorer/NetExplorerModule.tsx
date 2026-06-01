/**
 * Net Explorer — Firefox Portable launcher.
 *
 * v3.3 swap: the in-process Electron <webview> browser was replaced (operator decision) by a
 * launcher that opens URLs in a bundled Firefox Portable as a separate OS process. The trade
 * was made knowingly — it loses the embedded retro chrome and live tab capture, but routes all
 * browsing through Firefox's own engine. The app keeps the parts that matter for casework:
 * an address bar, a bookmark bar, save-URL-to-case, and a record of launched URLs.
 *
 * Security: the renderer can only pass a URL. The main process spawns ONLY the bundled
 * executable (resources/firefox/) with the URL as a single non-shell argument — see
 * services/firefox.ts. No renderer-supplied executable path is ever accepted.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CaseSummary } from '@shared/types';
import type { Bookmark, HistoryEntry } from '../../../preload/api';
import { toast } from '../../state/toasts';
import { confirmDialog, promptDialog } from '../../state/dialogs';

export function NetExplorerModule(): JSX.Element {
  const [status, setStatus] = useState<{ installed: boolean; path: string | null } | null>(null);
  const [address, setAddress] = useState('https://');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [saveCase, setSaveCase] = useState('');

  useEffect(() => { void window.api.browser.firefoxStatus().then(setStatus); }, []);
  useEffect(() => { void window.api.cases.list().then(setCases); }, []);
  useEffect(() => { void refreshBookmarks(); }, []);

  async function refreshBookmarks(): Promise<void> {
    setBookmarks(await window.api.browser.listBookmarks());
  }
  async function refreshHistory(): Promise<void> {
    setHistory(await window.api.browser.listHistory(200));
  }

  const launch = useCallback(async (raw?: string) => {
    const input = (raw ?? address).trim();
    if (!input) return;
    const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    try {
      await window.api.browser.launchFirefox(url, url);
      setAddress(url);
    } catch (err) {
      toast.error(`Could not open Firefox: ${(err as Error).message}`);
    }
  }, [address]);

  async function bookmarkCurrent(): Promise<void> {
    const url = address.trim();
    if (!url) return;
    const title = await promptDialog('Bookmark title:', url, 'Add bookmark');
    if (!title) return;
    try {
      await window.api.browser.addBookmark(title, /^https?:\/\//i.test(url) ? url : `https://${url}`);
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

  async function saveToCase(): Promise<void> {
    const url = address.trim();
    if (!saveCase || !url) return;
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      await window.api.cases.addLink(saveCase, full, full);
      const c = cases.find((x) => x.id === saveCase);
      toast.success(`Link added to ${c?.title ?? 'case'}.`);
    } catch (err) {
      toast.error(`Add link failed: ${(err as Error).message}`);
    }
  }

  async function openHistoryPanel(): Promise<void> {
    setShowHistory(true);
    await refreshHistory();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <input
          className="ga98-text"
          style={{ flex: 1 }}
          value={address}
          placeholder="https://…  (opens in Firefox)"
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void launch(); }}
        />
        <button onClick={() => void launch()} title="Open this URL in Firefox">Open in Firefox</button>
        <button onClick={() => void bookmarkCurrent()} title="Add bookmark">★</button>
        <button onClick={() => void openHistoryPanel()} title="Launched URLs">History</button>
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
              onClick={() => void launch(bm.url)}
              onContextMenu={(e) => { e.preventDefault(); void deleteBookmark(bm.id); }}
              title={`${bm.url} — click to open in Firefox, right-click to remove`}
            >
              {bm.title}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 14 }}>
        <div style={{ fontSize: 40 }}>🦊</div>
        <h3 style={{ margin: 0 }}>Browse with Firefox Portable</h3>
        {status === null ? (
          <p style={{ color: '#666' }}>Checking for the bundled Firefox…</p>
        ) : status.installed ? (
          <>
            <p style={{ maxWidth: 460, color: '#333' }}>
              Type a URL above (or pick a bookmark) and choose <b>Open in Firefox</b>. Pages open in a
              separate Firefox window with its own engine, cookies, and downloads. Use <b>Save URL</b> to
              attach the address to a case.
            </p>
            <p style={{ fontSize: 11, color: '#777', wordBreak: 'break-all' }}>Firefox: {status.path}</p>
          </>
        ) : (
          <div className="ga98-firefox-missing">
            <p style={{ maxWidth: 480, color: '#900' }}>
              <b>Firefox Portable isn&rsquo;t installed yet.</b> Drop the Firefox Portable files into
              <code> resources/firefox/ </code> (so that one of <code>FirefoxPortable.exe</code>,
              <code> firefox.exe</code>, or <code>App/Firefox64/firefox.exe</code> exists) and rebuild the
              installer. Until then, URLs can still be saved to cases and bookmarked, but won&rsquo;t open.
            </p>
          </div>
        )}
      </div>

      <div className="ga98-statusbar">
        <span>{status?.installed ? 'Firefox ready' : 'Firefox not bundled'}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => void clearHistoryConfirmed(refreshHistory)} style={{ fontSize: 10, padding: '0 4px' }}>Clear history…</button>
      </div>

      {showHistory && (
        <HistoryPanel
          entries={history}
          onClose={() => setShowHistory(false)}
          onOpen={(url) => { void launch(url); setShowHistory(false); }}
          onClear={async () => { await window.api.browser.clearHistory(); await refreshHistory(); toast.success('History cleared.'); }}
        />
      )}
    </div>
  );
}

async function clearHistoryConfirmed(refresh: () => Promise<void>): Promise<void> {
  const ok = await confirmDialog('Clear the record of URLs launched from here?', 'Clear history');
  if (!ok) return;
  try {
    await window.api.browser.clearHistory();
    await refresh();
    toast.success('History cleared.');
  } catch (err) {
    toast.error(`Clear failed: ${(err as Error).message}`);
  }
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
          <div className="title-bar-text">Launched URLs</div>
          <div className="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="window-body" style={{ overflow: 'auto', flex: 1 }}>
          {entries.length === 0
            ? <p style={{ color: '#666' }}>No URLs launched yet.</p>
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
