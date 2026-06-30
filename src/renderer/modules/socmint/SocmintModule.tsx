/**
 * SOCMINT Module — Telegram + WhatsApp public/group monitor.
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
 * - WhatsApp: channelLabel/authorHandle are attacker-controlled — textContent only; no anchor
 *   built from url (WhatsApp has no public permalink; url === '' → safeHref → null → no <a>).
 * - WhatsApp pairing code is an internal 8-char string rendered in a <code> element only —
 *   never as a hyperlink or injected into innerHTML.
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
 *
 * WhatsApp-specific smoke checklist (WA-T8):
 * 13. Platform selector: [Telegram] [WhatsApp] tabs visible above the case body.
 * 14. Select WhatsApp → participation-deanon warning banner appears immediately (before
 *     any configuration fields are shown). Warning is NOT dismissible.
 * 15. When settings.socmint.transport==='tor', Tor advisory box appears below the warning.
 * 16. WhatsApp Setup section: "Burner ID" and "Phone" inputs present. Empty inputs →
 *     "Request Pairing Code" button disabled.
 * 17. Click "Request Pairing Code" with gate closed → result shows "{disabled:true}" note.
 * 18. Click "Request Pairing Code" with gate open → sealed lib error surfaced in UI
 *     (not a crash; no silent clearnet fallback).
 * 19. When a burner is linked: "Burner linked" status shows; "Unlink Burner" button visible.
 * 20. "Unlink Burner" → calls unlinkWhatsappBurner; reminds user to manually unlink
 *     in WhatsApp → Linked Devices (reminder shown as text, never as a link).
 * 21. WhatsApp channel input: entering a channelId that does NOT end with "@g.us" →
 *     validation error shown; "Add Channel" button disabled.
 * 22. Entering a valid "<digits>@g.us" → validation passes; "Add Channel" enabled.
 * 23. Inspect DOM: pairing code shown in <code> element only, never as an <a> element.
 * 24. Inspect DOM: no wa.me or WhatsApp deep-link anchors appear anywhere.
 * 25. Switch back to Telegram → deanon warning and Tor advisory disappear.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HarvestedItem, MonitoredChannel, SocmintPlatform } from '@shared/socmint/types';
import { useSettings } from '../../state/store';
import { safeHref } from './safe-href';
import {
  buildStartMonitorRequest,
  canStartMonitor,
  describeMonitorResult,
  type StartMonitorResult,
} from './start-monitor-request';
import './socmint.css';

// ---------------------------------------------------------------------------
// WhatsApp deanon warning (§5.1 — blocking, non-suppressible, per-session)
// ---------------------------------------------------------------------------

/**
 * Per-session participation / de-anonymisation warning.
 * Must be shown whenever the WhatsApp platform is active and BEFORE any group
 * configuration fields are rendered.  Per §5.1 this is NOT permanently suppressible.
 */
