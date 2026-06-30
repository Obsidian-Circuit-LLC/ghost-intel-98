/**
 * X/Twitter Collector Module (X-6 — Preload + Renderer).
 *
 * Clearnet-quarantine module: connects to x.com over the public internet via
 * the twscrape-runner sidecar (NOT through Tor). Both settings.x.networkEnabled
 * AND settings.x.clearnetAcknowledged must be true before any IPC call is made.
 *
 * FAIL-LOUD invariants (spec §4):
 * - 'partial' and 'breakage-detected' are NEVER rendered as complete.
 * - Every non-done status that carries data must show an explicit warning:
 *   "Do NOT treat as evidence of absence."
 * - 'breakage-detected' shows a persistent banner directing the operator to
 *   update the twscrape-runner sidecar.
 * - Zero-result 'partial' (truncationReason='unknown') shows the inconclusive
 *   warning inline.
 *
 * XSS invariants (spec §5.3 — critical):
 * - text, authorHandle, channelLabel are attacker-controlled; all rendered as
 *   React text children (textContent semantics) — no dangerouslySetInnerHTML.
 * - Bidi-override and zero-width characters are stripped from authorHandle
 *   before display (evidentiary-misattribution risk).
 * - Permalink url is scheme-guarded via safeHref(); if the guard fails, the
 *   URL is rendered as plain text with no <a> element.
 * - No auto-fetch of embedded t.co links — display-only.
 * - No mediaRef display — mediaType shown for provenance; no CDN fetch.
 *
 * Manual smoke checklist (renderer is not headlessly testable):
 * 1. Open module → gate notice visible when either x.networkEnabled or
 *    x.clearnetAcknowledged is false.
 * 2. Confirm both flags in Settings → X Collector → gate notice disappears.
 * 3. Enter a case ID and press Load → items tab shows empty list.
 * 4. Select "Keyword Search", enter query, press Collect → status shows Running…
 * 5. On sidecar-missing: "Sidecar not installed" badge + missing notice, no crash.
 * 6. On partial: yellow warning banner; "Do NOT treat as evidence of absence."
 * 7. On breakage-detected: red banner directing operator to update sidecar.
 * 8. On done: green "Done" badge, result count shown.
 * 9. Items tab → harvested items appear; author/text rendered as text only.
 * 10. Rank by keyword → ranked list with relevanceScore visible.
 * 11. Permalink: https://x.com URL → <a> link; javascript: URL → plain text.
 * 12. DOM inspect: no raw HTML in author/text/channelLabel — textContent only.
 * 13. Switch to User Timeline mode → username field appears; query field hidden.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HarvestedItem } from '@shared/socmint/types';
import type { XCollectResultShape, XCollectorStatus } from '@shared/ipc-contracts';
import { useSettings } from '../../state/store';
import { safeHref } from '../socmint/safe-href';
import { xStatusDisplay } from './status-display';
import { buildXCollectRequest, canCollect as canCollectFn } from './x-collect-request';
import './x-collector.css';

// ---------------------------------------------------------------------------
// Bidi-override sanitization (spec §5.3 — evidentiary-misattribution guard)
// ---------------------------------------------------------------------------

/**
 * Strip bidi-override, zero-width, and related invisible characters from a
 * handle string before display.
 *
 * These characters can make "@evil" look like "@legitimate" in the rendered DOM
 * by overriding display direction or inserting invisible substitutions.
 * This is a hardcoded compile-time pattern; NEVER new RegExp(userInput).
 *
 * Covers: soft-hyphen, zero-width chars (U+200B-U+200F), line/para separators
 * (U+2028-U+2029), LTR/RTL embedding+override (U+202A-U+202E), bidi isolates
 * (U+2066-U+2069), BOM/ZWNBSP (U+FEFF).
 */
const BIDI_ZERO_WIDTH_RE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

