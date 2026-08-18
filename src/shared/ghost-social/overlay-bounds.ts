/**
 * Clipping a native account-tile overlay to the page that scrolls it.
 *
 * A `WebContentsView` is a sibling of the entire renderer, not a DOM child, so nothing in the DOM
 * clips it: a tile host that has scrolled half-way under the module header still reports a rect
 * spanning the header, and the live account view would paint straight over that chrome (and, off
 * the top of the module, over the desktop). Every overlay bound must therefore be the intersection
 * of the host element with the scrolling viewport, and a tile whose intersection has collapsed must
 * not be presented at all.
 *
 * Pure + shared so both the renderer (which measures) and its tests can use the same arithmetic.
 */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Below this, an overlay is a sliver of live account rather than a usable view — hide instead. */
const MIN_VISIBLE_PX = 3;

/**
 * The visible part of `host` inside `clip`, in integer device-independent pixels, or `null` when
 * that intersection is empty or degenerate (the caller parks/hides the overlay instead).
 */
export function clipOverlayBounds(host: OverlayRect, clip: OverlayRect): OverlayRect | null {
  const left = Math.max(host.x, clip.x);
  const top = Math.max(host.y, clip.y);
  const right = Math.min(host.x + host.width, clip.x + clip.width);
  const bottom = Math.min(host.y + host.height, clip.y + clip.height);
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_VISIBLE_PX || height < MIN_VISIBLE_PX) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}
