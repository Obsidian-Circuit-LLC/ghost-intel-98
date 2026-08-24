/**
 * Ghost Social — clipping an account tile's NATIVE overlay to the scrolling page.
 *
 * A `WebContentsView` is a sibling of the whole renderer, not a DOM child, so it is NOT clipped by
 * the scroll container its host element lives in. Once the Compose page scrolls (v3.72.2), a tile
 * scrolled half-way up would paint its live account view straight over the module header and the
 * desktop chrome. The overlay bounds must therefore be the INTERSECTION of the host element and the
 * scrolling viewport, and a tile whose intersection is degenerate must not be shown at all.
 */
import { describe, it, expect } from 'vitest';
import { clipOverlayBounds } from '../src/shared/overlay-bounds';

const VIEWPORT = { x: 272, y: 95, width: 900, height: 620 };

describe('clipOverlayBounds', () => {
  it('returns a fully visible host rect unchanged', () => {
    const host = { x: 300, y: 150, width: 400, height: 390 };
    expect(clipOverlayBounds(host, VIEWPORT)).toEqual(host);
  });

  it('clips a tile scrolled up under the header instead of letting it paint over it', () => {
    const host = { x: 300, y: 20, width: 400, height: 390 };
    expect(clipOverlayBounds(host, VIEWPORT)).toEqual({ x: 300, y: 95, width: 400, height: 315 });
  });

  it('clips a tile hanging below the bottom of the page viewport', () => {
    const host = { x: 300, y: 600, width: 400, height: 390 };
    expect(clipOverlayBounds(host, VIEWPORT)).toEqual({ x: 300, y: 600, width: 400, height: 115 });
  });

  it('clips horizontally as well (a narrowed window)', () => {
    const host = { x: 200, y: 150, width: 400, height: 390 };
    expect(clipOverlayBounds(host, VIEWPORT)).toEqual({ x: 272, y: 150, width: 328, height: 390 });
  });

  it('returns null for a tile scrolled entirely out of the viewport', () => {
    expect(clipOverlayBounds({ x: 300, y: -500, width: 400, height: 390 }, VIEWPORT)).toBeNull();
    expect(clipOverlayBounds({ x: 300, y: 2000, width: 400, height: 390 }, VIEWPORT)).toBeNull();
  });

  it('returns null for a degenerate sliver rather than a 1px strip of live account', () => {
    expect(clipOverlayBounds({ x: 300, y: 94, width: 400, height: 2 }, VIEWPORT)).toBeNull();
  });

  it('rounds to integer device-independent pixels', () => {
    const r = clipOverlayBounds({ x: 300.4, y: 150.6, width: 400.2, height: 390.9 }, VIEWPORT);
    for (const v of Object.values(r!)) expect(Number.isInteger(v)).toBe(true);
  });
});
