/**
 * Policy for the Live News pop-out window. Mirrors cameraview/cameraWindow.ts but WITHOUT a cap:
 * the operator may open unlimited news windows (locked scope), so opens are id-deduped only —
 * re-popping the same feed re-focuses its window. Pure + dependency-free so it's unit-testable
 * without the window store. NewsStream has no id field; identity is its kind+url.
 */
import type { NewsStream } from './NewsStreamView';

/** Deterministic window id for a feed, so re-clicking the same feed re-focuses its window. */
export function newsWindowId(stream: NewsStream): string {
  return `news-view:${stream.kind}:${stream.url}`;
}

/** The exact argument passed to useWindows.open() for a news pop-out. */
export function newsWindowSpec(stream: NewsStream) {
  return {
    module: 'news-view' as const,
    id: newsWindowId(stream),
    title: stream.label,
    props: { stream },
    width: 640,
    height: 480
  };
}
