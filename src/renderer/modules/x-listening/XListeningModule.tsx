/**
 * X Listening Station — renderer UI (Tasks X1–X8, full wiring).
 *
 * Clearnet-quarantine module. Every capture runs MAIN-side in a hardened BrowserWindow on the
 * named clearnet partition (see src/main/capture/capture-window.ts); this renderer never touches
 * the network, never sees the auth token, and drives the main process ONLY through the
 * sender-validated `window.api.xListening` IPC group. Nothing here imports bgconn/Tor/socmint/
 * telegram code — the import-graph sentinel must stay green.
 *
 * Ported and re-shaped from the quarantine renderer (`src/main.tsx`) onto the real, honesty-
 * hardened IPC surface: target-source management, visible-post CAPTURE (with the collect toggles
 * sourced from AppSettings.xListening.collect — read/written via window.api.settings, enforced
 * MAIN-side), third-party comment capture, follower/following capture + CSV export, analyst NOTES
 * (the NotesPanel), low-rate ARCHIVE cycles, and JSON/CSV/PDF/DOCX export.
 *
 * Honesty (carried from the quarantine exemplar): the connect flow opens a real hardened login
 * window and the operator signs in directly to X — no cookie copying, and the auth token is never
 * read, echoed, or logged here (status is a derived boolean). Displayed fields are visible-only:
 * a missing display name is shown as "Not visible", NEVER as a fallback to the @handle; metrics
 * are the rounded tokens X rendered (approximate, never a false-precision integer); remote media
 * is never inlined (only local `data:` thumbnails are rendered).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotesPanel } from './panels/NotesPanel';
import './x-listening.css';

type XMetric = { raw?: string; value?: number; approx?: boolean };
type XFeedMetrics = { replies?: XMetric; reposts?: XMetric; likes?: XMetric; views?: XMetric };

/** A captured item as it rides through IPC — the base HarvestedItem plus the X-specific
 *  runtime fields (`kind`/`metrics`/`media`). Read defensively so a partial record never throws. */
interface XFeedItem {
  id: string;
  messageId?: string;
  channelId?: string;
  channelLabel?: string;
  authorHandle?: string;
  text?: string;
  url?: string;
  publishedAt?: string;
  kind?: string;
  media?: string[];
  metrics?: XFeedMetrics;
}

interface XNetworkAccount {
  handle: string;
  /** Optional — absent when no display name was visible; rendered as "Not visible", never the @handle. */
  displayName?: string;
  avatar?: string;
  bio?: string;
}
interface XNetworkResult {
  target: string;
  kind: 'followers' | 'following';
  accounts: XNetworkAccount[];
}

interface CollectSettings {
  replies: boolean;
  reposts: boolean;
  comments: boolean;
}

type Tab = 'sources' | 'feed' | 'network' | 'notes' | 'archive' | 'exports' | 'system';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sources', label: 'TARGET SOURCES' },
  { id: 'feed', label: 'LIVE FEED' },
  { id: 'network', label: 'FOLLOWER NETWORK' },
  { id: 'notes', label: 'ANALYST NOTES' },
  { id: 'archive', label: 'ARCHIVE' },
  { id: 'exports', label: 'EXPORTS' },
  { id: 'system', label: 'SYSTEM' }
];

const KIND_LABELS: Record<string, string> = {
  post: 'POST',
  reply: 'REPLY',
  repost: 'REPOST',
  comment: '3RD-PARTY COMMENT'
};

/** A visible X handle: 1–15 of [A-Za-z0-9_]. Mirrors the main-side guard so we never send a
 *  target the handler will reject. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function normalizeHandle(input: string): string {
  return String(input || '').trim().replace(/^@+/, '');
}

/** Decode an export result to bytes + trigger a browser download (mirrors SweepPanel). No remote
 *  fetch — the data came from the main-side exporter over IPC. */
