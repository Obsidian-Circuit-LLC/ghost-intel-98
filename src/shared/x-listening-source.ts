/**
 * Canonical key for an X source (a monitored @handle / channelId).
 *
 * Used on BOTH sides of the seam — the renderer's `sourceGroups` grouping (which draws one card
 * per source) and the main-side `removeSource` matcher (which cascade-deletes a source's evidence)
 * — so a card and its delete agree EXACTLY. Strips a leading `@`, trims, and lowercases (X handles
 * are case-insensitive), so `@DaveX`, `davex`, and ` DaveX ` collapse to one source.
 *
 * Without a shared canonicalization the two sides could disagree: if the renderer keyed cards by the
 * raw casing while `removeSource` matched case-insensitively, `@DaveX` and `@davex` would render as
 * two cards but removing either would delete BOTH cards' posts — silent evidence loss. This is the
 * one function both sides call.
 */
export function normalizeXSourceKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
}

/**
 * Format an X handle for DISPLAY: exactly one leading `@`, case preserved, and empty for an absent
 * handle (never a bare `@`). Idempotent, because handles arrive at the UI from several layers —
 * capture, analysis, store — some already carrying a `@` and some not. The COMMON FOLLOWERS pair
 * line rendered `@@ADanielHill` by prefixing a value that already had one (field report, v3.72.2).
 *
 * This is a display formatter, NOT a lookup key: `normalizeXSourceKey` lowercases for identity, so
 * using it here would render handles in the wrong case.
 */
export function displayXHandle(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const handle = raw.replace(/^@+/, '').trim();
  return handle ? `@${handle}` : '';
}
