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

import { useMemo, useState } from 'react';
import type { GeoItem } from '@shared/post-mvp-types';
import { resolveEventFields, deriveTags, relatedEvents, sourceLabel } from './event-details';
import { corroboratingItems } from './corroborate';

export interface EventDetailsPanelProps {
  /** The selected incident. `null` → the panel renders nothing (grid reflows to 3-col upstream). */
  item: GeoItem | null;
  /** Full in-scope item set the corroboration/related selectors run against (already-fetched, no egress). */
  allItems: GeoItem[];
  /** sourceId → human label resolution for the Sources list (never invented; falls back to the raw id). */
  sources: { id: string; label: string }[];
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
  { key: 'sources', label: 'SOURCES', live: true },
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
  const allItems = props.allItems ?? [];
  const sources = props.sources ?? [];
  const [activeTab, setActiveTab] = useState<'overview' | 'sources'>('overview');
  const [srcFilter, setSrcFilter] = useState<'all' | 'this' | 'other'>('all');

  // Corroboration = the OTHER items co-located with this event in space (and, when both dated, time).
  // Uses the same radius/window defaults as the map halo. NOTE: the halo caps its distinct-source count
  // at SRC_CAP (16) for perf; this dossier shows the TRUE, uncapped distinct-source count, so for a very
  // dense cluster (>16 co-located feeds) the tab may read higher than the halo — intentional (a details
  // panel should show the real number). Pure/deterministic (Task 1).
  const corr = useMemo(() => (item ? corroboratingItems(item, allItems) : []), [item, allItems]);
  // N = distinct OTHER sourceIds among the corroborating items (this event's own source is not a "source").
  const distinctOther = useMemo(
    () => (item ? new Set(corr.filter((c) => c.item.sourceId !== item.sourceId).map((c) => c.item.sourceId)).size : 0),
    [corr, item]
  );
  // Related-in-region excludes the corroboration set (related ≠ duplicate of the same event). Task 2.
  const related = useMemo(
    () => (item ? relatedEvents(item, allItems, new Set(corr.map((c) => c.item.id))) : []),
    [item, allItems, corr]
  );

  if (!item) return null;

  // One row per distinct OTHER feed (nearest report; `corr` is sorted nearest-first) so the visible
  // "Other feeds" list length equals the SOURCES (N) header — no silent header-vs-rowcount divergence.
  // Same-source items (this event's own feed reporting again) are kept separate under "This source".
  const seenOther = new Set<string>();
  const otherBySource = corr.filter((c) => {
    if (c.item.sourceId === item.sourceId || seenOther.has(c.item.sourceId)) return false;
    seenOther.add(c.item.sourceId);
    return true;
  });
  const sameSource = corr.filter((c) => c.item.sourceId === item.sourceId);
  const shownCorr =
    srcFilter === 'this' ? sameSource : srcFilter === 'other' ? otherBySource : [...otherBySource, ...sameSource];

  const { eventType, detail, severityLabel, confidenceLabel, badgeColor, badgeLabel } = resolveEventFields(item);
  const tags = deriveTags(item);
  const href = safeHref(item.link);
  const absDate = formatAbsolute(item.published);
  const hasCoords = Number.isFinite(item.lat) && Number.isFinite(item.lon);

