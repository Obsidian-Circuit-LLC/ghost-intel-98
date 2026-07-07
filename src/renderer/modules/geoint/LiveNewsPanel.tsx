/**
 * GeoINT — Live News video panel (R12). A user-managed playlist of news streams. Playback is
 * delegated to the shared <NewsStreamView/> (geoint/NewsStreamView.tsx), which also backs the
 * pop-out news-view window so both surfaces render identically:
 *   - kind 'hls'     → hls.js into a muted, autoplaying <video> (same pattern as EyeSpy Viewer).
 *   - kind 'youtube' → a sandboxed www.youtube-nocookie.com/embed iframe (the single, operator-
 *                      authorized exception to the renderer frame-src invariant; host-scoped in
 *                      src/renderer/index.html).
 *
 * The settings.geoint.networkEnabled gate (network off ⇒ loads NOTHING: no HLS chunks, no iframe)
 * now lives inside NewsStreamView, so it is enforced on every surface from one place. This panel
 * only renders the "no stream selected" placeholder before handing a selected stream to the view.
 *
 * The Stream dropdown + pop-out(⧉)/remove(✕) buttons + Label/kind/m3u8 add-form are the shared
 * <NewsFeedControls/> (geoint/NewsFeedControls.tsx) — the standalone/pop-out News module
 * (NewsViewModule) renders the SAME component, so both surfaces manage one settings.geoint.
 * newsStreams list identically.
 *
 * parseYouTubeId / validateStreamUrl are re-exported as pure functions so they're unit-tested
 * (test/geoint-livenews.test.ts) without rendering.
 */

import { useSettings } from '../../state/store';
import { parseYouTubeId } from '@shared/youtube';
import { NewsStreamView, type NewsStream } from './NewsStreamView';
import { NewsFeedControls, validateStreamUrl } from './NewsFeedControls';

// Re-export so existing callers/tests that import parseYouTubeId/validateStreamUrl from this
// module still resolve.
export { parseYouTubeId, validateStreamUrl };

export function LiveNewsPanel(): JSX.Element {
  const settings = useSettings((s) => s.settings);

  // Defensive read (mirrors GeoIntModuleInner): a partial/legacy settings object must not crash.
  const g = settings?.geoint;
  const streams: NewsStream[] = g?.newsStreams ?? [];
  const rawIndex = g?.newsStreamIndex ?? 0;
  const index = streams.length === 0 ? 0 : Math.min(Math.max(rawIndex, 0), streams.length - 1);
  const active: NewsStream | undefined = streams[index];

  return (
    <fieldset className="ga98-livenews">
      <legend>Live News</legend>

      <NewsFeedControls />

      <div
        className="ga98-livenews-video"
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', marginBottom: 6 }}
      >
        {!active ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 12, textAlign: 'center', padding: 12 }}>
            No stream selected. Add one below.
          </div>
        ) : (
          <NewsStreamView stream={active} />
        )}
      </div>
    </fieldset>
  );
}
