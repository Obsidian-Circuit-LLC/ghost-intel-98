/**
 * X Listening Station — per-profile image-collection policy (F1).
 *
 * Enterprise (`electron/main.cjs:369`) resolved whether to fetch a profile's post images through
 * `effectiveImageCollection(profile)`: a per-profile `imageMode` ('on' | 'off' | 'inherit') layered
 * on the campaign-wide image toggle (`activeSettings().collectImages`) — `on` forces collection,
 * `off` suppresses it, `inherit` falls back to the campaign toggle. This port keeps the shape + the
 * pure decision here so BOTH the main enforcement path (`src/main/x-listening/image-policy.ts`) AND
 * the renderer's per-source Images control read ONE source of truth; the persistence + the campaign
 * toggle (F2's `retrieveImages`) are wired on the main side.
 *
 * Determinism: `effectiveImageCollection` + `normalizeImageMode` are pure functions of their
 * arguments — no clock, no RNG.
 */

/** A source/profile's image-collection override. `inherit` = follow the campaign-wide toggle. */
export type XImageMode = 'on' | 'off' | 'inherit';

/** The three valid modes, in a stable order (drives the renderer's control options). */
export const IMAGE_MODES: readonly XImageMode[] = ['on', 'off', 'inherit'] as const;

/** The default for a source that has never been given an explicit override. */
export const DEFAULT_IMAGE_MODE: XImageMode = 'inherit';

/**
 * Coerce an arbitrary (renderer-supplied, legacy, or absent) value to a valid `XImageMode`,
 * healing anything that is not exactly one of the three literals to the default. The renderer is
 * never trusted with the mode string — this is the ONE gate before a mode is persisted or consulted.
 */
export function normalizeImageMode(value: unknown): XImageMode {
  return value === 'on' || value === 'off' || value === 'inherit' ? value : DEFAULT_IMAGE_MODE;
}

/**
 * The per-profile image-collection decision, exactly as Enterprise `effectiveImageCollection`:
 *   - `on`      → always collect (overrides the campaign toggle),
 *   - `off`     → never collect (overrides the campaign toggle),
 *   - `inherit` → follow `campaignRetrieveImages` (F2's per-campaign `retrieveImages`).
 */
export function effectiveImageCollection(mode: XImageMode, campaignRetrieveImages: boolean): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return campaignRetrieveImages;
}
