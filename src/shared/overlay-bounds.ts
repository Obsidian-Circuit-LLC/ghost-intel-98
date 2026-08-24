/**
 * Clipping a native overlay to whatever is supposed to contain it.
 *
 * A `WebContentsView` is a sibling of the entire renderer, not a DOM child, so NOTHING in the DOM
 * clips it — not a scroll container, not the module window, not the viewport. A host that has
 * scrolled half-way under a header, or that overflows a window the user just resized smaller, still
 * reports its full rect, and the native view paints that whole rectangle over whatever happens to
 * be behind it (other windows, the desktop). Every overlay bound must therefore be the intersection
 * of the host with each thing that visually contains it, and an overlay whose intersection has
 * collapsed must not be presented at all.
 *
 * Used by Ghost Social's account tiles (clipped to the scrolling wall) and the WebSDR receiver
 * (clipped to its module window). Pure + shared so the renderers that measure and the tests that
 * check them run the same arithmetic.
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