  return (
    <div className="ga98-pane ga98-geo-details" style={panelStyle}>
      {/* Tab bar — OVERVIEW live, the rest disabled/"coming soon" (Phases 2-3, no fabricated data). */}
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map((t) => {
          const active = t.live && activeTab === t.key;
          return (
            <button
              key={t.key}
              disabled={!t.live}
              aria-pressed={active}
              onClick={t.live ? () => setActiveTab(t.key as 'overview' | 'sources') : undefined}
              title={t.live ? undefined : 'Coming soon'}
              style={{
                fontSize: 10, fontWeight: 'bold', letterSpacing: 0.4, padding: '3px 8px',
                background: t.live ? (active ? '#1b2230' : '#141a26') : '#11161f',
                color: t.live ? '#e6edf6' : '#4a5468',
                border: '1px solid #2a3344',
                borderBottomColor: active ? '#5a7fb0' : '#2a3344',
                cursor: t.live ? 'pointer' : 'not-allowed'
              }}
            >
              {t.label}{t.live ? '' : ' · soon'}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close details"
          aria-label="Close details"
          style={{ fontSize: 12, fontWeight: 'bold', color: '#cdd6e4', background: '#1b2230', border: '1px solid #2a3344', padding: '2px 8px', cursor: 'pointer', lineHeight: 1.2 }}
        >×</button>
      </div>

      {activeTab === 'overview' && (<>
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
      </>)}

      {activeTab === 'sources' && (<>
      {/* SOURCES: the OTHER feeds reporting THIS event — factual corroboration, no authority tiers.
          Each row is the source's real label/time/distance; a chatter-category item keeps its explicit
          "unverified social-OSINT" stamp. External opens go only through the safe onOpenLink path. */}
      <div style={sectionStyle}>
        <div style={legendStyle}>SOURCES ({distinctOther})</div>
        <div style={{ display: 'flex', gap: 4, margin: '0 0 6px', flexWrap: 'wrap' }}>
          {([['all', 'All'], ['this', 'This source'], ['other', 'Other feeds']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSrcFilter(key)}
              aria-pressed={srcFilter === key}
              style={{
                fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                background: srcFilter === key ? '#1b2230' : '#11161f',
                color: '#cdd6e4', border: '1px solid #2a3344',
                borderBottomColor: srcFilter === key ? '#5a7fb0' : '#2a3344'
              }}
            >{label}</button>
          ))}
        </div>
        {shownCorr.length === 0 ? (
          <p style={noteStyle}>{srcFilter === 'this' ? 'No additional reports from this source.' : 'No other feeds reporting this event.'}</p>
        ) : shownCorr.map((c) => {
          const rowHref = safeHref(c.item.link);
          return (
            <div key={c.item.id} style={{ borderTop: '1px solid #1c2330', padding: '6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 'bold', color: '#e6edf6', wordBreak: 'break-word' }}>{sourceLabel(c.item.sourceId, sources)}</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => rowHref && onOpenLink(c.item.link!)}
                  disabled={!rowHref}
                  title={rowHref ? 'Open this source externally' : 'No source link'}
                  style={{ fontSize: 11, padding: '2px 8px', cursor: rowHref ? 'pointer' : 'not-allowed' }}
                >Open</button>
              </div>
              <div style={{ fontSize: 10, color: '#8a96a8' }}>{formatAbsolute(c.item.published) || 'undated'} · {c.distanceKm.toFixed(1)} km</div>
              {c.item.category === 'chatter' && <p style={noteStyle}>⚠ unverified social-OSINT</p>}
            </div>
          );
        })}
        <p style={noteStyle}>Other feeds reporting the same place/time — shown as-is. Not a verification; provenance is each feed's own.</p>
      </div>

      {/* RELATED IN REGION: same-country, same-relation-key events near in time — distinct from the
          same-event corroboration set above (related ≠ duplicate). */}
      <div style={sectionStyle}>
        <div style={legendStyle}>Related in Region</div>
        {related.length === 0 ? (
          <p style={noteStyle}>No related events in this region.</p>
        ) : related.map((r) => {
          const rHref = safeHref(r.link);
          return (
            <div key={r.id} style={{ borderTop: '1px solid #1c2330', padding: '6px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#e6edf6', wordBreak: 'break-word' }}>{r.title}</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => rHref && onOpenLink(r.link!)}
                  disabled={!rHref}
                  title={rHref ? 'Open this event externally' : 'No source link'}
                  style={{ fontSize: 11, padding: '2px 8px', cursor: rHref ? 'pointer' : 'not-allowed' }}
                >Open</button>
              </div>
              <div style={{ fontSize: 10, color: '#8a96a8' }}>{sourceLabel(r.sourceId, sources)} · {formatAbsolute(r.published) || 'undated'}</div>
              {r.category === 'chatter' && <p style={noteStyle}>⚠ unverified social-OSINT</p>}
            </div>
          );
        })}
      </div>
      </>)}
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
