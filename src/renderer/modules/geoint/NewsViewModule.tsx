/**
 * Live News pop-out window — plays one news feed in its own draggable Win98 window, opened from the
 * GeoINT LiveNewsPanel pop-out (⧉) button. Mirrors CameraViewModule's chrome; the player is the
 * shared NewsStreamView (which enforces the GeoINT network gate).
 */
import { NewsStreamView, type NewsStream } from './NewsStreamView';

export function NewsViewModule({ stream }: { stream: NewsStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {stream.label} <span style={{ opacity: 0.6 }}>({stream.kind})</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        <NewsStreamView stream={stream} />
      </div>
    </div>
  );
}