function sanitizeHandle(raw: string): string {
  return raw.replace(BIDI_ZERO_WIDTH_RE, '');
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function XStatusBadge({ status }: { status: XCollectorStatus }): JSX.Element {
  const d = xStatusDisplay(status);
  return (
    <div className="xc-status-bar">
      <span className="xc-status-label">Status:</span>
      <span className={`xc-status-badge xc-badge-${d.variant}`}>
        {d.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAIL-LOUD banners (spec §4)
// ---------------------------------------------------------------------------

/**
 * Breakage banner (spec §4.3): persistent until the sidecar is updated.
 * Shown for status='breakage-detected'.
 */
function XBreakageBanner(): JSX.Element {
  return (
    <div className="xc-breakage-banner" role="alert" aria-live="assertive">
      <strong>X collector is broken — the X API changed.</strong>
      {' '}Update the twscrape-runner sidecar to restore collection.
      The existing collected data in the Items tab is unaffected.
    </div>
  );
}

/**
 * Partial / truncation banner (spec §4.2): shown for status='partial'.
 * Reason and message are surfaced when present.
 * The "Do NOT treat as evidence of absence" warning is always shown.
 */
function XPartialBanner({
  totalFromSidecar,
  truncationReason,
  truncationMessage,
}: {
  totalFromSidecar: number;
  truncationReason?: string;
  truncationMessage?: string;
}): JSX.Element {
  return (
    <div className="xc-partial-banner" role="alert">
      <strong>
        Collection stopped early — {totalFromSidecar} result{totalFromSidecar === 1 ? '' : 's'}.
      </strong>
      {truncationReason !== undefined && (
        <span>
          {' '}Reason: {truncationReason}.
        </span>
      )}
      {truncationMessage !== undefined && (
        <span>
          {' '}{truncationMessage}
        </span>
      )}
      <span className="xc-partial-never-absence">
        May be incomplete. Do NOT treat as evidence of absence.
      </span>
    </div>
  );
}

/**
 * Error banner: shown for status='error'.
 */
function XErrorBanner({
  errorCode,
  errorMessage,
}: {
  errorCode?: string;
  errorMessage?: string;
}): JSX.Element {
  return (
    <div className="xc-error-banner" role="alert">
      <strong>Collection error{errorCode !== undefined ? ` [${errorCode}]` : ''}.</strong>
      {errorMessage !== undefined && <span> {errorMessage}</span>}
    </div>
  );
}

/**
 * Sidecar-missing notice: shown for status='sidecar-missing'.
 * Distinct from an error — the sidecar just hasn't been installed/locked yet.
 */
function XSidecarMissingNotice({ errorMessage }: { errorMessage?: string }): JSX.Element {
  return (
    <div className="xc-missing-notice" role="note">
      <strong>X collector sidecar not installed</strong>
      {errorMessage !== undefined ? ` — ${errorMessage}` : ' — pending operator lock.'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item row (XSS-safe)
// ---------------------------------------------------------------------------

interface XItemRowProps {
  item: HarvestedItem;
  onLabel(itemId: string, decision: 'accept' | 'reject'): void;
}

function XItemRow({ item, onLabel }: XItemRowProps): JSX.Element {
  // Scheme-guard: if the URL is not https://x.com/* or https://twitter.com/*,
  // safeHref returns null and we fall through to plain-text rendering.
  const href = safeHref(item.url);

  // Strip bidi-override characters from the handle before display.
  // authorHandle is attacker-controlled — never rendered via innerHTML.
  const safeHandle = sanitizeHandle(item.authorHandle);

  return (
    <li className="xc-item">
      <div className="xc-item-header">
        {/* All values rendered as React text children — no dangerouslySetInnerHTML. */}
        <span className="xc-item-platform-badge">X</span>
        <span className="xc-item-author">@{safeHandle}</span>
        <span className="xc-item-channel">{item.channelLabel}</span>
        <span className="xc-item-time">{item.publishedAt}</span>
        {item.relevanceScore !== undefined && (
          <span className="xc-item-score" title="Relevance score">
            {item.relevanceScore.toFixed(4)}
          </span>
        )}
        {/* mediaType shown for provenance — mediaRef is NEVER rendered (spec §5.4). */}
        {item.mediaType !== undefined && (
          <span className="xc-item-media">{item.mediaType}</span>
        )}
      </div>

      {/* Harvested tweet text — React text child; no dangerouslySetInnerHTML. */}
      <p className="xc-item-text">{item.text}</p>

      <div className="xc-item-footer">
        {href !== null ? (
          <a
            className="xc-item-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Permalink
          </a>
        ) : (
          /* URL failed scheme-guard or is empty: render as plain text, no anchor. */
          item.url ? (
            <span className="xc-item-link-plain">{item.url}</span>
          ) : null
        )}

        <div className="xc-item-actions">
          <button
            className="xc-btn xc-btn-accept"
            onClick={() => onLabel(item.id, 'accept')}
            title="Mark as accepted"
          >
            Accept
          </button>
          <button
            className="xc-btn xc-btn-reject"
            onClick={() => onLabel(item.id, 'reject')}
            title="Mark as rejected"
          >
            Reject
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Items panel
// ---------------------------------------------------------------------------

interface XItemsPanelProps {
  items: HarvestedItem[];
  rankKeyword: string;
  ranking: boolean;
  onChangeRankKeyword(v: string): void;
  onRankItems(): void;
  onRefreshItems(): void;
  onLabel(itemId: string, decision: 'accept' | 'reject'): void;
}

function XItemsPanel({
  items,
  rankKeyword,
  ranking,
  onChangeRankKeyword,
  onRankItems,
  onRefreshItems,
  onLabel,
}: XItemsPanelProps): JSX.Element {
  return (
    <div className="xc-items">
      <div className="xc-rank-bar">
        <input
          className="xc-input xc-rank-input"
          value={rankKeyword}
          onChange={(e) => onChangeRankKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRankItems(); }}
          placeholder="Rank by keyword…"
          aria-label="Rank items by keyword"
        />
        <button
          className="xc-btn xc-btn-primary"
          onClick={onRankItems}
          disabled={ranking || !rankKeyword.trim()}
        >
          {ranking ? 'Ranking…' : 'Rank'}
        </button>
        <button className="xc-btn" onClick={onRefreshItems}>
          Refresh
        </button>
      </div>

      {items.length === 0 ? (
        <p className="xc-empty">No collected items. Run a collection job to harvest posts.</p>
      ) : (
        <ul className="xc-item-list">
          {items.map((item) => (
            <XItemRow key={item.id} item={item} onLabel={onLabel} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collect panel
// ---------------------------------------------------------------------------

type CollectMode = 'search' | 'userTweets';

interface XCollectPanelProps {
  gateOpen: boolean;
  onCollect(req: {
    caseId: string;
    mode: CollectMode;
    query?: string;
    username?: string;
    limit?: number;
    accountId?: string;
  }): Promise<void>;
  lastResult: XCollectResultShape | null;
  collecting: boolean;
  caseId: string;
  /** Stored X account IDs (from x.listAccounts) — never carries credentials. */
  accounts: string[];
  /** The account ID whose stored cookie this harvest will authenticate with. */
  selectedAccount: string;
  onSelectAccount(id: string): void;
}

function XCollectPanel({
  gateOpen,
  onCollect,
  lastResult,
  collecting,
  caseId,
  accounts,
  selectedAccount,
  onSelectAccount,
}: XCollectPanelProps): JSX.Element {
  const [mode, setMode] = useState<CollectMode>('search');
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');
  const [limit, setLimit] = useState('500');

  const noAccounts = accounts.length === 0;
  const canCollect = canCollectFn({
    gateOpen, collecting, caseId, mode, query, username, accountId: selectedAccount,
  });

  const handleCollect = useCallback(async () => {
    if (!canCollect) return;
    const limitNum = parseInt(limit, 10);
    await onCollect(buildXCollectRequest({
      caseId,
      mode,
      query,
      username,
      accountId: selectedAccount,
      ...(Number.isFinite(limitNum) && limitNum > 0 ? { limit: limitNum } : {}),
    }));
  }, [canCollect, onCollect, caseId, mode, query, username, limit, selectedAccount]);

  const status: XCollectorStatus = lastResult?.status ?? 'idle';
  const d = xStatusDisplay(status);

  return (
    <div>
      <section className="xc-section">
        <h3 className="xc-section-title">Collection Mode</h3>
        <div className="xc-mode-bar">
          <button
            className={`xc-mode-btn${mode === 'search' ? ' xc-mode-active' : ''}`}
            onClick={() => setMode('search')}
            aria-pressed={mode === 'search'}
          >
            Keyword Search
          </button>
          <button
            className={`xc-mode-btn${mode === 'userTweets' ? ' xc-mode-active' : ''}`}
            onClick={() => setMode('userTweets')}
            aria-pressed={mode === 'userTweets'}
          >
            User Timeline
          </button>
        </div>

        {/* Account selector — the harvest authenticates with this account's stored
            cookie. Without an account twscrape returns nothing, so collection is
            gated on a selection (see canCollect). Options are IDs only — no creds. */}
        <div className="xc-form-row">
          <label htmlFor="xc-account" className="xc-label">Account</label>
          {noAccounts ? (
            <span className="xc-note">
              No X account stored. Add one in Settings › X Collector (paste your
              auth_token + ct0 cookie) before collecting.
            </span>
          ) : (
            <select
              id="xc-account"
              className="xc-input"
              value={selectedAccount}
              onChange={(e) => onSelectAccount(e.target.value)}
            >
              {accounts.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          )}
        </div>

        {mode === 'search' ? (
          <div className="xc-form-row">
            <label htmlFor="xc-query" className="xc-label">Search query</label>
            <input
              id="xc-query"
              className="xc-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCollect) void handleCollect(); }}
              placeholder="from:user keyword lang:en"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="xc-form-row">
            <label htmlFor="xc-username" className="xc-label">Username (without @)</label>
            <input
              id="xc-username"
              className="xc-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCollect) void handleCollect(); }}
              placeholder="username"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="xc-form-row">
          <label htmlFor="xc-limit" className="xc-label">Max results</label>
          <input
            id="xc-limit"
            className="xc-input"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="500"
            style={{ width: 70 }}
            autoComplete="off"
          />
        </div>

        <button
          className="xc-btn xc-btn-primary"
          onClick={() => void handleCollect()}
          disabled={!canCollect}
          title={
            !gateOpen
              ? 'Enable X Collector and acknowledge clearnet use in Settings → X Collector first'
              : !caseId
              ? 'Enter a case ID first'
              : noAccounts
              ? 'Add an X account in Settings → X Collector first — collection needs a logged-in account'
              : !selectedAccount
              ? 'Select an account to collect with'
              : mode === 'search' && !query.trim()
              ? 'Enter a search query'
              : mode === 'userTweets' && !username.trim()
              ? 'Enter a username'
              : undefined
          }
        >
          {collecting ? 'Collecting…' : 'Collect'}
        </button>

        {!gateOpen && (
          <p className="xc-note">
            X Collector requires both network enable and clearnet acknowledgement in Settings.
          </p>
        )}
      </section>

      {/* Status section */}
      <section className="xc-section">
        <h3 className="xc-section-title">Last Job Status</h3>
        <XStatusBadge status={status} />

        {lastResult !== null && (
          <p className="xc-result-summary">
            {/* FAIL-LOUD: status=done is the ONLY complete result. */}
            {d.isComplete
              ? `Collected ${lastResult.itemsAdded} new item${lastResult.itemsAdded === 1 ? '' : 's'} (${lastResult.itemsSkipped} already stored). Total from sidecar: ${lastResult.totalFromSidecar}.`
              : `Items added: ${lastResult.itemsAdded}. Total from sidecar: ${lastResult.totalFromSidecar}.`}
          </p>
        )}

        {/* FAIL-LOUD banners — must appear for non-done statuses */}
        {status === 'breakage-detected' && <XBreakageBanner />}

        {status === 'partial' && lastResult !== null && (
          <XPartialBanner
            totalFromSidecar={lastResult.totalFromSidecar}
            truncationReason={lastResult.truncationReason}
            truncationMessage={lastResult.truncationMessage}
          />
        )}

        {status === 'error' && lastResult !== null && (
          <XErrorBanner
            errorCode={lastResult.errorCode}
            errorMessage={lastResult.errorMessage}
          />
        )}

        {status === 'sidecar-missing' && lastResult !== null && (
          <XSidecarMissingNotice errorMessage={lastResult.errorMessage} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XCollectorModule (root)
// ---------------------------------------------------------------------------

type XTab = 'collect' | 'items';

/**
 * X/Twitter Collector root module.
 *
 * Clearnet gate: both settings.x.networkEnabled AND settings.x.clearnetAcknowledged
 * must be true for collection to proceed. The gate notice is always visible when
 * either flag is false.
 */
export function XCollectorModule({ caseId: propCaseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  // Read defensively: settings may be null on first render; x block may be absent on
  // a legacy settings object loaded before this field was added.
  const networkEnabled = settings?.x?.networkEnabled ?? false;
  const clearnetAcknowledged = settings?.x?.clearnetAcknowledged ?? false;
  const gateOpen = networkEnabled && clearnetAcknowledged;

  const [tab, setTab] = useState<XTab>('collect');

  // Case ID — use the prop when provided; otherwise let the user enter one.
  const [caseId, setCaseId] = useState<string>(propCaseId ?? '');
  const [caseIdInput, setCaseIdInput] = useState<string>(propCaseId ?? '');

  // Keep caseId in sync when propCaseId changes (e.g. opened from a Case window).
  useEffect(() => {
    if (propCaseId !== undefined) {
      setCaseId(propCaseId);
      setCaseIdInput(propCaseId);
    }
  }, [propCaseId]);

  // Collection state
  const [collecting, setCollecting] = useState(false);
  const [lastResult, setLastResult] = useState<XCollectResultShape | null>(null);

  // Items state
  const [items, setItems] = useState<HarvestedItem[]>([]);
  const [rankKeyword, setRankKeyword] = useState('');
  const [ranking, setRanking] = useState(false);

  // Stored X accounts — IDs only (x.listAccounts never returns credentials).
  // The selected account's cookie is what authenticates a harvest; without one,
  // twscrape collects nothing, so the Collect button is gated on a selection.
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  const loadAccounts = useCallback(async () => {
    try {
      const ids = (await window.api.x.listAccounts()) as string[];
      setAccounts(ids);
      // Auto-select when exactly one account exists; otherwise keep any still-valid
      // selection and fall back to the first when the prior pick was removed.
      setSelectedAccount((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? '')));
    } catch (err) {
      console.warn('[XCollector] listAccounts:', err);
    }
  }, []);

  // Refresh the account list on mount and whenever the collect tab is shown,
  // so an account added in Settings appears without reopening the module.
  useEffect(() => {
    if (tab === 'collect') void loadAccounts();
  }, [tab, loadAccounts]);

  // Also refresh when the window regains focus. Accounts are edited in the
  // separate Settings window; without this, deleting the selected account there
  // while sitting on the Collect tab would leave a stale selection and silently
  // re-open the logged-out-harvest path this fix exists to close. On reload,
  // loadAccounts drops a now-missing selection (→ canCollect blocks).
  useEffect(() => {
    const onFocus = (): void => { if (tab === 'collect') void loadAccounts(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tab, loadAccounts]);

  // Persistent breakage banner: shown until the operator dismisses it per-session.
  // We track it here so it persists across collect calls.
  const showBreakageBanner =
    lastResult?.status === 'breakage-detected';

  const handleApplyCaseId = useCallback(() => {
    setCaseId(caseIdInput.trim());
  }, [caseIdInput]);

  const loadItems = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await window.api.x.listItems(caseId);
      setItems(result as HarvestedItem[]);
    } catch (err) {
      console.warn('[XCollector] listItems:', err);
    }
  }, [caseId]);

  // Load items on mount and caseId change.
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleCollect = useCallback(async (req: {
    caseId: string;
    mode: 'search' | 'userTweets';
    query?: string;
    username?: string;
    limit?: number;
    accountId?: string;
  }) => {
    if (!gateOpen) return;
    setCollecting(true);
    try {
      const result = await window.api.x.collect(req) as XCollectResultShape;
      setLastResult(result);
      // Refresh items after collection regardless of status.
      await loadItems();
    } catch (err: unknown) {
      // XCollectorGatedError thrown at IPC boundary if gate was closed concurrently.
      // Surface as an error rather than crashing or silently dropping.
      console.warn('[XCollector] collect:', err);
      setLastResult({
        status: 'error',
        itemsAdded: 0,
        itemsSkipped: 0,
        totalFromSidecar: 0,
        errorCode: 'IPC_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
        jobId: `ipc-error-${Date.now()}`,
      });
    } finally {
      setCollecting(false);
    }
  }, [gateOpen, loadItems]);

  const handleRankItems = useCallback(async () => {
    if (!caseId || !rankKeyword.trim()) return;
    setRanking(true);
    try {
      const ranked = await window.api.x.rankItems(caseId, rankKeyword.trim());
      setItems(ranked as HarvestedItem[]);
    } catch (err) {
      console.warn('[XCollector] rankItems:', err);
    } finally {
      setRanking(false);
    }
  }, [caseId, rankKeyword]);

  const handleLabel = useCallback(async (itemId: string, decision: 'accept' | 'reject') => {
    if (!caseId) return;
    try {
      await window.api.socmint.recordLabel(caseId, {
        itemId,
        decision,
        labeledAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[XCollector] recordLabel:', err);
    }
  }, [caseId]);

  return (
    <div className="xc-root">
      {/* ── Clearnet gate notice — always visible when either flag is off ── */}
      {!gateOpen && (
        <div className="xc-gate-notice" role="alert">
          <strong>X Collector is gated.</strong>{' '}
          {!clearnetAcknowledged
            ? 'Acknowledge clearnet use in Settings › X Collector first.'
            : 'Enable X Collector network in Settings › X Collector.'}
          {' '}This module connects to x.com over the public internet — it cannot be
          routed through Tor. Previously collected data remains accessible in the Items tab.
        </div>
      )}

      {/* ── Persistent breakage banner (shown above tabs, spec §4.3) ──────── */}
      {showBreakageBanner && <XBreakageBanner />}

      {/* ── Case ID selector (when not provided as a prop) ───────────────── */}
      {propCaseId === undefined && (
        <div className="xc-case-bar">
          <label htmlFor="xc-case-id" className="xc-label">Case ID</label>
          <input
            id="xc-case-id"
            className="xc-input"
            value={caseIdInput}
            onChange={(e) => setCaseIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCaseId(); }}
            placeholder="Enter case ID…"
          />
          <button className="xc-btn" onClick={handleApplyCaseId}>
            Load
          </button>
        </div>
      )}

      {caseId ? (
        <>
          {/* ── Tab bar ──────────────────────────────────────────────────── */}
          <div className="xc-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'collect'}
              className={`xc-tab${tab === 'collect' ? ' xc-tab-active' : ''}`}
              onClick={() => setTab('collect')}
            >
              Collect
            </button>
            <button
              role="tab"
              aria-selected={tab === 'items'}
              className={`xc-tab${tab === 'items' ? ' xc-tab-active' : ''}`}
              onClick={() => { setTab('items'); void loadItems(); }}
            >
              Harvested Items
            </button>
          </div>

          <div className="xc-body">
            {tab === 'collect' && (
              <XCollectPanel
                gateOpen={gateOpen}
                onCollect={handleCollect}
                lastResult={lastResult}
                collecting={collecting}
                caseId={caseId}
                accounts={accounts}
                selectedAccount={selectedAccount}
                onSelectAccount={setSelectedAccount}
              />
            )}
            {tab === 'items' && (
              <XItemsPanel
                items={items}
                rankKeyword={rankKeyword}
                ranking={ranking}
                onChangeRankKeyword={setRankKeyword}
                onRankItems={handleRankItems}
                onRefreshItems={loadItems}
                onLabel={handleLabel}
              />
            )}
          </div>
        </>
      ) : (
        <div className="xc-placeholder">Enter a case ID above to load X Collector data.</div>
      )}
    </div>
  );
}
