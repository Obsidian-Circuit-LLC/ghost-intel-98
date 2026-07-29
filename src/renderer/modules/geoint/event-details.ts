import type { GeoItem } from '@shared/post-mvp-types';

/**
 * Event Details dossier — pure display + tag helpers (Phase 1).
 *
 * These back the Overview tab of the EventDetailsPanel. They are deliberately kept out of the
 * React component so every derivation is unit-testable without rendering.
 *
 * HONESTY (charter): nothing here fabricates. Each returned field is a transparent function of the
 * item's own real data (`severity`, `category`, `eventType`, `confidence`, `detail`/`summary`,
 * `place`/`country`). The raw source `confidence` is surfaced AS-IS — never rewritten into an
 * apparent-authority label. War-tracker keeps its low-authority `category:'chatter'`; the red /
 * SEVERE treatment is driven by the item's own `severity` + a military event-type/keyword signal,
 * so unverified war chatter reads as high-severity WITHOUT being mislabeled as verified conflict.
 *
 * The category color map and keyword vocabulary are re-declared here (small, stable copies of the
 * map's CATEGORY_COLOR and classify.ts vocab) rather than imported: importing MapGL.tsx would drag
 * Leaflet into a pure helper, and classify.ts lives under src/main (no renderer path alias). This
 * keeps event-details.ts a self-contained, dependency-free renderer module.
 */

/** Marker/badge fill by category — mirrors MapGL `CATEGORY_COLOR`. Neutral grey for unknown. */
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};
/** Neutral grey used when a category has no color (or no category at all). */
const NEUTRAL = '#7f8c8d';
/** High-severity badge color (== the conflict red). Used whenever `severity === 'high'`. */
const RED = CATEGORY_COLOR.conflict;

/** Human category label for the header/badge when the item carries no explicit `eventType`. */
const CATEGORY_LABEL: Record<string, string> = {
  conflict: 'Conflict', cyber: 'Cyber', protest: 'Protest', disaster: 'Disaster',
  crime: 'Crime', politics: 'Politics', chatter: 'Chatter'
};

function categoryLabel(category?: string): string {
  if (!category) return '';
  const known = CATEGORY_LABEL[category];
  if (known) return known;
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Military / kinetic-conflict signal used to lift a `severity:'high'` item to the SEVERE label even
 * when its `category` is the low-authority 'chatter' (war-tracker). This is a keyword test over the
 * item's OWN eventType/title/detail — it does NOT relabel the category, it only decides SEVERE-vs-HIGH
 * for the severity chip. Deterministic, literal substring match.
 */
const CONFLICT_HINTS = [
  'military', 'strike', 'airstrike', 'missile', 'shelling', 'drone', 'combat',
  'offensive', 'frontline', 'artillery', 'war', 'militant'
];

function isConflictish(item: GeoItem): boolean {
  if (item.category === 'conflict') return true;
  const text = `${item.eventType ?? ''} ${item.title} ${item.detail ?? ''}`.toLowerCase();
  return CONFLICT_HINTS.some((k) => text.includes(k));
}

export interface ResolvedEventFields {
  /** Display event type: explicit `eventType`, else a label derived from `category` (may be ''). */
  eventType: string;
  /** Full description body: `detail`, falling back to `summary`, else ''. */
  detail: string;
  /** Severity chip: LOW / MEDIUM / HIGH / SEVERE. SEVERE = high + a military/conflict signal. */
  severityLabel: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
  /** Raw source confidence, surfaced as-is (trimmed). '' when the source gave none. */
  confidenceLabel: string;
  /** Header/badge color: red for high severity, else the category color, else neutral grey. */
  badgeColor: string;
  /** Uppercased badge text: eventType, else category, else 'EVENT'. */
  badgeLabel: string;
}

/**
 * Resolve an item into the Overview header/fact-grid fields. Pure; no side effects. Every value is a
 * deterministic function of the item's real data (see the honesty note above).
 */
export function resolveEventFields(item: GeoItem): ResolvedEventFields {
  const eventType = item.eventType ?? categoryLabel(item.category);
  const detail = item.detail ?? item.summary ?? '';

  let severityLabel: ResolvedEventFields['severityLabel'];
  if (item.severity === 'high') severityLabel = isConflictish(item) ? 'SEVERE' : 'HIGH';
  else if (item.severity === 'medium') severityLabel = 'MEDIUM';
  else severityLabel = 'LOW';

  const badgeColor =
    item.severity === 'high' ? RED : (item.category ? CATEGORY_COLOR[item.category] ?? NEUTRAL : NEUTRAL);

  const badgeLabel = (eventType || item.category || 'EVENT').toUpperCase();
  const confidenceLabel = item.confidence?.trim() ?? '';

  return { eventType, detail, severityLabel, confidenceLabel, badgeColor, badgeLabel };
}

/**
 * Flat keyword vocabulary for tag derivation — the classify.ts category vocab plus a few generic
 * conflict/kinetic terms so a "Military Strike" surfaces 'military'/'strike' tags. Literal substring,
 * lowercase. Kept small and stable; re-declared rather than imported (classify.ts is main-side).
 */
const TAG_VOCAB: string[] = [
  // conflict
  'airstrike', 'shelling', 'offensive', 'troops', 'missile', 'ceasefire', 'frontline', 'casualties',
  'militant', 'military', 'strike', 'drone', 'artillery', 'war', 'combat',
  // cyber
  'ransomware', 'breach', 'malware', 'ddos', 'phishing', 'exploit', 'hacked', 'cyberattack',
  // protest
  'protest', 'demonstration', 'rally', 'unrest', 'riot', 'clashes',
  // disaster
  'earthquake', 'flood', 'wildfire', 'hurricane', 'tornado', 'eruption', 'landslide', 'evacuat',
  // crime
  'shooting', 'homicide', 'trafficking', 'kidnap', 'arrest', 'cartel', 'smuggling',
  // politics
  'election', 'sanction', 'parliament', 'minister', 'summit', 'treaty', 'coup'
];

/** Max tag chips shown on the Overview. */
const TAG_CAP = 8;

function pushTag(out: string[], seen: Set<string>, raw: string): void {
  const t = raw.trim().toLowerCase();
  if (t.length >= 2 && !seen.has(t)) { seen.add(t); out.push(t); }
}

/**
 * Derive up to {@link TAG_CAP} lowercase keyword tags for an item, deterministically, from its own
 * fields: the words of its `eventType`, its `category`, vocabulary terms occurring in title+detail,
 * and its `country`/`place`. Deduped, order-stable, capped. No fabrication — a tag only appears if
 * its source substring is present in the item.
 */
export function deriveTags(item: GeoItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // 1. Event-type words (e.g. "Military Strike" → 'military', 'strike').
  if (item.eventType) {
    for (const w of item.eventType.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3) pushTag(out, seen, w);
    }
  }

  // 2. The category itself (surfaces war-tracker 'chatter' provenance, RSS 'politics', etc.).
  if (item.category) pushTag(out, seen, item.category);

  // 3. Vocabulary terms present in the title + detail/summary body.
  const body = `${item.title} ${item.detail ?? item.summary ?? ''}`.toLowerCase();
  for (const k of TAG_VOCAB) {
    if (out.length >= TAG_CAP) break;
    if (body.includes(k)) pushTag(out, seen, k);
  }

  // 4. Geography: country then place.
  if (item.country) pushTag(out, seen, item.country);
  if (item.place) pushTag(out, seen, item.place);

  return out.slice(0, TAG_CAP);
}
