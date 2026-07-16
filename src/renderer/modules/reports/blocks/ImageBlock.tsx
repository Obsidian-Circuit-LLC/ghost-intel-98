/** ImageBlock — one captioned, resizable photo in a report's body. Renders the resolved image
 *  (its data/object URL is supplied by the module's asset cache — the block itself only stores an
 *  `assetRef` into the encrypted store, never the bytes) at the block's stored `widthPct`, with a
 *  bottom-right resize handle and a caption <input> in a smaller font.
 *
 *  The resize math is isolated in the pure `clampPct` helper so the [10,100] bound (matching the
 *  main-process `ensureReport` widthPct clamp) is enforced identically in the editor and unit-tested
 *  without simulating a full pointer drag. The handle drag never emits a widthPct outside that band,
 *  so a hand-dragged photo can't overflow the page or collapse to nothing — and even a tampered
 *  value is re-clamped on save by the validator. */
import { useRef } from 'react';
import type { ReportBlock } from '@shared/reports-types';

type ImageBlockData = Extract<ReportBlock, { kind: 'image' }>;

/** The block's width as a percentage of the body column. Bounds mirror `ensureReport`'s widthPct
 *  clamp so the editor never proposes a value the store would reject; a non-finite input (a degenerate
 *  drag delta or a corrupt record) falls back to the neutral default rather than NaN-poisoning style. */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 60;
  return Math.max(10, Math.min(100, Math.round(n)));
}

export interface ImageBlockProps {
  block: ImageBlockData;
  /** Resolved preview URL for `block.assetRef` (data URL from the encrypted store), or undefined
   *  while it's still loading / missing. */
  src?: string;
  /** Patch the block — `widthPct` from a resize, `caption` from the caption field, `align` from the
   *  right-rail properties panel. */
  onChange: (patch: Partial<Pick<ImageBlockData, 'widthPct' | 'caption' | 'align'>>) => void;
  onRemove?: () => void;
  /** Mark this block as the right-rail's selected image (clicking the frame selects it). */
  onSelect?: () => void;
  /** True when this is the right-rail's selected image — draws a selection outline. */
  selected?: boolean;
}

export function ImageBlock(props: ImageBlockProps): JSX.Element {
  const { block, src, onChange, onRemove, onSelect, selected } = props;
  const frameRef = useRef<HTMLDivElement | null>(null);

  /** Begin a resize drag from the bottom-right handle. Width is computed from the pointer's x
   *  relative to the image frame's left edge, as a percentage of the frame's own width, then
   *  clamped. Listeners are attached to `window` (not the handle) so the drag keeps tracking even
   *  when the pointer outruns the small handle. */
  function startResize(e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    // Fall back to a sane frame width if layout gives 0 (jsdom): keeps the delta finite.
    const frameWidth = rect.width > 0 ? rect.width : 100;

    function onMove(ev: MouseEvent): void {
      const px = ev.clientX - rect.left;
      onChange({ widthPct: clampPct((px / frameWidth) * 100) });
    }
    function onUp(): void {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      className={`ga98-report-imageblock${selected ? ' selected' : ''}`}
      style={{ textAlign: block.align ?? 'left' }}
      onClick={onSelect}
    >
      <div
        className="ga98-report-imageblock-frame"
        ref={frameRef}
        style={{ width: `${clampPct(block.widthPct)}%` }}
      >
        {src ? (
          <img
            className="ga98-report-imageblock-img"
            src={src}
            alt={block.caption || 'Report photo'}
            style={{ width: '100%', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div className="ga98-report-imageblock-loading" style={{ width: '100%', display: 'block' }}>
            Loading image…
          </div>
        )}
        <span
          className="ga98-report-imageblock-handle"
          role="separator"
          aria-label="Resize photo"
          onMouseDown={startResize}
        />
        {onRemove ? (
          <button
            type="button"
            className="ga98-report-imageblock-remove"
            aria-label="Remove photo"
            onClick={onRemove}
          >
            ✕
          </button>
        ) : null}
      </div>
      <input
        className="ga98-report-imageblock-caption"
        aria-label="Photo caption"
        placeholder="Caption…"
        value={block.caption}
        onChange={(e) => onChange({ caption: e.target.value })}
      />
    </div>
  );
}