function downloadExport(res: {
  data: string;
  encoding: 'utf8' | 'base64';
  mime: string;
  suggestedName: string;
}): void {
  let blob: Blob;
  if (res.encoding === 'base64') {
    const bin = atob(res.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: res.mime });
  } else {
    blob = new Blob([res.data], { type: res.mime });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render one metric token verbatim (approximate) or an em-dash when not visible. */
function metricToken(m: XMetric | undefined): string {
  const raw = String(m?.raw ?? '').trim();
  return raw || '—';
}

export function XListeningModule({ caseId }: { caseId?: string }): JSX.Element {
  const [tab, setTab] = useState<Tab>('sources');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Station ready.');

  const [targets, setTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('');

  const [items, setItems] = useState<XFeedItem[]>([]);
  const [network, setNetwork] = useState<XNetworkResult | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  const [collect, setCollect] = useState<CollectSettings>({
    replies: false,
    reposts: false,
    comments: false
  });
  const [archiveCycles, setArchiveCycles] = useState(false);
  const [archiveMaxCycles, setArchiveMaxCycles] = useState(3);

  // ── settings + status bootstrap ──────────────────────────────────────────
  const refreshSettings = useCallback(async () => {
    try {
      const s = (await window.api.settings.read()) as {
        xListening?: { collect?: Partial<CollectSettings>; archiveCycles?: boolean };
      };
      const c = s.xListening?.collect ?? {};
      setCollect({
        replies: c.replies === true,
        reposts: c.reposts === true,
        comments: c.comments === true
      });
      setArchiveCycles(s.xListening?.archiveCycles === true);
    } catch (err) {
      console.warn('[XListening] settings.read:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await window.api.xListening.status();
        if (active) setConnected(s.connected);
      } catch (err) {
        console.warn('[XListening] status:', err);
      }
    })();
    void refreshSettings();
    return () => {
      active = false;
    };
  }, [refreshSettings]);

  /** Wrap an async job with busy + notice + a session-status refresh. */
  const run = useCallback(async (job: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await job();
      setNotice(ok);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      try {
        const s = await window.api.xListening.status();
        setConnected(s.connected);
      } catch {
        /* keep last known state */
      }
    }
  }, []);

  const handleConnect = useCallback(() => {
    void run(async () => {
      await window.api.xListening.connect();
    }, 'X login window opened.');
  }, [run]);

  // ── target management (renderer-local; the app has no profile store) ──────
  const addTarget = useCallback(() => {
    const handle = normalizeHandle(newTarget);
    if (!HANDLE_RE.test(handle)) {
      setNotice('Enter a valid X handle (letters, numbers, underscore; up to 15 chars).');
      return;
    }
    setTargets((cur) => (cur.includes(handle) ? cur : [...cur, handle]));
    setSelectedTarget((cur) => cur || handle);
    setNewTarget('');
    setNotice(`Added @${handle}.`);
  }, [newTarget]);

  const removeTarget = useCallback((handle: string) => {
    setTargets((cur) => cur.filter((t) => t !== handle));
    setSelectedTarget((cur) => (cur === handle ? '' : cur));
  }, []);

  /** Merge new items into the feed, dedup by id, preserving order. */
  const mergeItems = useCallback((incoming: XFeedItem[]) => {
    setItems((cur) => {
      const seen = new Set(cur.map((i) => i.id));
      const next = [...cur];
      for (const it of incoming) {
        if (it && it.id && !seen.has(it.id)) {
          seen.add(it.id);
          next.push(it);
        }
      }
      return next;
    });
  }, []);

  const requireCase = useCallback((): string | null => {
    if (!caseId) {
      setNotice('Open the X Listening Station from a case to capture — no case is bound.');
      return null;
    }
    return caseId;
  }, [caseId]);

  // ── capture: visible timeline ────────────────────────────────────────────
  const captureTimeline = useCallback(
    (handle: string) => {
      const cid = requireCase();
      if (!cid || !handle) return;
      void run(async () => {
        const res = await window.api.xListening.capture({
          caseId: cid,
          channelId: handle,
          channelLabel: `@${handle}`
        });
        if (res.blocked) {
          setNotice(res.reason ?? 'Capture stopped — X presented a challenge.');
          return;
        }
        mergeItems((res.items ?? []) as unknown as XFeedItem[]);
        setNotice(`Captured @${handle}: ${res.added} new, ${res.skipped} already stored.`);
      }, `Capture complete for @${handle}.`);
    },
    [requireCase, run, mergeItems]
  );

  // ── capture: third-party comments under one of the target's posts ─────────
  const captureComments = useCallback(
    (item: XFeedItem) => {
      const cid = requireCase();
      if (!cid) return;
      const channelId = item.channelId || selectedTarget;
      const rootPostId = item.messageId || '';
      const rootPostUrl = item.url || '';
      if (!channelId || !rootPostId || !rootPostUrl) {
        setNotice('This finding is missing the fields needed to open its thread.');
        return;
      }
      void run(async () => {
        const res = await window.api.xListening.captureThreadComments({
          caseId: cid,
          channelId,
          channelLabel: `@${channelId}`,
          rootPostId,
          rootPostUrl
        });
        if (res.blocked) {
          setNotice(res.reason ?? 'Comment capture stopped — X presented a challenge.');
          return;
        }
        mergeItems((res.items ?? []) as unknown as XFeedItem[]);
        setNotice(
          collect.comments
            ? `Captured comments under ${rootPostId}: ${res.added} new.`
            : 'Comment collection is off — enable it in System settings first.'
        );
      }, 'Comment capture complete.');
    },
    [requireCase, run, mergeItems, selectedTarget, collect.comments]
  );

  // ── follower / following capture ─────────────────────────────────────────
  const captureNetwork = useCallback(
    (handle: string, kind: 'followers' | 'following') => {
      const cid = requireCase();
      if (!cid || !handle) return;
      void run(async () => {
        const res =
          kind === 'followers'
            ? await window.api.xListening.captureFollowers({ caseId: cid, target: handle })
            : await window.api.xListening.captureFollowing({ caseId: cid, target: handle });
        if (res.blocked) {
          setNotice(res.reason ?? 'Network capture stopped — X presented a challenge.');
          return;
        }
        setNetwork({ target: res.target, kind: res.kind, accounts: res.accounts ?? [] });
        setNotice(`Captured ${res.accounts?.length ?? 0} visible ${kind} for ${res.target}.`);
      }, `${kind} capture complete for @${handle}.`);
    },
    [requireCase, run]
  );

  const exportNetworkCsv = useCallback(() => {
    const cid = requireCase();
    if (!cid) return;
    void run(async () => {
      const res = await window.api.xListening.exportNetwork(cid);
      downloadExport({
        data: res.csv,
        encoding: 'utf8',
        mime: 'text/csv',
        suggestedName: `x-listening-networks-${cid}.csv`
      });
      setNotice(`Exported ${res.count} network account(s) to CSV.`);
    }, 'Network CSV export complete.');
  }, [requireCase, run]);

  // ── collect toggles (persist to AppSettings; capture reads them main-side) ─
  const setCollectKey = useCallback(
    (key: keyof CollectSettings, value: boolean) => {
      const next = { ...collect, [key]: value };
      setCollect(next);
      void run(async () => {
        // Send the FULL fixed-shape block so a shallow settings-merge can never drop a sibling
        // key (the v3.24.0 dataloss class); the archive toggle rides along unchanged.
        await window.api.settings.update({ xListening: { collect: next, archiveCycles } });
        await refreshSettings();
      }, 'Collection settings saved.');
    },
    [collect, archiveCycles, run, refreshSettings]
  );

  const setArchiveEnabled = useCallback(
    (value: boolean) => {
      setArchiveCycles(value);
      void run(async () => {
        await window.api.settings.update({ xListening: { collect, archiveCycles: value } });
        await refreshSettings();
      }, value ? 'Low-rate archive cycles enabled.' : 'Low-rate archive cycles disabled.');
    },
    [collect, run, refreshSettings]
  );

  // ── archive cycles ───────────────────────────────────────────────────────
  const runOneArchiveCycle = useCallback(
    (handle: string) => {
      const cid = requireCase();
      if (!cid || !handle) return;
      void run(async () => {
        const res = await window.api.xListening.runArchiveCycle({
          caseId: cid,
          channelId: handle,
          channelLabel: `@${handle}`
        });
        if (res.blocked) {
          setNotice(res.reason ?? 'Archive cycle stopped — X presented a challenge.');
          return;
        }
        if (!res.ran) {
          setNotice('Archive cycles are disabled — enable them before running a cycle.');
          return;
        }
        mergeItems((res.items ?? []) as unknown as XFeedItem[]);
        setNotice(`Archive cycle ${res.state.cycles}: ${res.added} new record(s).`);
      }, `Archive cycle complete for @${handle}.`);
    },
    [requireCase, run, mergeItems]
  );

  const runArchiveRun = useCallback(
    (handle: string) => {
      const cid = requireCase();
      if (!cid || !handle) return;
      const maxCycles = Math.max(1, Math.min(1000, Math.floor(archiveMaxCycles || 1)));
      void run(async () => {
        const res = await window.api.xListening.runArchiveCycles({
          caseId: cid,
          channelId: handle,
          channelLabel: `@${handle}`,
          maxCycles,
          // Deterministic, low but non-blocking spacing for an interactive run.
          delayMs: 0
        });
        if (res.blocked) {
          setNotice(res.reason ?? 'Archive run stopped — X presented a challenge.');
          return;
        }
        // Surface the run's captured records in the LIVE FEED, exactly like RUN ONE CYCLE.
        mergeItems((res.items ?? []) as unknown as XFeedItem[]);
        setNotice(
          res.cyclesRun > 0
            ? `Ran ${res.cyclesRun} archive cycle(s); ${res.totalAdded} new record(s).`
            : 'No archive cycles ran — enable archive cycles first.'
        );
      }, `Archive run complete for @${handle}.`);
    },
    [requireCase, run, mergeItems, archiveMaxCycles]
  );

  // ── item export ──────────────────────────────────────────────────────────
  const exportItems = useCallback(
    (format: 'json' | 'csv' | 'pdf' | 'docx') => {
      const cid = requireCase();
      if (!cid) return;
      void run(async () => {
        const res = await window.api.xListening.exportItems({ caseId: cid, format });
        downloadExport(res);
        setNotice(`Exported ${res.count} item(s) to ${format.toUpperCase()}.`);
      }, `${format.toUpperCase()} export complete.`);
    },
    [requireCase, run]
  );

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { post: 0, reply: 0, repost: 0, comment: 0 };
    for (const it of items) {
      const k = String(it.kind ?? 'post');
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  return (
    <div className="xls-root">
      <header className="xls-session-bar">
        <span className={`xls-status-dot${connected ? ' xls-online' : ''}`} aria-hidden="true" />
        <div className="xls-session-label">
          <strong>{connected ? 'X SESSION ONLINE' : 'X SESSION OFFLINE'}</strong>
          <small>Visible-DOM capture only · clearnet-quarantined</small>
        </div>
        <div className="xls-session-spacer" />
        <button
          className="xls-btn xls-btn-primary"
          onClick={handleConnect}
          disabled={busy}
        >
          {busy ? 'Working…' : connected ? 'Reopen X' : 'Connect X'}
        </button>
      </header>

      <nav className="xls-tabs" aria-label="X Listening sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`xls-tab${tab === t.id ? ' xls-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="xls-notice" role="status">{notice}</div>

      <main className="xls-body">
        {tab === 'sources' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">TARGET SOURCES</h2>
            <div className="xls-add-source">
              <input
                className="xls-input"
                value={newTarget}
                placeholder="X handle (e.g. username)"
                aria-label="Add X target handle"
                onChange={(e) => setNewTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTarget(); }}
              />
              <button className="xls-btn xls-btn-primary" onClick={addTarget} disabled={busy}>
                ADD SOURCE
              </button>
            </div>
            <ul className="xls-source-list">
              {targets.map((handle) => (
                <li
                  key={handle}
                  className={`xls-source-row${selectedTarget === handle ? ' xls-source-selected' : ''}`}
                >
                  <button
                    className="xls-source-name"
                    onClick={() => setSelectedTarget(handle)}
                    aria-label={`Select @${handle}`}
                  >
                    @{handle}
                  </button>
                  <div className="xls-source-actions">
                    <button
                      className="xls-btn"
                      onClick={() => captureTimeline(handle)}
                      disabled={busy}
                    >
                      CAPTURE POSTS
                    </button>
                    <button
                      className="xls-btn"
                      onClick={() => { setSelectedTarget(handle); setTab('network'); }}
                      disabled={busy}
                    >
                      NETWORK
                    </button>
                    <button
                      className="xls-btn xls-btn-danger"
                      onClick={() => removeTarget(handle)}
                      disabled={busy}
                    >
                      REMOVE
                    </button>
                  </div>
                </li>
              ))}
              {targets.length === 0 && (
                <li className="xls-empty">No target sources yet. Add an X handle to begin.</li>
              )}
            </ul>
          </section>
        )}

        {tab === 'feed' && (
          <section className="xls-panel">
            <div className="xls-panel-title-row">
              <h2 className="xls-panel-title">LIVE FEED</h2>
              <span className="xls-count">
                {items.length} record(s) · {kindCounts.reply} replies · {kindCounts.repost} reposts ·{' '}
                {kindCounts.comment} comments
              </span>
            </div>
            <div className="xls-feed">
              {items.map((it) => (
                <article className="xls-post-card" key={it.id}>
                  <header className="xls-post-head">
                    <strong>{it.authorHandle || 'Not visible'}</strong>
                    <span className="xls-kind">{KIND_LABELS[String(it.kind ?? 'post')] ?? 'POST'}</span>
                    <time>{it.publishedAt || 'Not visible'}</time>
                  </header>
                  <p className="xls-post-text">{it.text || ''}</p>
                  {Array.isArray(it.media) && it.media.some((m) => String(m).startsWith('data:')) && (
                    <div className="xls-media-strip">
                      {it.media
                        .filter((m) => String(m).startsWith('data:'))
                        .slice(0, 3)
                        .map((src, i) => (
                          <img key={i} src={src} alt="captured media" />
                        ))}
                    </div>
                  )}
                  <footer className="xls-metrics">
                    <span>↩ {metricToken(it.metrics?.replies)}</span>
                    <span>⟳ {metricToken(it.metrics?.reposts)}</span>
                    <span>♥ {metricToken(it.metrics?.likes)}</span>
                    <span>◉ {metricToken(it.metrics?.views)}</span>
                    <span className="xls-stamp">visible-capture · unverified</span>
                  </footer>
                  <div className="xls-post-actions">
                    <button
                      className="xls-btn"
                      onClick={() => captureComments(it)}
                      disabled={busy}
                      title={collect.comments ? '' : 'Enable comment collection in System settings'}
                    >
                      CAPTURE REPLIES
                    </button>
                    <button
                      className="xls-btn"
                      onClick={() => { setSelectedFindingId(it.id); setTab('notes'); }}
                      disabled={busy}
                    >
                      ANALYST NOTE
                    </button>
                  </div>
                </article>
              ))}
              {items.length === 0 && (
                <div className="xls-empty">No records captured yet. Capture a target's posts from TARGET SOURCES.</div>
              )}
            </div>
          </section>
        )}

        {tab === 'network' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">FOLLOWER NETWORK</h2>
            <div className="xls-network-controls">
              <label className="xls-field">
                TARGET SOURCE
                <select
                  className="xls-input"
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                >
                  <option value="">SELECT A SOURCE</option>
                  {targets.map((h) => (
                    <option value={h} key={h}>@{h}</option>
                  ))}
                </select>
              </label>
              <div className="xls-network-actions">
                <button
                  className="xls-btn"
                  onClick={() => captureNetwork(selectedTarget, 'followers')}
                  disabled={busy || !selectedTarget}
                >
                  CAPTURE FOLLOWERS
                </button>
                <button
                  className="xls-btn"
                  onClick={() => captureNetwork(selectedTarget, 'following')}
                  disabled={busy || !selectedTarget}
                >
                  CAPTURE FOLLOWING
                </button>
                <button className="xls-btn" onClick={exportNetworkCsv} disabled={busy}>
                  EXPORT CSV
                </button>
              </div>
            </div>
            <div className="xls-network-list">
              {network?.accounts.map((acc, i) => (
                <article className="xls-account-card" key={`${acc.handle}-${i}`}>
                  {acc.avatar && String(acc.avatar).startsWith('data:') ? (
                    <img className="xls-avatar" src={acc.avatar} alt="" />
                  ) : (
                    <span className="xls-avatar xls-avatar-empty">@</span>
                  )}
                  <div className="xls-account-body">
                    <strong>{acc.displayName || 'Not visible'}</strong>
                    <span>@{String(acc.handle).replace(/^@+/, '')}</span>
                    <p>{acc.bio || 'No visible bio captured.'}</p>
                  </div>
                </article>
              ))}
              {network && network.accounts.length === 0 && (
                <div className="xls-empty">
                  No {network.kind} were visible on the loaded page for {network.target}.
                </div>
              )}
              {!network && (
                <div className="xls-empty">
                  Select a source and capture followers or following. Only accounts X actually
                  rendered on the page are captured — never a claimed total.
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'notes' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">ANALYST NOTES</h2>
            {!caseId && (
              <div className="xls-empty">Open from a case to attach analyst notes.</div>
            )}
            {caseId && (
              <div className="xls-notes-layout">
                <ul className="xls-finding-list">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        className={`xls-finding${selectedFindingId === it.id ? ' xls-finding-active' : ''}`}
                        onClick={() => setSelectedFindingId(it.id)}
                      >
                        <strong>{it.authorHandle || 'Not visible'}</strong>
                        <span>{(it.text || '').slice(0, 80) || '(no visible text)'}</span>
                      </button>
                    </li>
                  ))}
                  {items.length === 0 && (
                    <li className="xls-empty">Capture posts first, then pin a note to a finding.</li>
                  )}
                </ul>
                <div className="xls-notes-detail">
                  {selectedFindingId ? (
                    <NotesPanel
                      caseId={caseId}
                      findingId={selectedFindingId}
                      findingLabel={
                        items.find((i) => i.id === selectedFindingId)?.authorHandle ?? undefined
                      }
                    />
                  ) : (
                    <div className="xls-empty">Select a finding to attach an analyst note.</div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'archive' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">INCREMENTAL ARCHIVE</h2>
            <label className="xls-check">
              <input
                type="checkbox"
                checked={archiveCycles}
                onChange={(e) => setArchiveEnabled(e.target.checked)}
                disabled={busy}
              />
              ENABLE LOW-RATE ARCHIVE CYCLES
            </label>
            <p className="xls-help">
              Each cycle re-reads the selected target's visible timeline and deduplicates into the
              encrypted case store. Cycles stop on login challenges or temporary limits rather than
              attempting to bypass them. Nothing runs while this toggle is off.
            </p>
            <div className="xls-network-controls">
              <label className="xls-field">
                TARGET SOURCE
                <select
                  className="xls-input"
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                >
                  <option value="">SELECT A SOURCE</option>
                  {targets.map((h) => (
                    <option value={h} key={h}>@{h}</option>
                  ))}
                </select>
              </label>
              <label className="xls-field">
                MAX CYCLES
                <input
                  className="xls-input"
                  type="number"
                  min={1}
                  max={1000}
                  value={archiveMaxCycles}
                  onChange={(e) => setArchiveMaxCycles(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="xls-network-actions">
              <button
                className="xls-btn"
                onClick={() => runOneArchiveCycle(selectedTarget)}
                disabled={busy || !selectedTarget}
              >
                RUN ONE CYCLE
              </button>
              <button
                className="xls-btn"
                onClick={() => runArchiveRun(selectedTarget)}
                disabled={busy || !selectedTarget}
              >
                RUN CYCLES
              </button>
            </div>
          </section>
        )}

        {tab === 'exports' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">EXPORTS</h2>
            <p className="xls-help">
              Serialize the case's captured items through the app's existing exporters. Every
              scraped field is escaped / formula-guarded, rounded metrics are exported verbatim, and
              remote media is never emitted.
            </p>
            <div className="xls-export-actions">
              <button className="xls-btn" onClick={() => exportItems('json')} disabled={busy}>
                EXPORT JSON
              </button>
              <button className="xls-btn" onClick={() => exportItems('csv')} disabled={busy}>
                EXPORT CSV
              </button>
              <button className="xls-btn" onClick={() => exportItems('pdf')} disabled={busy}>
                EXPORT PDF
              </button>
              <button className="xls-btn" onClick={() => exportItems('docx')} disabled={busy}>
                EXPORT DOCX
              </button>
            </div>
          </section>
        )}

        {tab === 'system' && (
          <section className="xls-panel">
            <h2 className="xls-panel-title">SYSTEM</h2>
            <div className="xls-connect-card">
              <div className={`xls-connection-banner${connected ? ' xls-connected' : ''}`}>
                {connected ? 'CONNECTED' : 'NOT CONNECTED'}
              </div>
              <p className="xls-connect-help">
                Opens a dedicated hardened login window. Sign in directly to X — no cookie copying
                is required, and your auth token is never read or logged by this module.
              </p>
              <div className="xls-card-actions">
                <button className="xls-btn xls-btn-primary" onClick={handleConnect} disabled={busy}>
                  {busy ? 'Working…' : connected ? 'Reopen X' : 'Connect X'}
                </button>
              </div>
            </div>
            <div className="xls-settings">
              <h3 className="xls-subtitle">COLLECTION SETTINGS</h3>
              <p className="xls-help">
                These toggles are read main-side at capture time — the renderer can never widen
                capture beyond what you opt into here.
              </p>
              <label className="xls-check">
                <input
                  type="checkbox"
                  checked={collect.replies}
                  onChange={(e) => setCollectKey('replies', e.target.checked)}
                  disabled={busy}
                />
                COLLECT REPLIES MADE BY THE TARGET
              </label>
              <label className="xls-check">
                <input
                  type="checkbox"
                  checked={collect.reposts}
                  onChange={(e) => setCollectKey('reposts', e.target.checked)}
                  disabled={busy}
                />
                COLLECT REPOSTS MADE BY THE TARGET
              </label>
              <label className="xls-check">
                <input
                  type="checkbox"
                  checked={collect.comments}
                  onChange={(e) => setCollectKey('comments', e.target.checked)}
                  disabled={busy}
                />
                COLLECT THIRD-PARTY COMMENTS UNDER THE TARGET'S POSTS
              </label>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
