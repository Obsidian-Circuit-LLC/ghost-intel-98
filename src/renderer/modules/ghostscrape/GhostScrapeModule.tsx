/**
 * GhostScrape — hidden-browser X (Twitter) timeline/profile scraper (Task 8).
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native
 * Electron primitives.
 *
 * Clearnet-quarantine module: drives a hidden, cookie-authenticated Electron
 * browser window against x.com. This is NOT a Tor path — it is the user's own
 * clearnet HTTPS session (their IP, their cookie), same as X Collector. Both
 * settings.x.networkEnabled AND settings.x.clearnetAcknowledged must be true
 * before window.api.ghostscrape.start() will run (enforced main-side too —
 * GhostScrapeGatedError is thrown if the gate is closed).
 *
 * Credentials/account list are the SAME shared store as X Collector —
 * window.api.x.listAccounts() returns account IDs only, never credentials.
 * No settings.ghostscrape namespace, no second cookie store.
 *
 * XSS invariants (mirrors XCollectorModule.tsx):
 * - Scraped tweet text, profile bio/handle/displayName are attacker-controlled;
 *   all rendered as React text children — no dangerouslySetInnerHTML.
 * - Export (JSON/TXT/CSV) uses the pure helpers in export.ts; the CSV generator
 *   is formula-injection safe (never touch raw user text with a spreadsheet
 *   formula prefix without neutralizing it first).
 *
 * Manual smoke checklist (renderer is not headlessly testable beyond registration):
 * 1. Open module → gate notice visible when either x.networkEnabled or
 *    x.clearnetAcknowledged is false; Start disabled.
 * 2. Confirm both flags in Settings → X → gate notice disappears.
 * 3. No stored X account → visible "add an account" reason, Start disabled.
 * 4. Enter a username, pick a scrape type, press Start → progress updates live.
 * 5. Cancel mid-scrape → result marked partial, window torn down.
 * 6. Results table renders tweet text/handle as plain text (DOM inspect: no raw HTML).
 * 7. Export JSON/TXT/CSV → file saved via the native save dialog.
 * 8. Save to Case → note attached to the chosen case, retrievable in Notepad.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GhostScrapeConfig, GhostScrapeResult, ScrapeType } from '@shared/ipc-contracts';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { buildScrapingCaseOptions, type ScrapingCaseOption } from '../socmint/case-options';
import { PromptDialog, ChoiceDialog } from '../../components/CaseDialogs';
import { buildScrapeRequest, canScrape } from './scrape-request';
import { toRows, sortRows, type SortDir, type SortKey } from './results-view';
import { toJson, toTxt, toCsv } from './export';
import './ghostscrape.css';

const SCRAPE_TYPES: { value: ScrapeType; label: string }[] = [
  { value: 'all', label: 'All (tweets + retweets + bio)' },
  { value: 'tweets', label: 'Tweets only' },
  { value: 'retweets', label: 'Retweets only' },
  { value: 'bio', label: 'Bio / profile only' },
];

interface ProgressState { captured: number; scrollsDone: number }

// ---------------------------------------------------------------------------
// Results table (XSS-safe — scraped text rendered as React text children)
// ---------------------------------------------------------------------------

function GhostScrapeResultsTable({ result }: { result: GhostScrapeResult }): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo(
    () => sortRows(toRows(result), sortKey, sortDir),
    [result, sortKey, sortDir],
  );

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: 'createdAt', label: 'Date' },
    { key: 'isRetweet', label: 'RT' },
    { key: 'text', label: 'Text' },
    { key: 'likeCount', label: 'Likes' },
    { key: 'retweetCount', label: 'RTs' },
    { key: 'replyCount', label: 'Replies' },
  ];

  return (
    <div className="gs-results">
      {result.profile && (
        <div className="gs-profile-card">
          {/* Profile fields are scraped text — rendered as React text children only. */}
          <strong>@{result.profile.handle}</strong> — {result.profile.displayName}
          {result.profile.bio && <p className="gs-profile-bio">{result.profile.bio}</p>}
          <span className="gs-profile-stats">
            Followers: {result.profile.followers} · Following: {result.profile.following} · Joined: {result.profile.joined}
          </span>
        </div>
      )}

      {result.partial && (
        <div className="gs-partial-banner" role="alert">
          <strong>Scrape stopped early.</strong> Results may be incomplete — do NOT treat as
          evidence of absence.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="gs-empty">No tweets captured.</p>
      ) : (
        <table className="gs-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className="gs-th-sortable">
                  {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.createdAt}</td>
                <td>{t.isRetweet ? 'RT' : ''}</td>
                {/* Scraped tweet text — React text child, no dangerouslySetInnerHTML. */}
                <td className="gs-td-text">{t.text}</td>
                <td>{t.likeCount}</td>
                <td>{t.retweetCount}</td>
                <td>{t.replyCount}</td>
                <td className="gs-td-url">{t.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="gs-captured-note">
        Captured {result.captured} item{result.captured === 1 ? '' : 's'}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export + save-to-case bar
// ---------------------------------------------------------------------------

function GhostScrapeExportBar(
  { result, username, caseId }: { result: GhostScrapeResult; username: string; caseId: string },
): JSX.Element {
  const [saving, setSaving] = useState(false);

  const baseName = `ghostscrape-${username || 'export'}-${Date.now()}`;

  async function exportAs(kind: 'json' | 'txt' | 'csv'): Promise<void> {
    const content = kind === 'json' ? toJson(result) : kind === 'txt' ? toTxt(result) : toCsv(result);
    try {
      const saved = await window.api.export.text(`${baseName}.${kind}`, content);
      if (saved) toast.success(`Saved ${saved}.`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  }

  // Save-to-case: persisted into the x scraping store (scrapingCaseArtifactFile('x', id, …),
  // same secure-fs encryption-at-rest), NOT the main investigation case notes (W4 Task 5).
  // The target case is the one selected in the Cases sidebar — GhostScrape's own scraping
  // cases (namespace 'x'), NEVER the main investigation cases (window.api.cases.*).
  // GhostScrape's main code writes nothing to disk itself; this is a renderer-side call into
  // the already-encrypted x scraping-case artifact store.
  async function saveToCase(): Promise<void> {
    if (!caseId) { toast.warn('Select a case in the sidebar first.'); return; }
    setSaving(true);
    try {
      await window.api.scrapingCases.saveArtifact('x', caseId, `${baseName}.json`, toJson(result));
      toast.success('Saved to case.');
    } catch (err) {
      toast.error(`Save to case failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="gs-export-bar">
      <span className="gs-export-label">Export:</span>
      <button className="gs-btn" onClick={() => void exportAs('json')}>JSON</button>
      <button className="gs-btn" onClick={() => void exportAs('txt')}>TXT</button>
      <button className="gs-btn" onClick={() => void exportAs('csv')}>CSV</button>

      <span className="gs-export-sep" />

      <button
        className="gs-btn gs-btn-primary"
        onClick={() => void saveToCase()}
        disabled={!caseId || saving}
        title={!caseId ? 'Select a case in the sidebar first' : undefined}
      >
        {saving ? 'Saving…' : 'Save to Case'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GhostScrapeModule (root)
// ---------------------------------------------------------------------------

export function GhostScrapeModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const networkEnabled = settings?.x?.networkEnabled ?? false;
  const clearnetAcknowledged = settings?.x?.clearnetAcknowledged ?? false;
  const gateOpen = networkEnabled && clearnetAcknowledged;

  // GhostScrape's OWN scraping cases (namespace 'x') — the SAME store X Collector drives,
  // kept apart from the main investigation cases (window.api.cases.*). The sidebar
  // reads/writes only this store; the selected case is where Save-to-Case artifacts land.
  const [caseOptions, setCaseOptions] = useState<ScrapingCaseOption[]>([]);
  const [caseId, setCaseId] = useState('');

  const loadCases = useCallback(async () => {
    try {
      const list = await window.api.scrapingCases.list('x');
      setCaseOptions(buildScrapingCaseOptions(list));
    } catch (err) {
      console.warn('[GhostScrape] scrapingCases.list:', err);
    }
  }, []);

  useEffect(() => { void loadCases(); }, [loadCases]);

  // window.prompt is a no-op in Electron's renderer (returns null) — use in-app dialogs instead.
  const [showAddCase, setShowAddCase] = useState(false);
  const [importPick, setImportPick] = useState<{ scrapingId: string; cases: { id: string; title: string }[] } | null>(null);

  const handleAddCase = useCallback(() => setShowAddCase(true), []);
  const submitAddCase = useCallback(async (name: string) => {
    setShowAddCase(false);
    try {
      const created = await window.api.scrapingCases.create('x', name);
      await loadCases();
      setCaseId(created.id);
    } catch (err) {
      console.warn('[GhostScrape] scrapingCases.create:', err);
    }
  }, [loadCases]);

  const handleDeleteCase = useCallback(async (id: string) => {
    try {
      await window.api.scrapingCases.remove('x', id);
      await loadCases();
      setCaseId((current) => (current === id ? '' : current));
    } catch (err) {
      console.warn('[GhostScrape] scrapingCases.remove:', err);
    }
  }, [loadCases]);

  // Copy this scraping case's results into one of the main investigation cases. The scraping
  // case is left intact (source only). Main cases live in a separate store (window.api.cases).
  const handleImportCase = useCallback(async (id: string) => {
    try {
      const cases = await window.api.cases.list();
      if (cases.length === 0) {
        window.alert('No investigation cases yet. Create one first.');
        return;
      }
      setImportPick({ scrapingId: id, cases: cases.map((c) => ({ id: c.id, title: c.title })) });
    } catch (err) {
      console.warn('[GhostScrape] scrapingCases.importToCase:', err);
    }
  }, []);
  const submitImport = useCallback(async (targetCaseId: string) => {
    const pick = importPick;
    setImportPick(null);
    const target = pick?.cases.find((c) => c.id === targetCaseId);
    if (!pick || !target) return;
    try {
      const res = await window.api.scrapingCases.importToCase('x', pick.scrapingId, target.id);
      window.alert(`Imported ${res.imported} item(s) into "${target.title}".`);
    } catch (err) {
      console.warn('[GhostScrape] scrapingCases.importToCase:', err);
    }
  }, [importPick]);

  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountId, setAccountId] = useState('');
  const [username, setUsername] = useState('');
  const [type, setType] = useState<ScrapeType>('all');
  const [sinceAfter, setSinceAfter] = useState('');
  const [before, setBefore] = useState('');
  const [scrolls, setScrolls] = useState('10');
  const [max, setMax] = useState('200');
  const [delayMs, setDelayMs] = useState('1500');

  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState>({ captured: 0, scrollsDone: 0 });
  const [result, setResult] = useState<GhostScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobIdRef = useRef<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const ids = await window.api.x.listAccounts();
      setAccounts(ids);
      setAccountId((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? '')));
    } catch (err) {
      console.warn('[GhostScrape] listAccounts:', err);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    const onFocus = (): void => { void loadAccounts(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAccounts]);

  // Progress/done subscriptions — filtered by the current job id so late events
  // from a cancelled/superseded job never overwrite fresher state.
  useEffect(() => {
    const offProgress = window.api.ghostscrape.onProgress((p) => {
      if (p.jobId !== jobIdRef.current) return;
      setProgress({ captured: p.captured, scrollsDone: p.scrollsDone });
    });
    const offDone = window.api.ghostscrape.onDone((d) => {
      if (d.jobId !== jobIdRef.current) return;
      setRunning(false);
      if (d.result) {
        setResult(d.result);
        setError(null);
      } else {
        setError(d.error ?? 'Unknown error.');
      }
    });
    return () => { offProgress(); offDone(); };
  }, []);

  const noAccounts = accounts.length === 0;
  const start = canScrape({
    networkEnabled, clearnetAcknowledged, accountId, username, running,
  });

  const handleStart = useCallback(async () => {
    if (!start) return;
    const cfg: GhostScrapeConfig = buildScrapeRequest({
      accountId,
      username,
      type,
      ...(sinceAfter.trim() ? { sinceAfter: sinceAfter.trim() } : {}),
      ...(before.trim() ? { before: before.trim() } : {}),
      scrolls: parseInt(scrolls, 10),
      max: parseInt(max, 10),
      delayMs: parseInt(delayMs, 10),
    });
    setError(null);
    setResult(null);
    setProgress({ captured: 0, scrollsDone: 0 });
    setRunning(true);
    try {
      const { jobId: id } = await window.api.ghostscrape.start(cfg);
      jobIdRef.current = id;
      setJobId(id);
    } catch (err) {
      setRunning(false);
      setError((err as Error).message);
      toast.error(`GhostScrape failed to start: ${(err as Error).message}`);
    }
  }, [start, accountId, username, type, sinceAfter, before, scrolls, max, delayMs]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await window.api.ghostscrape.cancel(jobId);
    } catch (err) {
      console.warn('[GhostScrape] cancel:', err);
    }
  }, [jobId]);

  return (
    <div className="gs-root">
      {showAddCase && (
        <PromptDialog
          title="New X case" label="Case name" placeholder="e.g. Operation Nightfall"
          onSubmit={(n) => void submitAddCase(n)} onClose={() => setShowAddCase(false)}
        />
      )}
      {importPick && (
        <ChoiceDialog
          title="Import into investigation case" label="Case"
          options={importPick.cases.map((c) => ({ id: c.id, label: c.title }))}
          onSubmit={(id) => void submitImport(id)} onClose={() => setImportPick(null)}
        />
      )}
      {/* Honest in-UI disclosure — this is a real logged-in browser session, not
          an anonymizing proxy. Always visible, regardless of gate state. */}
      <div className="gs-honesty-note">
        GhostScrape drives a real logged-in browser from your clearnet IP — this is the
        same network exposure as visiting x.com in a normal browser tab. Nothing here goes
        through Tor.
      </div>

      {!gateOpen && (
        <div className="gs-gate-notice" role="alert">
          <strong>GhostScrape is gated.</strong>{' '}
          {!clearnetAcknowledged
            ? 'Acknowledge clearnet use in Settings › X first.'
            : 'Enable X network in Settings › X first.'}
        </div>
      )}

      <div className="gs-layout">
        {/* Cases sidebar — GhostScrape's own scraping cases (namespace 'x'), independent of
            the main investigation cases. Selecting a case sets the Save-to-Case target. */}
        <aside className="gs-cases-sidebar" aria-label="GhostScrape cases">
          <div className="gs-cases-head">
            <span className="gs-cases-title">Cases</span>
            <button className="gs-btn gs-btn-primary" onClick={() => void handleAddCase()}>
              Add Case
            </button>
          </div>
          {caseOptions.length === 0 ? (
            <p className="gs-empty">No cases yet. Add one to begin.</p>
          ) : (
            <ul className="gs-cases-list">
              {caseOptions.map((o) => (
                <li
                  key={o.value}
                  data-scraping-case-id={o.value}
                  className={`gs-case-item${caseId === o.value ? ' gs-case-item-active' : ''}`}
                >
                  {/* label is an operator-supplied case name — rendered as a text child. */}
                  <span className="gs-case-name">{o.label}</span>
                  <span className="gs-case-actions">
                    <button className="gs-btn" onClick={() => setCaseId(o.value)}>Open</button>
                    <button
                      className="gs-btn"
                      title="Copy this case's results into an investigation case"
                      onClick={() => void handleImportCase(o.value)}
                    >
                      Import to case…
                    </button>
                    <button
                      className="gs-btn gs-btn-danger"
                      onClick={() => void handleDeleteCase(o.value)}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="gs-main">
      <section className="gs-section">
        <h3 className="gs-section-title">Target</h3>

        <div className="gs-form-row">
          <label htmlFor="gs-account" className="gs-label">Account</label>
          {noAccounts ? (
            <span className="gs-note">
              No X account stored. Add one in Settings › X first — GhostScrape authenticates
              with the same stored cookie as X Collector.
            </span>
          ) : (
            <select
              id="gs-account"
              className="gs-input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
        </div>

        <div className="gs-form-row">
          <label htmlFor="gs-username" className="gs-label">Username (without @)</label>
          <input
            id="gs-username"
            className="gs-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <fieldset className="gs-fieldset">
          <legend>Scrape type</legend>
          {SCRAPE_TYPES.map((t) => (
            <label key={t.value} className="gs-radio-label">
              <input
                type="radio"
                name="gs-type"
                checked={type === t.value}
                onChange={() => setType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>

        <div className="gs-form-row">
          <label htmlFor="gs-since" className="gs-label">Since (ISO date)</label>
          <input id="gs-since" className="gs-input" value={sinceAfter} onChange={(e) => setSinceAfter(e.target.value)} placeholder="2026-01-01" />
        </div>
        <div className="gs-form-row">
          <label htmlFor="gs-before" className="gs-label">Before (ISO date)</label>
          <input id="gs-before" className="gs-input" value={before} onChange={(e) => setBefore(e.target.value)} placeholder="2026-07-01" />
        </div>

        <div className="gs-form-row gs-form-row-tight">
          <label htmlFor="gs-scrolls" className="gs-label">Scrolls</label>
          <input id="gs-scrolls" className="gs-input gs-input-narrow" value={scrolls} onChange={(e) => setScrolls(e.target.value)} />
          <label htmlFor="gs-max" className="gs-label">Max items</label>
          <input id="gs-max" className="gs-input gs-input-narrow" value={max} onChange={(e) => setMax(e.target.value)} />
          <label htmlFor="gs-delay" className="gs-label">Delay (ms)</label>
          <input id="gs-delay" className="gs-input gs-input-narrow" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
        </div>

        <div className="gs-actions">
          <button
            className="gs-btn gs-btn-primary"
            onClick={() => void handleStart()}
            disabled={!start}
            title={
              !gateOpen
                ? 'Enable X network + acknowledge clearnet use in Settings › X first'
                : noAccounts
                ? 'Add an X account in Settings › X first'
                : !username.trim()
                ? 'Enter a username'
                : running
                ? 'A scrape is already running'
                : undefined
            }
          >
            {running ? 'Running…' : 'Start'}
          </button>
          <button className="gs-btn" onClick={() => void handleCancel()} disabled={!running}>
            Cancel
          </button>
        </div>

        {running && (
          <p className="gs-progress">
            Captured {progress.captured} item{progress.captured === 1 ? '' : 's'} — {progress.scrollsDone} scroll{progress.scrollsDone === 1 ? '' : 's'} done…
          </p>
        )}

        {error && (
          <div className="gs-error-banner" role="alert">
            <strong>Scrape error.</strong> {error}
          </div>
        )}
      </section>

      {result && (
        <section className="gs-section">
          <h3 className="gs-section-title">Results</h3>
          <GhostScrapeExportBar result={result} username={username} caseId={caseId} />
          <GhostScrapeResultsTable result={result} />
        </section>
      )}
        </div>
      </div>
    </div>
  );
}
