/**
 * Live News pop-out window — plays one news feed in its own draggable Win98 window, opened from the
 * GeoINT LiveNewsPanel pop-out (⧉) button. Mirrors CameraViewModule's chrome; the player is the
 * shared NewsStreamView (which enforces the GeoINT network gate).
 *
 * Also reachable as a standalone OSINT tool launched from the Toolkit with no props, where there is
 * no selected stream. Launched that way it must NOT crash dereferencing an absent stream — it falls
 * back to DEFAULT_NEWS_STREAM and renders the same shared viewer. No new egress: NewsStreamView's
 * network gate still decides whether the feed loads at all.
 */
import { NewsStreamView, DEFAULT_NEWS_STREAM, type NewsStream } from './NewsStreamView';

export function NewsViewModule({ stream }: { stream?: NewsStream }): JSX.Element {
  const active = stream ?? DEFAULT_NEWS_STREAM;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {active.label} <span style={{ opacity: 0.6 }}>({active.kind})</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        <NewsStreamView stream={active} />
      </div>
    </div>
  );
}
