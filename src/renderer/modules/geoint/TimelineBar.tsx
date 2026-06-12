/**
 * Presentational timeline scrubber for GeoINT. Renders only when `bounds` is non-null.
 * The parent owns the cursor state and the play timer; this is a dumb control row:
 * a range slider over [min, max], a Play/Pause toggle, an "All" reset, and a date label.
 */

export function TimelineBar({ bounds, cursor, playing, onCursor, onTogglePlay, onAll }: {
  bounds: { min: number; max: number } | null;
  cursor: number;
  playing: boolean;
  onCursor: (t: number) => void;
  onTogglePlay: () => void;
  onAll: () => void;
}): JSX.Element | null {
  if (!bounds) return null;
  const span = bounds.max - bounds.min;
  const step = span > 0 ? span / 200 : 1;
  return (
    <div className="ga98-toolbar ga98-geo-timeline" style={{ flex: '0 0 auto', gap: 6, alignItems: 'center' }}>
      <button onClick={onTogglePlay} title={playing ? 'Pause timeline' : 'Play timeline'} style={{ minWidth: 0, padding: '0 8px' }}>
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={onAll} title="Show all events (jump to latest)" style={{ minWidth: 0, padding: '0 8px' }}>All</button>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={step}
        value={cursor}
        onChange={(e) => onCursor(Number(e.target.value))}
        style={{ flex: 1 }}
        aria-label="Timeline cursor"
      />
      <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: '#333' }}>{new Date(cursor).toLocaleString()}</span>
    </div>
  );
}
