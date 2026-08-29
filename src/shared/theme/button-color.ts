/**
 * User-chosen button colour.
 *
 * GhostExodus asked for this after the embedded station's stylesheet accidentally turned every
 * button in the app gold: a colour picker, a reset to the classic Windows face, and saved presets —
 * "when things look flat, you end up getting lost when you're on a race against time". Confining
 * his stylesheet takes that look away again, so this gives it back deliberately, on any colour.
 *
 * The label ink is DERIVED from the chosen face rather than picked separately. He has already been
 * bitten once by a dark style landing on light chrome and making text unreadable; a picker that let
 * someone choose a dark face while black label text stayed put would reproduce exactly that bug, by
 * design, on purpose. So contrast is not a setting.
 */

/** The Win98 button face — what "Reset to default" restores. */
export const CLASSIC_BUTTON_FACE = '#c0c0c0';

/** How many saved swatches are kept. Enough for a working palette, not a hoard. */
export const MAX_COLOR_PRESETS = 8;

/** `#abc` / `#AABBCC` → `#aabbcc`; anything else → '' meaning "no override, keep the theme's look". */
export function normalizeButtonColor(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return '';
}

/**
 * Readable label ink for a button face: black on light, white on dark.
 *
 * Uses relative luminance (ITU-R BT.709 coefficients) rather than a hue or a naive channel average,
 * because the eye is far more sensitive to green than blue — a plain average flips ink on the wrong
 * side of the boundary for saturated colours. An unparseable colour yields dark ink, matching the
 * classic silver face it will be sitting on.
 */
export function buttonInk(face: string): string {
  const hex = normalizeButtonColor(face);
  if (!hex) return '#000000';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/** Save a swatch: newest first, no duplicates, capped. Invalid colours are ignored. */
export function addColorPreset(presets: readonly string[], color: string): string[] {
  const hex = normalizeButtonColor(color);
  if (!hex) return [...presets];
  const without = presets.filter((p) => normalizeButtonColor(p) !== hex);
  return [hex, ...without].slice(0, MAX_COLOR_PRESETS);
}
