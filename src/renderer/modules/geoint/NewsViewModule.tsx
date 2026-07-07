/**
 * Live News module — mirrors the GeoINT LiveNewsPanel: the SAME shared Stream dropdown + add-feed
 * form (NewsFeedControls) plus the shared player (NewsStreamView), all backed by the one
 * settings.geoint.newsStreams list. A feed added or selected here is immediately reflected in the
 * GeoINT panel and vice-versa.
 *
 * Reachable two ways:
 *  - popped out from the GeoINT LiveNewsPanel's pop-out (⧉) button, which hands it the stream that
 *    was active at the moment of popping (a snapshot — the pop-out still renders the shared
 *    controls, so the operator can keep switching feeds from inside the pop-out too);
 *  - launched standalone as an OSINT tool from the Toolkit with no props, where there is no
 *    snapshot stream — it reads the store's active stream (streams[newsStreamIndex]) instead.
 *
 * Either way it must NOT crash dereferencing an absent stream: with no snapshot prop and an empty
 * store it falls back to DEFAULT_NEWS_STREAM. No new egress: NewsStreamView's network gate still
 * decides whether the feed loads at all.
 */
import { useSettings } from '../../state/store';
import { NewsFeedControls } from './NewsFeedControls';
import { NewsStreamView, DEFAULT_NEWS_STREAM, type NewsStream } from './NewsStreamView';

export function NewsViewModule({ stream }: { stream?: NewsStream } = {}): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const g = settings?.geoint;
  const streams: NewsStream[] = g?.newsStreams ?? [];
  const rawIndex = g?.newsStreamIndex ?? 0;
  const index = streams.length === 0 ? 0 : Math.min(Math.max(rawIndex, 0), streams.length - 1);
  const active: NewsStream = stream ?? streams[index] ?? DEFAULT_NEWS_STREAM;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <NewsFeedControls />
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {active.label} <span style={{ opacity: 0.6 }}>({active.kind})</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        <NewsStreamView stream={active} />
      </div>
    </div>
  );
}
