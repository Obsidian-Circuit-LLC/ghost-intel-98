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
