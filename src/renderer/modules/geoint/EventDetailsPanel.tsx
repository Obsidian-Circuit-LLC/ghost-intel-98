/**
 * GeoINT Event Details dossier panel (Phase 1 — Overview tab).
 *
 * A presentational 4th-column panel that opens when a GeoINT incident is selected. It renders the
 * Overview dossier from real, already-fetched data via the pure helpers resolveEventFields/deriveTags
 * (event-details.ts). It owns NO state — GeoIntModuleInner owns the selected event and passes it +
 * the handlers down, mirroring the CommandRail convention.
 *
 * HONESTY CONSTRAINTS (charter):
 * - No fabrication. Every field is a transparent derivation of the item's OWN real data. Casualties /
 *   "verified" status are NOT synthesized (those are Phase 3, quoted-only). The war-tracker source and
 *   its raw `confidence` are surfaced AS-IS — never laundered into apparent authority.
 * - The MEDIA / SOURCES / INTEL SUMMARY tabs are shown DISABLED ("coming soon"). They are Phases 2-3
 *   and are deliberately NOT populated with any data here.
 * - No new egress, no new dependency. External opens go through the caller's existing safe-open path
 *   (`onOpenLink`); nothing here fetches.
 * - XSS-safe: all untrusted feed content (title, detail, place, tags, source) is rendered as React
 *   text (never dangerouslySetInnerHTML), mirroring popup.ts. The canonical link is scheme-guarded to
 *   http(s) before it is offered as a clickable anchor.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { resolveEventFields, deriveTags } from './event-details';

export interface EventDetailsPanelProps {
  /** The selected incident. `null` → the panel renders nothing (grid reflows to 3-col upstream). */
  item: GeoItem | null;
  /** Close the panel (✕). */
  onClose: () => void;
  /** Open a link externally via the caller's existing safe-open path (system.openExternal). */
  onOpenLink: (link: string) => void;
  /** Pin/unpin this item to Monitored Situations (existing addMonitor/removeMonitor). */
  onPin: (id: string) => void;
  /** Whether this item is currently pinned to the monitor set. */
  pinned: boolean;
}

// Dark rail chrome, consistent with CommandRail's railPanelStyle family.
const panelStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, maxWidth: 360, height: '100%',
  overflowY: 'auto', overflowX: 'hidden',
  background: '#0a0f1a', color: '#cdd6e4', padding: '8px 12px 12px 12px',
  boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8
};
const sectionStyle: React.CSSProperties = {
  background: '#11161f', border: '1px solid #2a3344', color: '#cdd6e4', padding: 8
};
const legendStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5, textTransform: 'uppercase',
  color: '#8fb7e0', margin: '0 0 6px'
};
const noteStyle: React.CSSProperties = { fontSize: 10, color: '#6b7688', margin: '6px 0 0' };
const factLabelStyle: React.CSSProperties = { fontSize: 10, color: '#8a96a8', textTransform: 'uppercase', letterSpacing: 0.4 };
const factValueStyle: React.CSSProperties = { fontSize: 12, color: '#e6edf6', fontWeight: 'bold', wordBreak: 'break-word' };

// The Overview tab is the only live tab in Phase 1. The rest are shown as disabled affordances so the
// frame matches the mockup WITHOUT fabricating data (charter). Phase 2 = Sources; Phase 3 = Media/Intel.
const TABS: { key: string; label: string; live: boolean }[] = [
  { key: 'overview', label: 'OVERVIEW', live: true },
  { key: 'media', label: 'MEDIA', live: false },
  { key: 'sources', label: 'SOURCES', live: false },
  { key: 'intel', label: 'INTEL SUMMARY', live: false }
];

