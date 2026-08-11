/**
 * X Listening Station — renderer SHELL (Enterprise v3.4.1 port, Task 13).
 *
 * Wholesale rebuild onto the Phase-1/Phase-2 Tor-default surface (session.ts/capture.ts/
 * campaigns.ts/analysis.ts, `channels.xListening.{openSession,sessionStatus,closeSession,
 * campaigns*,captureTimeline,analysis,health,entities,presets*}`) — NOT the retiring X1-X8
 * clearnet-only surface (`connect`/`status`/`capture`/…, still registered by
 * `registerXListeningIpc` until Task 16 deletes it, but no longer called from here).
 *
 * This file is the SHELL only (plan Task 13): the header — campaign dock, X-session box, Tor/
 * clearnet posture control, and the persistent CLEARNET/DEMO markers. The tab body (dashboard/
 * live/sources/network/entities/changes/search/notes/exports/campaigns/system) lands in
 * Tasks 14-15; until then `xls-body` shows a placeholder.
 *
 * Case-scoped-but-not-case-required: `caseId` (from `spec.props`) is kept ONLY as an optional
 * display label for a core investigation case this window happened to be opened from — it is
 * NEVER required and NEVER threaded into any xListening IPC call. Every X capture/collection
 * concept here is a self-managed **campaign** — an `x`-namespace scraping-case id
 * (`campaigns.ts`) the module creates/switches/renames/deletes on its own. This is what removes
 * the old "open from a case to capture" requirement (contrast the retiring module's
 * `requireCase()` gate, which this shell has no equivalent of).
 *
 * Tor posture: default is Tor-routed (`AppSettings.xListening.clearnet === false`); `openSession`
 * fails closed (`{blocked:true, reason}`) when background Tor isn't bootstrapped — no silent
 * clearnet fallback (session.ts). Flipping to clearnet is gated by a ONE-TIME real-IP
 * acknowledgement (`AppSettings.xListening.clearnetAck`), mirroring
 * `ai-assistant/useClearnetLinkOpener` (`ai.linkClearnetAcknowledged`) and the Host-Info clearnet
 * toggle (`geoint.cctvResolveClearnetAck` in SettingsModule) — the confirm dialog is shown only
 * on the first false→true flip while unacknowledged; once acknowledged, clearnet can be toggled
 * on/off freely without re-prompting. The FULL fixed-shape `xListening` block is always sent on
 * patch (never a bare `{ clearnet }`) so a sibling toggle (`collect`/`archiveCycles`) can never be
 * dropped by a shallow merge (the v3.24.0 dataloss class).
 *
 * Markers: the CLEARNET/TOR badge is driven directly by the persisted `clearnet` setting (real,
 * shared state — not a fabricated indicator). The DEMO DATA LOADED marker is driven by
 * `hasSyntheticRecords` over this shell's local `posts` cache — empty today (Task 14 populates it
 * via `captureTimeline`; a future "Load Demo Data" action populates it with `synthetic:true`
 * records, store.ts/demo.ts) — so the marker is honestly silent until a campaign actually holds
 * demo/seeded data, never asserted speculatively.
 *
 * No hollow UI (the v3.24.2 lesson): every button below invokes a REAL `window.api.xListening.*`
 * channel — campaign create/switch/rename/delete all round-trip through `campaigns.ts`; the
 * session box drives `openSession`/`sessionStatus`/`closeSession`.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ScrapingCase } from '@shared/types';
import { useSettings } from '../../state/store';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import './x-listening.css';

/** A campaign IS an x-namespace scraping-case id (campaigns.ts) — no separate shape. */
export type XCampaign = ScrapingCase;

/** Minimal local view of a captured X post record — just enough to detect demo/seeded data.
 *  Deliberately NOT the main-process-only `XPostArtifact` (store.ts): this renderer must never
 *  import from `src/main/**` (quarantine-clean boundary — capture-window.ts's own header makes
 *  the same point about the harness staying import-graph-clean of the modules that use it). */
export interface XPostRecord {
  id: string;
  synthetic?: boolean;
}

/** True iff any record carries the demo/seeded honesty flag (Task 12's `synthetic:true`) — the
 *  DEMO DATA LOADED marker's pure predicate. Exported so later tabs (Task 14+) can reuse the
 *  exact same rule rather than re-deriving it. */
export function hasSyntheticRecords(records: readonly XPostRecord[]): boolean {
  return records.some((r) => r.synthetic === true);
}

const CLEARNET_WARNING_TEXT =
  'Routing X capture over CLEARNET exposes your real IP directly to X instead of Tor. ' +
  'This is remembered — you will not be asked again unless you clear it in Settings. Enable clearnet?';

