/**
 * Presentational story-mode control bar for GeoINT. The parent owns the event sequence,
 * the current index, and the advance timer; this just renders the transport buttons and a
 * position readout. Mounted only while a story is active.
 */

export function StoryControls({ count, index, playing, onPlay, onPause, onPrev, onNext, onStop }: {
  count: number;
  index: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStop: () => void;
}): JSX.Element {
  return (
    <div className="ga98-toolbar ga98-geo-story" style={{ flex: '0 0 auto', gap: 4, alignItems: 'center' }}>
      <button onClick={playing ? onPause : onPlay} title={playing ? 'Pause story' : 'Play story'} style={{ minWidth: 0, padding: '0 8px' }}>
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={onPrev} disabled={index <= 0} title="Previous event" style={{ minWidth: 0, padding: '0 8px' }}>⏮ Prev</button>
      <button onClick={onNext} disabled={index >= count - 1} title="Next event" style={{ minWidth: 0, padding: '0 8px' }}>⏭ Next</button>
      <button onClick={onStop} title="Stop story" style={{ minWidth: 0, padding: '0 8px' }}>⏹ Stop</button>
      <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: '#333' }}>{count ? index + 1 : 0} / {count}</span>
    </div>
  );
}