/** Absolute date, locale-formatted; '' when the item carries no parseable `published`. */
function formatAbsolute(published?: string): string {
  if (!published) return '';
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

/** http(s)-only guard so a javascript:/data: link is never offered as a clickable anchor. */
function safeHref(link?: string): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function EventDetailsPanel(props: EventDetailsPanelProps): JSX.Element | null {
  const { item, onClose, onOpenLink, onPin, pinned } = props;
  if (!item) return null;

  const { eventType, detail, severityLabel, confidenceLabel, badgeColor, badgeLabel } = resolveEventFields(item);
  const tags = deriveTags(item);
  const href = safeHref(item.link);
  const absDate = formatAbsolute(item.published);
  const hasCoords = Number.isFinite(item.lat) && Number.isFinite(item.lon);

  return (
    <div className="ga98-pane ga98-geo-details" style={panelStyle}>
      {/* Tab bar — OVERVIEW live, the rest disabled/"coming soon" (Phases 2-3, no fabricated data). */}
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            disabled={!t.live}
            aria-pressed={t.live}
            title={t.live ? undefined : 'Coming soon'}
            style={{
              fontSize: 10, fontWeight: 'bold', letterSpacing: 0.4, padding: '3px 8px',
              background: t.live ? '#1b2230' : '#11161f',
              color: t.live ? '#e6edf6' : '#4a5468',
              border: '1px solid #2a3344',
              borderBottomColor: t.live ? '#5a7fb0' : '#2a3344',
              cursor: t.live ? 'default' : 'not-allowed'
            }}
          >
            {t.label}{t.live ? '' : ' · soon'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close details"
          aria-label="Close details"
          style={{ fontSize: 12, fontWeight: 'bold', color: '#cdd6e4', background: '#1b2230', border: '1px solid #2a3344', padding: '2px 8px', cursor: 'pointer', lineHeight: 1.2 }}
        >×</button>
      </div>

      {/* Header: severity/type badge + headline. Badge color is a transparent function of severity. */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            background: badgeColor, color: '#0a0f1a', fontSize: 11, fontWeight: 'bold',
            padding: '2px 8px', borderRadius: 2, letterSpacing: 0.5, whiteSpace: 'nowrap'
          }}>{badgeLabel}</span>
          <span style={{ fontSize: 11, color: '#8a96a8' }}>{severityLabel}</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 'bold', color: '#e6edf6', lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ fontSize: 11, color: '#8a96a8', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {item.place && <span>Location: {item.place}{item.country ? ` (${item.country})` : ''}</span>}
          {!item.place && item.country && <span>Location: {item.country}</span>}
          {hasCoords && <span>Coords: {item.lat!.toFixed(4)}, {item.lon!.toFixed(4)}</span>}
          {absDate && <span>Date: {absDate}</span>}
          <span>Source: {item.sourceId}</span>
        </div>
      </div>

      {/* Actions: open-in-source / share / add-to-monitor. External open uses the caller's safe path. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => href && onOpenLink(item.link!)}
          disabled={!href}
          title={href ? 'Open the source post in the external browser' : 'No source link'}
          style={{ fontSize: 11, padding: '3px 10px', cursor: href ? 'pointer' : 'not-allowed' }}
        >Open</button>
        <button
          onClick={() => { void copyShare(item, href); }}
          title="Copy a plain-text reference (title + link) to the clipboard"
          style={{ fontSize: 11, padding: '3px 10px', cursor: 'pointer' }}
        >Share</button>
        <button
          onClick={() => onPin(item.id)}
          title={pinned ? 'Remove from Monitored Situations' : 'Add to Monitored Situations'}
          style={{ fontSize: 11, padding: '3px 10px', cursor: 'pointer', fontWeight: pinned ? 'bold' : 'normal' }}
        >{pinned ? 'Remove from Monitor' : 'Add to Monitor'}</button>
      </div>

      {/* Fact grid: Event Type / Confidence / Severity — real source values, surfaced as-is. */}
      <div style={sectionStyle}>
        <div style={legendStyle}>Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={factLabelStyle}>Event Type</div>
            <div style={factValueStyle}>{eventType || '—'}</div>
          </div>
          <div>
            <div style={factLabelStyle}>Confidence</div>
            <div style={factValueStyle}>{confidenceLabel || '—'}</div>
          </div>
          <div>
            <div style={factLabelStyle}>Severity</div>
            <div style={factValueStyle}>{severityLabel}</div>
          </div>
        </div>
        <p style={noteStyle}>Source-reported values, surfaced as-is. Confidence is the feed's own rating — not a verification.</p>
      </div>

      {/* Description: full body, XSS-safe (React text — mirrors popup.ts). */}
      {detail && (
        <div style={sectionStyle}>
          <div style={legendStyle}>Description</div>
          <div style={{ fontSize: 12, color: '#cdd6e4', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detail}</div>
        </div>
      )}

      {/* Tags: deterministic keyword chips derived locally from title + description + geography. */}
      {tags.length > 0 && (
        <div style={sectionStyle}>
          <div style={legendStyle}>Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map((t) => (
              <span key={t} style={{ fontSize: 10, color: '#8fb7e0', background: '#1b2230', border: '1px solid #2a3344', padding: '1px 6px', borderRadius: 2 }}>{t}</span>
            ))}
          </div>
          <p style={noteStyle}>Local keyword derivation from the headline + description — deterministic, offline.</p>
        </div>
      )}

      {/* Canonical link + id/provenance footer. Anchor is scheme-guarded and opened via onOpenLink. */}
      <div style={sectionStyle}>
        <div style={legendStyle}>Provenance</div>
        {href ? (
          <a
            href={href}
            onClick={(e) => { e.preventDefault(); onOpenLink(item.link!); }}
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#8fb7e0', wordBreak: 'break-all' }}
          >Open in source ↗</a>
        ) : (
          <span style={{ fontSize: 11, color: '#6b7688' }}>No source link.</span>
        )}
        <p style={noteStyle}>ID: {item.id} · Source: {item.sourceId}{absDate ? ` · Updated: ${absDate}` : ''}</p>
      </div>
    </div>
  );
}

/**
 * Copy a plain-text reference (title + canonical link) to the clipboard. Local-only (no egress);
 * silently no-ops when the Clipboard API is unavailable (e.g. jsdom / older webviews).
 */
async function copyShare(item: GeoItem, href: string | null): Promise<void> {
  const text = href ? `${item.title}\n${href}` : item.title;
  try {
    await navigator.clipboard?.writeText?.(text);
  } catch {
    /* clipboard unavailable / denied — a Share affordance is best-effort, not load-bearing */
  }
}