function WhatsAppDeanonWarning(): JSX.Element {
  return (
    <div className="sm-wa-warning" role="alert" aria-live="assertive">
      <strong className="sm-wa-warning-title">
        Participation / De-anonymisation Risk — read before configuring groups
      </strong>
      <p className="sm-wa-warning-body">
        The burner phone number is permanently and immediately visible to every member and
        administrator of every group it joins. Administrators receive join notifications and
        can screenshot the member list at any time. This information traces to the SIM purchase
        event; any attributable linkage — CCTV, retail record, registration data, or VoIP
        account reuse — de-anonymises the burner to its physical origin. The operational
        posture is infiltration, not passive surveillance. This risk cannot be mitigated by
        routing choice or library configuration.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp Tor advisory (§3 — shown when transport==='tor')
// ---------------------------------------------------------------------------

function WhatsAppTorAdvisory(): JSX.Element {
  return (
    <div className="sm-wa-tor-advisory" role="note">
      <strong>Tor transport advisory:</strong>{' '}
      Tor is supported for WhatsApp but increases ban risk and connection instability.
      WhatsApp aggressively flags datacenter exit IPs on long-lived WebSockets.
      The connection will fail rather than fall back to clearnet — the burner&#39;s clearnet
      IP is never exposed. Clearnet transport is recommended for WhatsApp sessions.
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp Setup panel — linking ceremony (§2.8)
// ---------------------------------------------------------------------------

interface WhatsAppSetupPanelProps {
  networkEnabled: boolean;
}

function WhatsAppSetupPanel({ networkEnabled }: WhatsAppSetupPanelProps): JSX.Element {
  const [burnerId, setBurnerId] = useState('');
  const [phone, setPhone] = useState('');
  // pairingCode is a short code returned by WA — render as <code> text, never as an anchor.
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [burnerLinked, setBurnerLinked] = useState<boolean | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Check burner status whenever burnerId changes (and is non-empty).
  useEffect(() => {
    if (!burnerId.trim()) {
      setBurnerLinked(null);
      return;
    }
    let cancelled = false;
    void window.api.socmint.hasWhatsappBurner(burnerId.trim()).then((v) => {
      if (!cancelled) setBurnerLinked(v as boolean);
    }).catch(() => { /* ignore — stubs throw sealed msg before WA-T10 */ });
    return () => { cancelled = true; };
  }, [burnerId]);

  const handleRequestPairingCode = useCallback(async () => {
    const id = burnerId.trim();
    const ph = phone.trim().replace(/\s/g, '');
    if (!id || !ph) return;
    setLinking(true);
    setLinkError(null);
    setPairingCode(null);
    try {
      const result = await window.api.socmint.setWhatsappBurnerPairingCode(id, ph) as
        { disabled: true } | { pairingCode: string };
      if ('disabled' in result && result.disabled) {
        setLinkError('SOCMINT network gate is closed — enable it in Settings to link a burner.');
      } else if ('pairingCode' in result) {
        // pairingCode is a short WA-generated code: display as <code> text only.
        setPairingCode(result.pairingCode);
      }
    } catch (err: unknown) {
      // Before WA-T10 / unseal: the sealed handler throws a string message.
      // Surface it as an error rather than crashing or falling back silently.
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }, [burnerId, phone]);

  const handleUnlink = useCallback(async () => {
    const id = burnerId.trim();
    if (!id) return;
    setUnlinking(true);
    try {
      await window.api.socmint.unlinkWhatsappBurner(id);
      setBurnerLinked(false);
      setPairingCode(null);
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinking(false);
    }
  }, [burnerId]);

  const phoneIsDigits = phone.trim().length > 0 &&
    [...phone.trim().replace(/\s/g, '')].every((c) => c >= '0' && c <= '9');
  const canRequest = !!burnerId.trim() && phoneIsDigits && !linking;

  return (
    <section className="sm-section">
      <h3 className="sm-section-title">WhatsApp Burner — Linking Ceremony</h3>

      <div className="sm-form-row">
        <label htmlFor="sm-wa-burner-id" className="sm-label">Burner ID</label>
        <input
          id="sm-wa-burner-id"
          className="sm-input"
          value={burnerId}
          onChange={(e) => {
            setBurnerId(e.target.value);
            setPairingCode(null);
            setLinkError(null);
          }}
          placeholder="e.g. wa-burner-1"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="sm-form-row">
        <label htmlFor="sm-wa-phone" className="sm-label">Phone (digits only, no +)</label>
        <input
          id="sm-wa-phone"
          className="sm-input"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPairingCode(null);
            setLinkError(null);
          }}
          placeholder="447700900000"
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
        />
      </div>
      {phone.trim().length > 0 && !phoneIsDigits && (
        <p className="sm-wa-field-error">Phone must contain digits only (no +, spaces, or dashes).</p>
      )}

      {burnerLinked === true && (
        <div className="sm-wa-linked-status">
          <span className="sm-wa-linked-badge">Burner linked</span>
          <button
            className="sm-btn sm-btn-danger"
            onClick={() => void handleUnlink()}
            disabled={unlinking}
          >
            {unlinking ? 'Unlinking…' : 'Unlink Burner'}
          </button>
        </div>
      )}
      {burnerLinked === false && (
        <p className="sm-note">No credentials stored for this burner ID.</p>
      )}

      {!networkEnabled && (
        <p className="sm-note sm-wa-gate-note">
          SOCMINT network is disabled — enable it in Settings before linking a burner.
        </p>
      )}

      <button
        className="sm-btn sm-btn-primary"
        onClick={() => void handleRequestPairingCode()}
        disabled={!canRequest || !networkEnabled}
        title={
          !networkEnabled
            ? 'Enable SOCMINT network in Settings first'
            : !burnerId.trim()
            ? 'Enter a Burner ID'
            : !phoneIsDigits
            ? 'Enter a valid phone number (digits only)'
            : undefined
        }
      >
        {linking ? 'Requesting…' : 'Request Pairing Code'}
      </button>

      {pairingCode !== null && (
        <div className="sm-wa-pairing-result">
          <p className="sm-wa-pairing-label">
            Enter this code in WhatsApp on your burner phone:
            WhatsApp &rsaquo; Linked Devices &rsaquo; Link a Device &rsaquo; Pair with phone number
          </p>
          {/* Pairing code is a WA-internal short code — rendered as <code> text only,
              never as an anchor or injected into innerHTML. */}
          <code className="sm-wa-pairing-code">{pairingCode}</code>
          <p className="sm-note">
            The code expires in a few minutes. If linking completes successfully, the session
            is persisted to encrypted storage automatically.
          </p>
        </div>
      )}

      {linkError !== null && (
        <div className="sm-wa-error" role="alert">
          {/* linkError is a thrown Error message from main-process handler — textContent only. */}
          <strong>Error:</strong> {linkError}
        </div>
      )}

      {burnerLinked === true && (
        <p className="sm-wa-unlink-note">
          Unlinking removes stored credentials from this app only. To fully revoke access,
          also unlink the device in WhatsApp on your burner phone: WhatsApp &rsaquo;
          Linked Devices &rsaquo; select this device &rsaquo; Log out.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ChannelsPanel — extended for platform-specific validation
// ---------------------------------------------------------------------------

interface ChannelsPanelProps {
  platform: SocmintPlatform;
  caseId: string;
  channels: MonitoredChannel[];
  newChannelId: string;
  newChannelLabel: string;
  newChannelKeywords: string;
  networkEnabled: boolean;
  activeJobId: string | null;
  monitoring: boolean;
  burnerId: string;
  monitorMessage: string;
  onChangeNewChannelId(v: string): void;
  onChangeNewChannelLabel(v: string): void;
  onChangeNewChannelKeywords(v: string): void;
  onChangeBurnerId(v: string): void;
  onAddChannel(): void;
  onRemoveChannel(channelId: string): void;
  onStartMonitor(): void;
  onStopMonitor(): void;
}

function ChannelsPanel({
  platform,
  caseId,
  channels,
  newChannelId,
  newChannelLabel,
  newChannelKeywords,
  networkEnabled,
  activeJobId,
  monitoring,
  burnerId,
  monitorMessage,
  onChangeNewChannelId,
  onChangeNewChannelLabel,
  onChangeNewChannelKeywords,
  onChangeBurnerId,
  onAddChannel,
  onRemoveChannel,
  onStartMonitor,
  onStopMonitor,
}: ChannelsPanelProps): JSX.Element {
  // @g.us guard: for WhatsApp, group JIDs must end with @g.us.
  // The guard uses a hardcoded literal string check — never new RegExp() on user input.
  const isWhatsApp = platform === 'whatsapp';
  const channelIdTrimmed = newChannelId.trim();
  const waJidInvalid = isWhatsApp && channelIdTrimmed.length > 0 &&
    !channelIdTrimmed.endsWith('@g.us');
  const canAdd = channelIdTrimmed.length > 0 && !waJidInvalid;

  return (
    <div className="sm-channels">
      {/* Add channel form */}
      <section className="sm-section">
        <h3 className="sm-section-title">Add Monitored{isWhatsApp ? ' Group' : ' Channel'}</h3>
        <div className="sm-form-row">
          <label htmlFor="sm-ch-id" className="sm-label">
            {isWhatsApp ? 'Group JID (@g.us format)' : 'Channel ID / @username'}
          </label>
          <input
            id="sm-ch-id"
            className="sm-input"
            value={newChannelId}
            onChange={(e) => onChangeNewChannelId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAddChannel(); }}
            placeholder={isWhatsApp ? '1234567890-1234567@g.us' : '-100123456789 or @channelname'}
          />
        </div>
        {/* @g.us guard: show validation error on invalid WhatsApp JID */}
        {waJidInvalid && (
          <p className="sm-wa-field-error">
            WhatsApp group JIDs must end with <code>@g.us</code>.
            DMs (<code>@s.whatsapp.net</code>) and broadcast lists are not monitored.
          </p>
        )}
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
          disabled={!canAdd}
          title={waJidInvalid ? 'Group JID must end with @g.us' : undefined}
        >
          Add {isWhatsApp ? 'Group' : 'Channel'}
        </button>
      </section>

      {/* Channel / group list */}
      <section className="sm-section">
        <h3 className="sm-section-title">
          Monitored {isWhatsApp ? 'Groups' : 'Channels'} ({channels.length})
        </h3>
        {channels.length === 0 ? (
          <p className="sm-empty">
            No {isWhatsApp ? 'groups' : 'channels'} monitored. Add one above.
          </p>
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
            {/* Burner identity — REQUIRED by the backend. Must match the burner ID
                configured in Settings → SOCMINT (Telegram) or the WA Setup tab. */}
            <div className="sm-form-row">
              <label htmlFor="sm-burner-id" className="sm-label">Burner ID</label>
              <input
                id="sm-burner-id"
                className="sm-input"
                value={burnerId}
                onChange={(e) => onChangeBurnerId(e.target.value)}
                placeholder={isWhatsApp ? 'burner from WA Setup' : 'burner from Settings → SOCMINT'}
              />
            </div>
            <button
              className="sm-btn sm-btn-primary"
              onClick={onStartMonitor}
              disabled={!canStartMonitor({
                networkEnabled, monitoring, caseId, burnerId, channelCount: channels.length,
              })}
              title={
                !networkEnabled
                  ? 'Enable SOCMINT network in Settings to start monitoring'
                  : channels.length === 0
                  ? `Add at least one ${isWhatsApp ? 'group' : 'channel'} before starting`
                  : !burnerId.trim()
                  ? `Enter the burner ID you configured in ${isWhatsApp ? 'WA Setup' : 'Settings → SOCMINT'}`
                  : undefined
              }
            >
              {monitoring ? 'Starting…' : 'Start Monitor'}
            </button>
            {!networkEnabled && (
              <p className="sm-note">Network disabled — enable in Settings → SOCMINT.</p>
            )}
            {/* Surface the last attempt's failure (noChannels / disabled / error)
                instead of swallowing it. XSS-safe: rendered as a text child. */}
            {monitorMessage !== '' && (
              <p className="sm-monitor-error" role="alert">{monitorMessage}</p>
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
  // WhatsApp items always have url==='' (no public permalink) → safeHref → null → no anchor.
  const href = safeHref(item.url);

  return (
    <li className="sm-item">
      <div className="sm-item-header">
        {/* All text values rendered as React text children — no dangerouslySetInnerHTML. */}
        <span className="sm-item-author">{item.authorHandle}</span>
        <span className="sm-item-channel">{item.channelLabel}</span>
        <span className="sm-item-time">{item.publishedAt}</span>
        {item.platform === 'whatsapp' && (
          <span className="sm-item-platform-badge">WhatsApp</span>
        )}
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
          /* Non-http(s) URL or empty string: render as plain text, no anchor element.
             WhatsApp items always fall here (url === ''). */
          item.url ? (
            <span className="sm-item-link-plain">{item.url}</span>
          ) : null
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

type ContentTab = 'channels' | 'items' | 'wa-setup';

export function SocmintModule({ caseId: propCaseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  // Read defensively: settings may be null on first render, socmint block may be absent on
  // a legacy settings object loaded before this field was added.
  const networkEnabled = settings?.socmint?.networkEnabled ?? false;
  const transport = settings?.socmint?.transport ?? 'direct';

  // Platform selector — Telegram (existing v1) or WhatsApp (new).
  const [platform, setPlatform] = useState<SocmintPlatform>('telegram');

  // Active tab: 'channels' / 'items' are shared; 'wa-setup' is WhatsApp-only.
  const [tab, setTab] = useState<ContentTab>('channels');

  // When platform switches away from WhatsApp, drop the wa-setup tab if active.
  useEffect(() => {
    if (platform !== 'whatsapp' && tab === 'wa-setup') {
      setTab('channels');
    }
  }, [platform, tab]);

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
  // Burner identity to run the monitor under (configured in Settings → SOCMINT for
  // Telegram, or the WA Setup tab for WhatsApp). REQUIRED by handleStartMonitor —
  // without it the backend throws and the button does nothing.
  const [burnerId, setBurnerId] = useState('');
  // Visible outcome of the last Start Monitor attempt (noChannels / disabled / error).
  // Surfacing this is the fix for the previously-swallowed startMonitor failure.
  const [monitorMessage, setMonitorMessage] = useState('');

  const loadChannels = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await window.api.socmint.listChannels(caseId);
      setChannels(result as MonitoredChannel[]);
    } catch (err) {
      console.warn('[SOCMINT] listChannels:', err);
    }
  }, [caseId]);

  const loadItems = useCallback(async () => {
    if (!caseId) return;
    try {
      const result = await window.api.socmint.listItems(caseId);
      setItems(result as HarvestedItem[]);
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
    // @g.us guard: for WhatsApp, reject non-group JIDs before IPC call.
    if (platform === 'whatsapp' && !newChannelId.trim().endsWith('@g.us')) return;
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
      setChannels(updated as MonitoredChannel[]);
      setNewChannelId('');
      setNewChannelLabel('');
      setNewChannelKeywords('');
    } catch (err) {
      console.warn('[SOCMINT] addChannel:', err);
    }
  }, [caseId, newChannelId, newChannelLabel, newChannelKeywords, platform]);

  const handleRemoveChannel = useCallback(async (channelId: string) => {
    if (!caseId) return;
    try {
      const updated = await window.api.socmint.removeChannel(caseId, channelId);
      setChannels(updated as MonitoredChannel[]);
    } catch (err) {
      console.warn('[SOCMINT] removeChannel:', err);
    }
  }, [caseId]);

  const handleRankItems = useCallback(async () => {
    if (!caseId || !rankKeyword.trim()) return;
    setRanking(true);
    try {
      const ranked = await window.api.socmint.rankItems(caseId, rankKeyword.trim());
      setItems(ranked as HarvestedItem[]);
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
    if (!canStartMonitor({
      networkEnabled, monitoring, caseId, burnerId, channelCount: channels.length,
    })) return;
    setMonitoring(true);
    setMonitorMessage('');
    try {
      // Send the FULL payload: burnerId + channelIds + platform. Omitting any of
      // these is what made Start Monitor a dead button before v3.24.2.
      const req = buildStartMonitorRequest({ caseId, burnerId, channels, platform });
      const result = await window.api.socmint.startMonitor(req) as StartMonitorResult;
      const outcome = describeMonitorResult(result);
      if (outcome.kind === 'started' && outcome.jobId) {
        setActiveJobId(outcome.jobId);
      } else {
        // noChannels / disabled / unexpected — show it instead of swallowing it.
        setMonitorMessage(outcome.message);
      }
    } catch (err) {
      // A thrown error reaches the operator as a fixed, actionable sentence — NOT
      // the raw err.message, which can embed burner IDs / channel IDs / local paths
      // (kept off-screen per the "don't become interesting" posture). The full
      // error still goes to the dev console for debugging.
      console.warn('[SOCMINT] startMonitor:', err);
      const raw = err instanceof Error ? err.message : String(err);
      setMonitorMessage(
        /tor/i.test(raw)
          ? 'Monitoring did not start — Tor is the selected transport but is not connected. Connect Tor (or switch to Direct) in Settings → SOCMINT.'
          : 'Monitoring did not start — check that the Burner ID matches one you set up and that the channels are reachable.',
      );
    } finally {
      setMonitoring(false);
    }
  }, [caseId, networkEnabled, monitoring, burnerId, channels, platform]);

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

      {/* Platform selector — above the case body, always visible once a case is loaded. */}
      <div className="sm-platform-bar" role="group" aria-label="Platform">
        <button
          className={`sm-platform-btn${platform === 'telegram' ? ' sm-platform-active' : ''}`}
          onClick={() => setPlatform('telegram')}
          aria-pressed={platform === 'telegram'}
        >
          Telegram
        </button>
        <button
          className={`sm-platform-btn${platform === 'whatsapp' ? ' sm-platform-active' : ''}`}
          onClick={() => setPlatform('whatsapp')}
          aria-pressed={platform === 'whatsapp'}
        >
          WhatsApp
        </button>
      </div>

      {/* WhatsApp-specific banners — shown BEFORE any config fields (§5.1). */}
      {platform === 'whatsapp' && <WhatsAppDeanonWarning />}
      {platform === 'whatsapp' && transport === 'tor' && <WhatsAppTorAdvisory />}

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
              {platform === 'whatsapp' ? 'Groups' : 'Channels'}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'items'}
              className={`sm-tab${tab === 'items' ? ' sm-tab-active' : ''}`}
              onClick={() => { setTab('items'); void loadItems(); }}
            >
              Harvested Items
            </button>
            {platform === 'whatsapp' && (
              <button
                role="tab"
                aria-selected={tab === 'wa-setup'}
                className={`sm-tab${tab === 'wa-setup' ? ' sm-tab-active' : ''}`}
                onClick={() => setTab('wa-setup')}
              >
                WA Setup
              </button>
            )}
          </div>

          <div className="sm-body">
            {tab === 'channels' && (
              <ChannelsPanel
                platform={platform}
                caseId={caseId}
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
                burnerId={burnerId}
                onChangeBurnerId={setBurnerId}
                monitorMessage={monitorMessage}
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
            {tab === 'wa-setup' && platform === 'whatsapp' && (
              <WhatsAppSetupPanel networkEnabled={networkEnabled} />
            )}
          </div>
        </>
      ) : (
        <div className="sm-placeholder">Enter a case ID above to load SOCMINT data.</div>
      )}
    </div>
  );
}
