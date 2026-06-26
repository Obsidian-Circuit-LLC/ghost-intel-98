/**
 * SOCMINT Module — Telegram public-channel monitor v1.
 *
 * All harvested data flows main→renderer over IPC. The renderer makes no network calls.
 *
 * XSS invariants (critical):
 * - `text`, `authorHandle`, `channelLabel` rendered as React text children only — no
 *   dangerouslySetInnerHTML anywhere in this file.
 * - Permalink anchors are built only after scheme-guarding `url` to http/https via
 *   safeHref(). If the guard fails, the URL is rendered as plain text with no <a> element.
 * - `mediaRef` is never rendered as a path or href; only `mediaType` is shown if present.
 * - No renderer network calls — all state is fetched via window.api.socmint.*
 *
 * Manual smoke checklist (no headless render test — renderer is not headlessly testable):
 * 1. Open module → network-gate notice visible when settings.socmint.networkEnabled=false.
 * 2. Enable SOCMINT network in Settings → SOCMINT → gate notice disappears.
 * 3. Enter a case ID and press Load → channel list loads (empty on fresh case).
 * 4. Add a channel: channelId, label, comma-separated keywords → appears in list.
 * 5. Remove a channel → item disappears from list.
 * 6. Switch to Harvested Items tab → items load (empty on fresh case).
 * 7. Rank by keyword → ranked list returned; relevanceScore values appear.
 * 8. Accept / Reject an item → confirm socmint:recordLabel fires (main-process log).
 * 9. Inspect DOM: text/authorHandle/channelLabel have no raw HTML — textContent only.
 * 10. Permalink: http:// URL → <a> link rendered. javascript:/ or data: URL → plain text.
 * 11. mediaRef: never appears as a path or href in the DOM.
 * 12. Start Monitor: disabled until network is enabled; clicking when enabled sends
 *     socmint:startMonitor. If egress gate blocks it, the returned `{ disabled: true }`
 *     is handled gracefully (no crash).
 */

import { useCallback, useEffect, useState } from 'react';
import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import { useSettings } from '../../state/store';
import { safeHref } from './safe-href';
import './socmint.css';

// ---------------------------------------------------------------------------
// ChannelsPanel
// ---------------------------------------------------------------------------

interface ChannelsPanelProps {
  channels: MonitoredChannel[];
  newChannelId: string;
  newChannelLabel: string;
  newChannelKeywords: string;
  networkEnabled: boolean;
  activeJobId: string | null;
  monitoring: boolean;
  onChangeNewChannelId(v: string): void;
  onChangeNewChannelLabel(v: string): void;
  onChangeNewChannelKeywords(v: string): void;
  onAddChannel(): void;
  onRemoveChannel(channelId: string): void;
  onStartMonitor(): void;
  onStopMonitor(): void;
}

