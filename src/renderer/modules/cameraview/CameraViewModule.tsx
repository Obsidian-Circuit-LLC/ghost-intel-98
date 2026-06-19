/**
 * CCTV quick-view window — a thin wrapper that plays one camera stream in its own draggable Win98
 * window, opened from a GeoINT camera pin. Reuses the EyeSpy Viewer verbatim; the only chrome is a
 * one-line header naming the camera and its location.
 */

import type { CameraStream } from '@shared/post-mvp-types';
import { Viewer } from '../eyespy/Viewer';

/** "<label> — <city · region · country>" using only the location parts that are present. */
export function cameraHeaderText(stream: CameraStream): string {
  const loc = [stream.city, stream.region, stream.country].filter((p) => p && p.trim()).join(' · ');
  return loc ? `${stream.label} — ${loc}` : stream.label;
}

export function CameraViewModule({ stream }: { stream: CameraStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {cameraHeaderText(stream)} <span style={{ opacity: 0.6 }}>({stream.kind})</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: '#000' }}>
        <Viewer stream={stream} />
      </div>
    </div>
  );
}
