/**
 * SweepPanel — username-sweep UI for Searchlight (Task 9).
 *
 * Port transforms applied from .searchlight-source/src/renderer/components/Search/SearchPanel.tsx:
 * 1. No renderer-side per-site fetch loop — calls window.api.searchlight.startSweep once, streams
 *    results via onSweepResult / onSweepDone (subscribed in useEffect, unsubscribed on cleanup).
 * 2. Catalog loaded from window.api.searchlight.catalog(), not a bundled JSON import.
 * 3. Default selection = ALL catalog site names (so unmodified sweep probes everything).
 * 4. Tor/clearnet toggle: "Direct (clearnet) — exposes your IP", default OFF (Tor).
 * 5. Network gate: settings.searchlight.networkEnabled; Launch disabled + notice when off.
 * 6. Result statuses: FOUND / NOT_FOUND / BLOCKED / ERROR / REDIRECT driven by SweepResult.status.
 *    TOR_UNAVAILABLE is its own actionable row. Blocked (status==='blocked') is its own bucket.
 * 7. Maigret import: reads file text → window.api.searchlight.importSites(text) → refreshes catalog.
 * 8. Aesthetic: Win98 98.css buttons on toolbar; results list on dark .sl-* canvas (searchlight.css).
 * 9. No framer-motion; no lucide-react; icons are inline SVG.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SiteCatalogEntry, SweepResult } from '@shared/searchlight/types';
import {
  type FilterBucket,
  matchesBucket,
  sortResults,
  summarizeSweep,
  computeEta,
  canLabel,
} from '@shared/searchlight/sweep-panel-utils';
import { useSearchlightStore } from '../store';
import { useSettings } from '../../../state/store';
import { useFavicons } from './useFavicons';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// matchesBucket, sortResults, summarizeSweep, computeEta imported from sweep-panel-utils

function statusColor(r: SweepResult): string {
  switch (r.status) {
    case 'found':     return '#00ff88';
    case 'maybe':     return '#d8a83a';
    case 'blocked':   return '#ffc800';
    case 'error':     return '#ff4444';
    case 'not_found': return '#5a6480';
    default:          return '#8090b0';
  }
}

function statusLabel(r: SweepResult): string {
  if (r.error === 'TOR_UNAVAILABLE') return 'TOR UNAVAIL';
  switch (r.status) {
    case 'found':     return 'FOUND';
    case 'maybe':     return 'MAYBE';
    case 'not_found': return 'NOT FOUND';
    case 'blocked':   return 'BLOCKED';
    case 'error':     return r.error ?? 'ERROR';
    default:          return r.statusCode ? String(r.statusCode) : 'UNKNOWN';
  }
}

function isRedirect(r: SweepResult): boolean {
  return [301, 302, 307, 308].includes(r.statusCode);
}

function filterResults(results: SweepResult[], bucket: FilterBucket, query: string): SweepResult[] {
  const byBucket = bucket === 'all' ? results : results.filter((r) => matchesBucket(r, bucket));
  if (!query.trim()) return byBucket;
  const q = query.toLowerCase();
  return byBucket.filter(
    (r) =>
      r.siteName.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
  );
}

// Inline SVG icons (no lucide-react)
const IconSearch = (): JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="5" /><line x1="10" y1="10" x2="14" y2="14" />
  </svg>
);
const IconX = (): JSX.Element => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" />
  </svg>
);
const IconExport = (): JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 12h8M8 3v7M5 6l3-3 3 3" />
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

export function SweepPanel(): JSX.Element {
  const store = useSearchlightStore();
  const settings = useSettings((s) => s.settings);
  const networkEnabled = settings?.searchlight?.networkEnabled ?? false;

  const activeCaseId = store.activeCaseId;
  const activeCase = store.cases.find((c) => c.id === activeCaseId);

  // ── Local state ──────────────────────────────────────────────────────────

  const [username, setUsername] = useState('');
  const [directMode, setDirectMode] = useState(false); // default OFF = Tor
  const [torState, setTorState] = useState<'off' | 'connecting' | 'ready' | 'unknown'>('unknown');
  const [torErr, setTorErr] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SiteCatalogEntry[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [resultBucket, setResultBucket] = useState<FilterBucket>('all');
  const [resultSearch, setResultSearch] = useState('');
  const [maigretMsg, setMaigretMsg] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Add custom site form ─────────────────────────────────────────────────
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [customMsg, setCustomMsg] = useState('');
  const [labeled, setLabeled] = useState<Set<string>>(new Set()); // result ids labelled this session (inline learning thumbs)

  const labelInline = useCallback((resultId: string, siteName: string, label: 0 | 1): void => {
    if (!activeCaseId) return;
    void window.api.searchlight.labelResult({ resultId, label, siteName, caseId: activeCaseId });
    setLabeled((prev) => new Set(prev).add(resultId)); // immediate feedback
  }, [activeCaseId]);

  // ── Load catalog on mount ────────────────────────────────────────────────

  const loadCatalog = useCallback(async () => {
    const entries = await window.api.searchlight.catalog();
    setCatalog(entries);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // ── Tor connection status (Tor mode + network on) ────────────────────────
  // Query on mount and whenever the user flips back into Tor mode.
  useEffect(() => {
    if (!networkEnabled || directMode) return;
    let cancelled = false;
    void (async () => {
      const r = await window.api.searchlight.torStatus();
      if (!cancelled) setTorState(r.state);
    })();
    return () => {
      cancelled = true;
    };
  }, [networkEnabled, directMode]);

  // While connecting, poll every 2s until Tor leaves the connecting state.
  // Cleanup clears the interval on unmount / state change — no leaked timers.
  useEffect(() => {
    if (torState !== 'connecting') return;
    let cancelled = false;
    const id = setInterval(() => {
      void (async () => {
        const r = await window.api.searchlight.torStatus();
        if (!cancelled) setTorState(r.state);
      })();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [torState]);

  const handleConnectTor = useCallback(async () => {
    setTorErr(null);
    setTorState('connecting');
    const r = await window.api.searchlight.connectTor();
    setTorState(r.state === 'ready' ? 'ready' : r.state);
    if (r.error) setTorErr(r.error);
  }, []);

  // ── Derived: categories from catalog ────────────────────────────────────

  const categories = useMemo((): string[] => {
    const seen = new Set<string>();
    catalog.forEach((s) => seen.add(s.category));
    return ['all', ...Array.from(seen).sort()];
  }, [catalog]);

  const filteredCatalog = useMemo((): SiteCatalogEntry[] => {
    if (categoryFilter === 'all') return catalog;
    return catalog.filter((s) => s.category === categoryFilter || s.tags.includes(categoryFilter));
  }, [catalog, categoryFilter]);

  // ── Active job derived data ──────────────────────────────────────────────

  const activeJob = useMemo(() => {
    if (!activeCase || !activeJobId) return null;
    return activeCase.searches.find((j) => j.id === activeJobId) ?? null;
  }, [activeCase, activeJobId]);

  const allResults: SweepResult[] = useMemo(
    () => (activeJob ? (activeJob.results as SweepResult[]) : []),
    [activeJob]
  );

  const filteredResults = useMemo(
    () => filterResults(allResults, resultBucket, resultSearch),
    [allResults, resultBucket, resultSearch]
  );

  // ── Sorted visible results ───────────────────────────────────────────────────
  const sortedResults = useMemo(
    () => sortResults(filteredResults, sort.key, sort.dir),
    [filteredResults, sort.key, sort.dir],
  );
  const visibleResults = sortedResults.slice(0, 500);
  const visibleSiteNames = useMemo(() => [...new Set(visibleResults.map((r) => r.siteName))], [visibleResults.map((r) => r.siteName).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const favicons = useFavicons(visibleSiteNames);

  // ── Stats & summary ──────────────────────────────────────────────────────────
  const summary = useMemo(() => summarizeSweep(allResults), [allResults]);

  const stats = useMemo(() => ({
    found:    summary.found,
    maybe:    summary.maybe,
    notfound: allResults.filter((r) => r.status === 'not_found' && !isRedirect(r)).length,
    blocked:  summary.blocked,
    redirect: allResults.filter((r) => isRedirect(r) && r.status === 'not_found').length,
    error:    summary.error + summary.unknown,
  }), [allResults, summary]);

  // ── Sweep subscription (per active job) ─────────────────────────────────

  useEffect(() => {
    if (!activeJobId || !activeCaseId) return;
    const job = store.cases
      .find((c) => c.id === activeCaseId)
      ?.searches.find((j) => j.id === activeJobId);
    if (!job || job.status !== 'running') return;

    const offResult = window.api.searchlight.onSweepResult((r: SweepResult) => {
      if (r.jobId !== activeJobId) return;
      store.appendSweepResult(activeCaseId, activeJobId, r);
    });

    const offDone = window.api.searchlight.onSweepDone((f) => {
      if (f.jobId !== activeJobId) return;
      const finalStatus = f.status === 'cancelled' ? 'cancelled' : 'completed';
      store.finishSweepJob(activeCaseId, activeJobId, finalStatus);
    });

    return () => {
      offResult();
      offDone();
    };
  // We intentionally run this only when activeJobId changes, not on every store tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, activeCaseId]);

  // ── Launch sweep ─────────────────────────────────────────────────────────

  const handleLaunch = useCallback(async () => {
    const name = username.trim();
    if (!name || !activeCaseId || !networkEnabled) return;
    if (activeJob?.status === 'running') return;

    // Site IDs = all filtered catalog names (empty siteIds → main sweeps nothing)
    const siteIds = filteredCatalog.map((s) => s.name);
    if (siteIds.length === 0) return;

    const { jobId, total } = await window.api.searchlight.startSweep({
      username: name,
      siteIds,
      useTor: !directMode,
    });

    const job = {
      id: jobId,
      username: name,
      startedAt: Date.now(),
      status: 'running' as const,
      totalSites: total,
      checkedSites: 0,
      results: [],
      useTor: !directMode,
    };
    store.addSearchJob(activeCaseId, job);
    setActiveJobId(jobId);
    setResultBucket('all');
  }, [username, activeCaseId, networkEnabled, activeJob, filteredCatalog, directMode, store]);

  const handleCancel = useCallback(async () => {
    if (!activeJobId || !activeCaseId) return;
    await window.api.searchlight.cancelSweep(activeJobId);
    store.finishSweepJob(activeCaseId, activeJobId, 'cancelled');
  }, [activeJobId, activeCaseId, store]);

  // ── Maigret import ───────────────────────────────────────────────────────

  const handleMaigretFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMaigretMsg('Loading...');
    try {
      const text = await file.text();
      const { added, rejected } = await window.api.searchlight.importSites(text);
      await loadCatalog();
      setMaigretMsg(`Added ${added}, rejected ${rejected}`);
    } catch (err) {
      setMaigretMsg('Import failed');
      console.error('Maigret import error', err);
    }
    // Reset so the same file can be re-picked
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadCatalog]);

  // ── Add custom site ──────────────────────────────────────────────────────

  const handleAddCustomSite = useCallback(async () => {
    const name = customName.trim();
    const url = customUrl.trim();
    if (!name || !url) { setCustomMsg('Name and URL are required'); return; }
    setCustomMsg('Adding...');
    try {
      const result = await window.api.searchlight.addCustomSite({ name, url, category: customCategory.trim() || undefined });
      if (result.ok) {
        setCustomMsg(`Added "${name}" to catalog`);
        setCustomName('');
        setCustomUrl('');
        setCustomCategory('');
        await loadCatalog();
      } else {
        setCustomMsg(result.reason ?? 'Failed to add site');
      }
    } catch {
      setCustomMsg('Add failed');
    }
  }, [customName, customUrl, customCategory, loadCatalog]);

  // ── Export custom sites.json ─────────────────────────────────────────────

  const handleExportSites = useCallback(async () => {
    try {
      const json = await window.api.searchlight.exportSites();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'searchlight-custom-sites.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore; no toast available here
    }
  }, []);

  // ── Export CSV ───────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(async () => {
    if (!filteredResults.length) return;
    const header = 'Site,Username,URL,Status,Found,Confidence,CheckType,Elapsed(ms),Category,Tags,Error';
    const rows = filteredResults.map((r) =>
      [
        r.siteName, r.username, r.url, r.status,
        r.found ? 'YES' : 'NO',
        r.confidence,
        r.checkType,
        r.elapsed,
        r.category,
        r.tags.join('|'),
        r.error ?? '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sweep-${activeJob?.username ?? 'results'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredResults, activeJob]);

  // ─── Sort toggle ──────────────────────────────────────────────────────────

  const handleSort = useCallback((key: string) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (-prev.dir as 1 | -1) : 1,
    }));
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const isRunning = activeJob?.status === 'running';
  const progress = activeJob ? activeJob.checkedSites / Math.max(activeJob.totalSites, 1) : 0;

  // Rolling ETA: elapsedSoFar / checked * remaining (guard div-by-zero)
  const etaMs = activeJob && isRunning
    ? computeEta(activeJob.checkedSites, activeJob.totalSites, Date.now() - activeJob.startedAt)
    : null;
  const etaLabel = etaMs != null
    ? etaMs < 60_000
      ? `~${Math.ceil(etaMs / 1000)}s`
      : `~${Math.ceil(etaMs / 60_000)}m`
    : null;

  return (
    <div className="sl-sweep-root">

      {/* ── Toolbar ── */}
      <div className="sl-sweep-toolbar">

        {/* Username input + launch */}
        <div className="sl-sweep-input-row">
          <label className="sl-sweep-label" htmlFor="sl-username">USERNAME</label>
          <input
            id="sl-username"
            className="sl-sweep-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isRunning) void handleLaunch(); }}
            placeholder="target_handle"
            disabled={isRunning}
            spellCheck={false}
          />
          <button
            className="sl-sweep-btn sl-sweep-btn-primary"
            onClick={() => void handleLaunch()}
            disabled={!username.trim() || isRunning || !networkEnabled || filteredCatalog.length === 0}
          >
            <IconSearch /> LAUNCH SWEEP
          </button>
          {isRunning && (
            <button
              className="sl-sweep-btn sl-sweep-btn-danger"
              onClick={() => void handleCancel()}
            >
              <IconX /> ABORT
            </button>
          )}
        </div>

        {/* Options row */}
        <div className="sl-sweep-options-row">
          {/* Tor/clearnet toggle */}
          <label className="sl-sweep-check-label" title="Tor is on by default. Enabling clearnet exposes your real IP.">
            <input
              type="checkbox"
              checked={directMode}
              onChange={(e) => setDirectMode(e.target.checked)}
              disabled={isRunning}
            />
            Direct (clearnet) — exposes your IP
          </label>

          {/* Site count readout */}
          <span className="sl-sweep-sitecount">
            {filteredCatalog.length.toLocaleString()} sites
            {categoryFilter !== 'all' ? ` in ${categoryFilter}` : ''}
          </span>

          {/* Maigret import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => void handleMaigretFile(e)}
          />
          <button
            className="sl-sweep-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning}
            title="Import a custom data.json to extend the site catalog"
          >
            LOAD CUSTOM DB
          </button>
          {maigretMsg && (
            <span className="sl-sweep-msg">{maigretMsg}</span>
          )}
          <button
            className="sl-sweep-btn"
            onClick={() => void handleExportSites()}
            title="Export custom sites as sites.json"
          >
            EXPORT SITES.JSON
          </button>
          <button
            className="sl-sweep-btn"
            onClick={() => void window.api.searchlight.revealSiteDbDir()}
            title="Open the writable site-database folder. Drop a corrected maigret_sites.json here to override the bundled database."
          >
            SITE DB FOLDER
          </button>
        </div>

        {/* Add custom site row */}
        <div className="sl-sweep-options-row sl-custom-site-row">
          <span className="sl-sweep-cats-label">ADD SITE:</span>
          <input
            className="sl-sweep-input sl-custom-site-input"
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Site name"
            disabled={isRunning}
            spellCheck={false}
          />
          <input
            className="sl-sweep-input sl-custom-site-input sl-custom-url-input"
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://site.tld/u/{username}"
            disabled={isRunning}
            spellCheck={false}
          />
          <input
            className="sl-sweep-input sl-custom-site-input sl-custom-cat-input"
            type="text"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="category (optional)"
            disabled={isRunning}
            spellCheck={false}
          />
          <button
            className="sl-sweep-btn"
            onClick={() => void handleAddCustomSite()}
            disabled={isRunning || !customName.trim() || !customUrl.trim()}
          >
            ADD
          </button>
          {customMsg && (
            <span className="sl-sweep-msg">{customMsg}</span>
          )}
        </div>

        {/* Category scope filter */}
        <div className="sl-sweep-cats">
          <span className="sl-sweep-cats-label">SCOPE:</span>
          {categories.map((cat) => {
            const count = cat === 'all'
              ? catalog.length
              : catalog.filter((s) => s.category === cat || s.tags.includes(cat)).length;
            if (count === 0 && cat !== 'all') return null;
            return (
              <button
                key={cat}
                className={`sl-sweep-cat${categoryFilter === cat ? ' sl-sweep-cat-active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
                disabled={isRunning}
              >
                {cat === 'all' ? 'ALL' : cat.toUpperCase()}{cat !== 'all' ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>

        {/* Network-off notice */}
        {!networkEnabled && (
          <div className="sl-sweep-net-notice">
            Searchlight network is off — enable it in Settings.
          </div>
        )}

        {/* Tor-not-connected notice (advisory + actionable; does not block Launch) */}
        {networkEnabled && !directMode && torState !== 'ready' && torState !== 'unknown' && (
          <div className="sl-sweep-tor-notice">
            <div className="sl-sweep-tor-notice-text">
              Tor is not connected — a Tor sweep will report &quot;TOR NOT READY&quot; for every site.
            </div>
            <div className="sl-sweep-tor-notice-actions">
              <button
                className="sl-sweep-btn"
                onClick={() => void handleConnectTor()}
                disabled={torState === 'connecting'}
              >
                {torState === 'connecting' ? 'Starting Tor… (~30–60s)' : 'Connect Tor'}
              </button>
              <span className="sl-sweep-tor-hint">
                …or tick &quot;Direct (clearnet)&quot; to sweep without Tor.
              </span>
            </div>
            {torErr && <div className="sl-sweep-tor-err">{torErr}</div>}
          </div>
        )}
      </div>

      {/* ── Progress bar ── */}
      {activeJob && (
        <div className="sl-sweep-progress-bar-wrap">
          <div className="sl-sweep-progress-hdr">
            <span className="sl-sweep-progress-label">
              SWEEPING: <strong>{activeJob.username.toUpperCase()}</strong>
              &nbsp;·&nbsp;
              <span className="sl-sweep-found-count">{stats.found} FOUND</span>
              {stats.maybe > 0 && (
                <span className="sl-sweep-maybe-count">&nbsp;·&nbsp;{stats.maybe} MAYBE</span>
              )}
            </span>
            <span className="sl-sweep-progress-counts">
              {activeJob.checkedSites}/{activeJob.totalSites}
              {activeJob.status === 'completed' && ' · COMPLETE'}
              {activeJob.status === 'running' && ' · SCANNING...'}
              {activeJob.status === 'cancelled' && ' · CANCELLED'}
              {etaLabel && isRunning && <span className="sl-sweep-eta">&nbsp;· ETA {etaLabel}</span>}
            </span>
          </div>
          <div className="sl-progress-track">
            <div
              className={`sl-progress-fill${activeJob.status === 'completed' ? ' sl-progress-fill-done' : ''}`}
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Result filter bar ── */}
      {activeJob && (
        <div className="sl-sweep-filter-bar">
          <input
            className="sl-sweep-search"
            type="text"
            value={resultSearch}
            onChange={(e) => setResultSearch(e.target.value)}
            placeholder="Filter results..."
          />
          {(
            [
              { id: 'all',      label: 'ALL',       count: allResults.length,    accent: undefined },
              { id: 'found',    label: 'FOUND',     count: stats.found,         accent: '#00ff88' },
              { id: 'maybe',    label: 'MAYBE',     count: stats.maybe,         accent: '#d8a83a' },
              { id: 'notfound', label: 'NOT FOUND', count: stats.notfound,      accent: undefined },
              { id: 'blocked',  label: 'BLOCKED',   count: stats.blocked,       accent: '#ffc800' },
              { id: 'redirect', label: 'REDIRECT',  count: stats.redirect,      accent: undefined },
              { id: 'error',    label: 'ERROR',     count: stats.error,         accent: '#ff4444' },
            ] as { id: FilterBucket; label: string; count: number; accent?: string }[]
          ).map(({ id, label, count, accent }) => (
            <button
              key={id}
              className={`sl-sweep-bucket${resultBucket === id ? ' sl-sweep-bucket-active' : ''}`}
              style={resultBucket === id && accent ? { borderColor: accent, color: accent } : undefined}
              onClick={() => setResultBucket(id)}
            >
              {label} <span className="sl-bucket-count">({count})</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            className="sl-sweep-btn"
            onClick={() => void handleExportCsv()}
            disabled={!filteredResults.length}
            title="Export visible results as CSV"
          >
            <IconExport /> CSV
          </button>
          <span className="sl-sweep-result-count">{filteredResults.length} results</span>
        </div>
      )}

      {/* ── Summary panel ── */}
      {activeJob && allResults.length > 0 && (
        <div className="sl-summary">
          <div className="sl-summary-row">
            <span className="sl-summary-stat sl-summary-found">
              <span className="sl-summary-val">{summary.found}</span> FOUND
            </span>
            {summary.maybe > 0 && (
              <span className="sl-summary-stat sl-summary-maybe">
                <span className="sl-summary-val">{summary.maybe}</span> MAYBE
              </span>
            )}
            {summary.blocked > 0 && (
              <span className="sl-summary-stat sl-summary-blocked">
                <span className="sl-summary-val">{summary.blocked}</span> BLOCKED
              </span>
            )}
            <span className="sl-summary-stat sl-summary-notfound">
              <span className="sl-summary-val">{summary.not_found}</span> NOT FOUND
            </span>
            {(summary.error + summary.unknown) > 0 && (
              <span className="sl-summary-stat sl-summary-error">
                <span className="sl-summary-val">{summary.error + summary.unknown}</span> ERROR
              </span>
            )}
            {Object.keys(summary.byCategory).length > 0 && (
              <span className="sl-summary-cats">
                {Object.entries(summary.byCategory)
                  .sort(([, a], [, b]) => (b.found + b.maybe) - (a.found + a.maybe))
                  .slice(0, 5)
                  .map(([cat, counts]) => (
                    <span key={cat} className="sl-summary-cat-chip">
                      {cat}: {counts.found > 0 && <span className="sl-summary-cat-found">{counts.found}</span>}
                      {counts.found > 0 && counts.maybe > 0 && '+'}
                      {counts.maybe > 0 && <span className="sl-summary-cat-maybe">{counts.maybe}</span>}
                    </span>
                  ))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Results table ── */}
      <div className="sl-sweep-results">
        {!activeJob ? (
          <div className="sl-sweep-empty">
            {!networkEnabled
              ? 'Searchlight network is off — enable it in Settings to run a sweep.'
              : activeCaseId
              ? 'No sweep yet — enter a username above and launch.'
              : 'Open or create a case to begin sweeping.'}
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="sl-sweep-empty">
            {allResults.length === 0
              ? 'Sweep running — results will stream in below.'
              : 'No results match current filters.'}
          </div>
        ) : (
          <table className="sl-sweep-table">
            <thead>
              <tr className="sl-sweep-thead-row">
                {(
                  [
                    { key: 'status',      label: 'STATUS'   },
                    { key: 'probability', label: 'MATCH'    },
                    { key: 'site',        label: 'SITE'     },
                    { key: null,          label: 'URL'      },
                    { key: null,          label: 'CHECK'    },
                    { key: 'elapsed',     label: 'MS'       },
                    { key: 'category',    label: 'CATEGORY' },
                    { key: null,          label: ''         },
                  ] as { key: string | null; label: string }[]
                ).map(({ key, label }) =>
                  key ? (
                    <th
                      key={label || key}
                      className={`sl-sweep-th sl-sweep-th-sortable${sort.key === key ? ' sl-sweep-th-active' : ''}`}
                      onClick={() => handleSort(key)}
                      title={`Sort by ${label}`}
                    >
                      {label}
                      <span className="sl-sort-caret">
                        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ' ◇'}
                      </span>
                    </th>
                  ) : (
                    <th key={label} className="sl-sweep-th">{label}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((r) => {
                const isTorMissing = r.status === 'error' && r.error === 'TOR_UNAVAILABLE';
                const color = statusColor(r);
                return (
                  <tr key={r.id} className={`sl-sweep-row${r.status === 'found' ? ' sl-row-found' : r.status === 'maybe' ? ' sl-row-maybe' : ''}`}>
                    {/* Status */}
                    <td className="sl-sweep-td">
                      <span className="sl-status-code" style={{ color }}>
                        {r.error ? '⊗' : r.statusCode || '—'}
                      </span>
                      <div className="sl-status-sub" style={{ color }}>
                        {statusLabel(r)}
                      </div>
                    </td>

                    {/* Match badge */}
                    <td className="sl-sweep-td">
                      {(r.status === 'found' || r.status === 'maybe') && r.probability != null ? (
                        <span className={r.status === 'maybe' ? 'sl-match-maybe' : 'sl-match-badge'}>
                          ● {Math.round(r.probability * 100)}%
                        </span>
                      ) : r.status === 'found' ? (
                        <span className="sl-match-badge">
                          ● {r.confidence === 'high' ? 'CONFIRMED' : r.confidence === 'medium' ? 'LIKELY' : 'POSSIBLE'}
                        </span>
                      ) : isTorMissing ? (
                        <span className="sl-tor-badge">TOR NOT READY</span>
                      ) : (
                        <span className="sl-match-dash">—</span>
                      )}
                    </td>

                    {/* Site name */}
                    <td className="sl-sweep-td">
                      {favicons[r.siteName]
                        ? <img className="sl-favicon" src={favicons[r.siteName]!} alt="" width={16} height={16} />
                        : <span className="sl-favicon sl-favicon-fallback" aria-hidden />}
                      <span className={`sl-site-name${r.status === 'found' ? ' sl-site-found' : ''}`}>
                        {r.siteName}
                      </span>
                    </td>

                    {/* URL */}
                    <td className="sl-sweep-td sl-url-cell">
                      <a
                        href="#"
                        className={`sl-url-link${r.status === 'found' ? ' sl-url-found' : ''}`}
                        onClick={(e) => {
                          e.preventDefault();
                          void window.api.system.openExternal(r.url);
                        }}
                        title={r.url}
                      >
                        {r.url}
                      </a>
                    </td>

                    {/* Check method */}
                    <td className="sl-sweep-td">
                      <span className={`sl-check-badge sl-check-${r.checkType}`}>
                        {r.checkType.slice(0, 4).toUpperCase()}
                      </span>
                    </td>

                    {/* Elapsed */}
                    <td className="sl-sweep-td">
                      <span className="sl-elapsed">{r.elapsed}</span>
                    </td>

                    {/* Category */}
                    <td className="sl-sweep-td">
                      <span className="sl-cat-tag">{r.category}</span>
                    </td>

                    {/* Actions */}
                    <td className="sl-sweep-td">
                      <button
                        className="sl-action-btn"
                        title="Open URL in external browser"
                        onClick={() => void window.api.system.openExternal(r.url)}
                      >
                        ↗
                      </button>
                      {canLabel(r.status, activeCaseId) && (
                        labeled.has(r.id) ? (
                          <span className="sl-learning-labeled" title="Labelled — teaching the detector">✓</span>
                        ) : (
                          <>
                            <button className="sl-learning-thumb sl-learning-real" title="Label: real match"
                              onClick={() => labelInline(r.id, r.siteName, 1)}>👍</button>
                            <button className="sl-learning-thumb sl-learning-fake" title="Label: false positive"
                              onClick={() => labelInline(r.id, r.siteName, 0)}>👎</button>
                          </>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