function ChannelsPanel({
  channels,
  newChannelId,
  newChannelLabel,
  newChannelKeywords,
  networkEnabled,
  activeJobId,
  monitoring,
  onChangeNewChannelId,
  onChangeNewChannelLabel,
  onChangeNewChannelKeywords,
  onAddChannel,
  onRemoveChannel,
  onStartMonitor,
  onStopMonitor,
}: ChannelsPanelProps): JSX.Element {
  return (
    <div className="sm-channels">
      {/* Add channel form */}
      <section className="sm-section">
        <h3 className="sm-section-title">Add Monitored Channel</h3>
        <div className="sm-form-row">
          <label htmlFor="sm-ch-id" className="sm-label">Channel ID / @username</label>
          <input
            id="sm-ch-id"
            className="sm-input"
            value={newChannelId}
            onChange={(e) => onChangeNewChannelId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAddChannel(); }}
            placeholder="-100123456789 or @channelname"
          />
        </div>
        <div className="sm-form-row">
          <label htmlFor="sm-ch-label" className="sm-label">Label (optional)</label>
          <input
            id="sm-ch-label"
            className="sm-input"
            value={newChannelLabel}
            onChange={(e) => onChangeNewChannelLabel(e.target.value)}
            placeholder="Human-readable label"
          />
        </div>
        <div className="sm-form-row">
          <label htmlFor="sm-ch-kw" className="sm-label">Keywords (comma-separated; empty = all)</label>
          <input
            id="sm-ch-kw"
            className="sm-input"
            value={newChannelKeywords}
            onChange={(e) => onChangeNewChannelKeywords(e.target.value)}
            placeholder="keyword1, keyword2"
          />
        </div>
        <button
          className="sm-btn sm-btn-primary"
          onClick={onAddChannel}
          disabled={!newChannelId.trim()}
        >
          Add Channel
        </button>
      </section>

      {/* Channel list */}
      <section className="sm-section">
        <h3 className="sm-section-title">Monitored Channels ({channels.length})</h3>
        {channels.length === 0 ? (
          <p className="sm-empty">No channels monitored. Add one above.</p>
        ) : (
          <ul className="sm-channel-list">
            {channels.map((ch) => (
              <li key={ch.channelId} className="sm-channel-item">
                <div className="sm-channel-info">
                  {/* XSS-safe: label/channelId/keywords rendered as text children */}
                  <span className="sm-channel-label">{ch.label}</span>
                  <span className="sm-channel-id">{ch.channelId}</span>
                  {ch.keywords.length > 0 && (
                    <span className="sm-channel-kw">
                      {ch.keywords.join(', ')}
                    </span>
                  )}
                </div>
                <button
                  className="sm-btn sm-btn-danger"
                  onClick={() => onRemoveChannel(ch.channelId)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Monitor controls */}
      <section className="sm-section">
        <h3 className="sm-section-title">Monitor</h3>
        {activeJobId !== null ? (
          <div className="sm-monitor-active">
            <span className="sm-monitor-status">
              {/* jobId is an internal identifier — render as text, not innerHTML */}
              Active job: {activeJobId}
            </span>
            <button className="sm-btn sm-btn-danger" onClick={onStopMonitor}>
              Stop Monitor
            </button>
          </div>
        ) : (
          <>
            <button
              className="sm-btn sm-btn-primary"
              onClick={onStartMonitor}
              disabled={!networkEnabled || monitoring || channels.length === 0}
              title={
                !networkEnabled
                  ? 'Enable SOCMINT network in Settings to start monitoring'
                  : channels.length === 0
                  ? 'Add at least one channel before starting'
                  : undefined
              }
            >
              {monitoring ? 'Starting…' : 'Start Monitor'}
            </button>
            {!networkEnabled && (
              <p className="sm-note">Network disabled — enable in Settings → SOCMINT.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemRow (extracted for clarity; all text rendered XSS-safe)
// ---------------------------------------------------------------------------

interface ItemRowProps {
  item: HarvestedItem;
  onLabel(itemId: string, decision: 'accept' | 'reject'): void;
}

function ItemRow({ item, onLabel }: ItemRowProps): JSX.Element {
  // Scheme-guard the permalink URL. If the URL is not http/https, safeHref returns null
  // and we fall through to plain-text rendering — never an <a> element.
  const href = safeHref(item.url);

  return (
    <li className="sm-item">
      <div className="sm-item-header">
        {/* All text values rendered as React text children — no dangerouslySetInnerHTML. */}
        <span className="sm-item-author">{item.authorHandle}</span>
        <span className="sm-item-channel">{item.channelLabel}</span>
        <span className="sm-item-time">{item.publishedAt}</span>
        {item.relevanceScore !== undefined && (
          <span className="sm-item-score" title="Relevance score (cosine similarity)">
            {item.relevanceScore.toFixed(4)}
          </span>
        )}
        {/* mediaType shown as text only; mediaRef is intentionally never rendered */}
        {item.mediaType && (
          <span className="sm-item-media">{item.mediaType}</span>
        )}
      </div>

      {/* Harvested message text — rendered as React text child (textContent semantics). */}
      <p className="sm-item-text">{item.text}</p>

      <div className="sm-item-footer">
        {href !== null ? (
          <a
            className="sm-item-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Permalink
          </a>
        ) : (
          /* Non-http(s) URL: render as plain text, no anchor element. */
          <span className="sm-item-link-plain">{item.url}</span>
        )}

        <div className="sm-item-actions">
          <button
            className="sm-btn sm-btn-accept"
            onClick={() => onLabel(item.id, 'accept')}
            title="Mark as accepted"
          >
            Accept
          </button>
          <button
            className="sm-btn sm-btn-reject"
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
// ItemsPanel
// ---------------------------------------------------------------------------

interface ItemsPanelProps {
  items: HarvestedItem[];
  rankKeyword: string;
  ranking: boolean;
  onChangeRankKeyword(v: string): void;
  onRankItems(): void;
  onRefreshItems(): void;
  onLabel(itemId: string, decision: 'accept' | 'reject'): void;
}

function ItemsPanel({
  items,
  rankKeyword,
  ranking,
  onChangeRankKeyword,
  onRankItems,
  onRefreshItems,
  onLabel,
}: ItemsPanelProps): JSX.Element {
  return (
    <div className="sm-items">
      <div className="sm-rank-bar">
        <input
          className="sm-input sm-rank-input"
          value={rankKeyword}
          onChange={(e) => onChangeRankKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRankItems(); }}
          placeholder="Rank by keyword…"
          aria-label="Rank items by keyword"
        />
        <button
          className="sm-btn sm-btn-primary"
          onClick={onRankItems}
          disabled={ranking || !rankKeyword.trim()}
        >
          {ranking ? 'Ranking…' : 'Rank'}
        </button>
        <button className="sm-btn" onClick={onRefreshItems}>
          Refresh
        </button>
      </div>

      {items.length === 0 ? (
        <p className="sm-empty">No harvested items. Start monitoring to collect messages.</p>
      ) : (
        <ul className="sm-item-list">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} onLabel={onLabel} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SocmintModule (root)
// ---------------------------------------------------------------------------

type Tab = 'channels' | 'items';

export function SocmintModule({ caseId: propCaseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  // Read defensively: settings may be null on first render, socmint block may be absent on
  // a legacy settings object loaded before this field was added.
  const networkEnabled = settings?.socmint?.networkEnabled ?? false;

  const [tab, setTab] = useState<Tab>('channels');

  // Controlled case ID — use the prop if provided; otherwise let the user enter one.
  const [caseId, setCaseId] = useState<string>(propCaseId ?? '');
  const [caseIdInput, setCaseIdInput] = useState<string>(propCaseId ?? '');

  // Keep caseId in sync when propCaseId changes (e.g. opened from a Case window).
  useEffect(() => {
    if (propCaseId !== undefined) {
      setCaseId(propCaseId);
      setCaseIdInput(propCaseId);
    }
  }, [propCaseId]);

  // Channels
  const [channels, setChannels] = useState<MonitoredChannel[]>([]);
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelLabel, setNewChannelLabel] = useState('');
  const [newChannelKeywords, setNewChannelKeywords] = useState('');

  // Items
  const [items, setItems] = useState<HarvestedItem[]>([]);
  const [rankKeyword, setRankKeyword] = useState('');
  const [ranking, setRanking] = useState(false);

  // Monitor
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState(false);

  const loadChannels = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await window.api.socmint.listChannels(caseId);
      setChannels(result);
    } catch (err) {
      console.warn('[SOCMINT] listChannels:', err);
    }
  }, [caseId]);

  const loadItems = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await window.api.socmint.listItems(caseId);
      setItems(result);
    } catch (err) {
      console.warn('[SOCMINT] listItems:', err);
    }
  }, [caseId]);

  // Load on mount and caseId change.
  useEffect(() => {
    void loadChannels();
    void loadItems();
  }, [loadChannels, loadItems]);

  const handleApplyCaseId = useCallback(() => {
    setCaseId(caseIdInput.trim());
  }, [caseIdInput]);

  const handleAddChannel = useCallback(async () => {
    if (!caseId || !newChannelId.trim()) return;
    const keywords = newChannelKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const channel: MonitoredChannel = {
      channelId: newChannelId.trim(),
      label: newChannelLabel.trim() || newChannelId.trim(),
      keywords,
    };
    try {
      const updated = await window.api.socmint.addChannel(caseId, channel);
      setChannels(updated);
      setNewChannelId('');
      setNewChannelLabel('');
      setNewChannelKeywords('');
    } catch (err) {
      console.warn('[SOCMINT] addChannel:', err);
    }
  }, [caseId, newChannelId, newChannelLabel, newChannelKeywords]);

  const handleRemoveChannel = useCallback(async (channelId: string) => {
    if (!caseId) return;
    try {
      const updated = await window.api.socmint.removeChannel(caseId, channelId);
      setChannels(updated);
    } catch (err) {
      console.warn('[SOCMINT] removeChannel:', err);
    }
  }, [caseId]);

  const handleRankItems = useCallback(async () => {
    if (!caseId || !rankKeyword.trim()) return;
    setRanking(true);
    try {
      const ranked = await window.api.socmint.rankItems(caseId, rankKeyword.trim());
      setItems(ranked);
    } catch (err) {
      console.warn('[SOCMINT] rankItems:', err);
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
      console.warn('[SOCMINT] recordLabel:', err);
    }
  }, [caseId]);

  const handleStartMonitor = useCallback(async () => {
    if (!caseId || !networkEnabled) return;
    setMonitoring(true);
    try {
      const result = await window.api.socmint.startMonitor({ caseId });
      if ('jobId' in result) {
        setActiveJobId(result.jobId);
      }
      // If result is { disabled: true }, the gate is off — handled gracefully (no crash).
    } catch (err) {
      console.warn('[SOCMINT] startMonitor:', err);
    } finally {
      setMonitoring(false);
    }
  }, [caseId, networkEnabled]);

  const handleStopMonitor = useCallback(async () => {
    if (!activeJobId) return;
    try {
      await window.api.socmint.stopMonitor(activeJobId);
      setActiveJobId(null);
    } catch (err) {
      console.warn('[SOCMINT] stopMonitor:', err);
    }
  }, [activeJobId]);

  return (
    <div className="sm-root">
      {/* Network-gate notice: always visible when egress is disabled. */}
      {!networkEnabled && (
        <div className="sm-gate-notice" role="alert">
          <strong>SOCMINT network is disabled.</strong>{' '}
          Enable it in Settings &rsaquo; SOCMINT to start monitoring.
          Previously collected data remains accessible in the Items tab.
        </div>
      )}

      {/* Case ID selector — only shown when caseId is not passed as a prop. */}
      {propCaseId === undefined && (
        <div className="sm-case-bar">
          <label htmlFor="sm-case-id" className="sm-label">Case ID</label>
          <input
            id="sm-case-id"
            className="sm-input"
            value={caseIdInput}
            onChange={(e) => setCaseIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCaseId(); }}
            placeholder="Enter case ID…"
          />
          <button className="sm-btn" onClick={handleApplyCaseId}>
            Load
          </button>
        </div>
      )}

      {caseId ? (
        <>
          {/* Tab bar */}
          <div className="sm-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'channels'}
              className={`sm-tab${tab === 'channels' ? ' sm-tab-active' : ''}`}
              onClick={() => { setTab('channels'); void loadChannels(); }}
            >
              Channels
            </button>
            <button
              role="tab"
              aria-selected={tab === 'items'}
              className={`sm-tab${tab === 'items' ? ' sm-tab-active' : ''}`}
              onClick={() => { setTab('items'); void loadItems(); }}
            >
              Harvested Items
            </button>
          </div>

          <div className="sm-body">
            {tab === 'channels' && (
              <ChannelsPanel
                channels={channels}
                newChannelId={newChannelId}
                newChannelLabel={newChannelLabel}
                newChannelKeywords={newChannelKeywords}
                onChangeNewChannelId={setNewChannelId}
                onChangeNewChannelLabel={setNewChannelLabel}
                onChangeNewChannelKeywords={setNewChannelKeywords}
                onAddChannel={handleAddChannel}
                onRemoveChannel={handleRemoveChannel}
                networkEnabled={networkEnabled}
                activeJobId={activeJobId}
                monitoring={monitoring}
                onStartMonitor={handleStartMonitor}
                onStopMonitor={handleStopMonitor}
              />
            )}
            {tab === 'items' && (
              <ItemsPanel
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
        <div className="sm-placeholder">Enter a case ID above to load SOCMINT data.</div>
      )}
    </div>
  );
}