export function XListeningModule({ caseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patchSettings = useSettings((s) => s.patch);

  const [campaigns, setCampaigns] = useState<XCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState('');
  const [campaignBusy, setCampaignBusy] = useState(false);

  const [sessionConnected, setSessionConnected] = useState(false);
  const [sessionWindowOpen, setSessionWindowOpen] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);

  // Task 14 populates this via captureTimeline/loadDemoData results; empty (and therefore no
  // DEMO marker) until a tab actually captures or seeds something into the active campaign.
  const [posts] = useState<XPostRecord[]>([]);

  const [notice, setNotice] = useState('X Listening Station ready.');

  const xListeningSettings = settings?.xListening;
  const clearnet = xListeningSettings?.clearnet === true;
  const clearnetAck = xListeningSettings?.clearnetAck === true;
  const demoActive = hasSyntheticRecords(posts);

  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId);

  // ── campaign list (self-managed — no core case need be bound) ────────────
  const loadCampaigns = useCallback(async (preferId?: string) => {
    try {
      const list = await window.api.xListening.campaignsList();
      setCampaigns(list);
      setActiveCampaignId((cur) => {
        if (preferId && list.some((c) => c.id === preferId)) return preferId;
        if (cur && list.some((c) => c.id === cur)) return cur;
        return list[0]?.id ?? '';
      });
    } catch (err) {
      console.warn('[XListening] campaignsList:', err);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
    // Mount-only: campaign list is refreshed explicitly after every create/rename/delete below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── session status for the active campaign ────────────────────────────────
  const refreshSession = useCallback(async (id: string) => {
    if (!id) {
      setSessionConnected(false);
      setSessionWindowOpen(false);
      return;
    }
    try {
      const s = await window.api.xListening.sessionStatus(id);
      setSessionConnected(s.connected);
      setSessionWindowOpen(s.windowOpen);
    } catch (err) {
      console.warn('[XListening] sessionStatus:', err);
    }
  }, []);

  useEffect(() => {
    void refreshSession(activeCampaignId);
  }, [activeCampaignId, refreshSession]);

  // ── campaign dock actions ──────────────────────────────────────────────────
  const handleNewCampaign = useCallback(async () => {
    const name = await promptDialog(
      'Name this campaign (a self-managed X collection case — no core investigation case is required):',
      '',
      'New campaign',
    );
    if (!name || !name.trim()) return;
    setCampaignBusy(true);
    try {
      const created = await window.api.xListening.campaignsCreate(name.trim());
      await loadCampaigns(created.id);
      setNotice(`Campaign "${created.name}" created.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }, [loadCampaigns]);

  const handleSwitchCampaign = useCallback(
    async (id: string) => {
      if (!id) {
        setActiveCampaignId('');
        return;
      }
      setCampaignBusy(true);
      try {
        // Look up (and thereby validate) the campaign still exists via the real channel — a
        // stale local list entry (deleted from another window) must never be silently treated
        // as active.
        const fresh = await window.api.xListening.campaignsSwitch(id);
        setCampaigns((cur) => cur.map((c) => (c.id === fresh.id ? fresh : c)));
        setActiveCampaignId(fresh.id);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setCampaignBusy(false);
      }
    },
    [],
  );

  const handleRenameCampaign = useCallback(async () => {
    if (!activeCampaign) return;
    const name = await promptDialog('Rename this campaign:', activeCampaign.name, 'Rename campaign');
    if (!name || !name.trim()) return;
    setCampaignBusy(true);
    try {
      await window.api.xListening.campaignsUpdate({ id: activeCampaign.id, name: name.trim() });
      await loadCampaigns(activeCampaign.id);
      setNotice('Campaign renamed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }, [activeCampaign, loadCampaigns]);

  const handleDeleteCampaign = useCallback(async () => {
    if (!activeCampaign) return;
    const ok = await confirmDialog(
      `Delete campaign "${activeCampaign.name}"? This permanently removes every post, network, ` +
        'note, preset and archive cursor it holds.',
      'Delete campaign',
    );
    if (!ok) return;
    setCampaignBusy(true);
    try {
      await window.api.xListening.campaignsDelete(activeCampaign.id);
      setActiveCampaignId('');
      await loadCampaigns();
      setNotice('Campaign deleted.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }, [activeCampaign, loadCampaigns]);

  // ── session actions ────────────────────────────────────────────────────────
  const handleOpenSession = useCallback(async () => {
    if (!activeCampaignId) {
      setNotice('Create or select a campaign before opening a session.');
      return;
    }
    setSessionBusy(true);
    try {
      const res = await window.api.xListening.openSession(activeCampaignId);
      setNotice(res.blocked ? (res.reason ?? 'Session blocked.') : 'X session window opened.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionBusy(false);
      await refreshSession(activeCampaignId);
    }
  }, [activeCampaignId, refreshSession]);

  const handleCloseSession = useCallback(async () => {
    if (!activeCampaignId) return;
    setSessionBusy(true);
    try {
      await window.api.xListening.closeSession(activeCampaignId);
      setNotice('Session window closed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionBusy(false);
      await refreshSession(activeCampaignId);
    }
  }, [activeCampaignId, refreshSession]);

  // ── Tor / clearnet posture ─────────────────────────────────────────────────
  const setClearnet = useCallback(
    async (next: boolean) => {
      const x = xListeningSettings;
      if (!x) return;
      if (next && !clearnetAck) {
        const ok = await confirmDialog(CLEARNET_WARNING_TEXT, 'Enable clearnet capture');
        if (!ok) return;
        await patchSettings({ xListening: { ...x, clearnet: true, clearnetAck: true } });
        return;
      }
      await patchSettings({ xListening: { ...x, clearnet: next } });
    },
    [xListeningSettings, clearnetAck, patchSettings],
  );

  return (
    <div className="xls-root">
      <header className="xls-dock">
        <div className="xls-dock-row">
          <span className="xls-dock-label">CAMPAIGN</span>
          <select
            className="xls-input xls-dock-select"
            aria-label="Active campaign"
            value={activeCampaignId}
            onChange={(e) => void handleSwitchCampaign(e.target.value)}
            disabled={campaignBusy || campaigns.length === 0}
          >
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="xls-btn xls-btn-primary"
            onClick={() => void handleNewCampaign()}
            disabled={campaignBusy}
          >
            New Campaign
          </button>
          <button
            className="xls-btn"
            onClick={() => void handleRenameCampaign()}
            disabled={campaignBusy || !activeCampaign}
          >
            Rename
          </button>
          <button
            className="xls-btn xls-btn-danger"
            onClick={() => void handleDeleteCampaign()}
            disabled={campaignBusy || !activeCampaign}
          >
            Delete
          </button>
        </div>
        {caseId && (
          <div className="xls-dock-note">
            Opened from investigation case {caseId} (label only — this campaign is self-managed
            and works with no case bound).
          </div>
        )}
      </header>

      <div className="xls-session-bar">
        <span className={`xls-status-dot${sessionConnected ? ' xls-online' : ''}`} aria-hidden="true" />
        <div className="xls-session-label">
          <strong>{sessionConnected ? 'X SESSION ONLINE' : 'X SESSION OFFLINE'}</strong>
          <small>
            {sessionWindowOpen ? 'Capture window open' : 'No capture window open'} for this campaign
          </small>
        </div>
        <div className="xls-session-spacer" />
        <div className="xls-markers">
          <span className={`xls-marker${clearnet ? ' xls-marker-clearnet' : ' xls-marker-tor'}`}>
            {clearnet ? 'CLEARNET' : 'TOR'}
          </span>
          {demoActive && <span className="xls-marker xls-marker-demo">DEMO DATA LOADED</span>}
        </div>
        <button
          className="xls-btn"
          onClick={() => void handleCloseSession()}
          disabled={sessionBusy || !sessionWindowOpen}
        >
          Close Session
        </button>
        <button
          className="xls-btn xls-btn-primary"
          onClick={() => void handleOpenSession()}
          disabled={sessionBusy || !activeCampaignId}
        >
          {sessionBusy ? 'Working…' : 'Open Session'}
        </button>
      </div>

      <div className="xls-network-posture">
        <label className="xls-check">
          <input
            type="checkbox"
            checked={clearnet}
            onChange={(e) => void setClearnet(e.target.checked)}
            disabled={!xListeningSettings}
          />
          Route over CLEARNET instead of Tor (exposes your real IP to X)
        </label>
        <p className="xls-help">
          {clearnet
            ? 'Clearnet mode is ON — capture uses your real IP, not Tor.'
            : 'Tor mode (default) — capture fails closed when background Tor is not bootstrapped; there is no clearnet fallback.'}
        </p>
      </div>

      <div className="xls-notice" role="status">
        {notice}
      </div>

      <main className="xls-body">
        <div className="xls-empty">
          Dashboard / live / sources / network / entities / changes / search / notes / exports /
          campaigns / system tabs land in the next build pass.
        </div>
      </main>
    </div>
  );
}
