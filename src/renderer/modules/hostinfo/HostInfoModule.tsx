import type { CameraStream } from '@shared/post-mvp-types';
import { HostInfoView } from './HostInfoView';

export function HostInfoModule({ stream }: { stream: CameraStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        Host resolution — {stream.label}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 4 }}>
        <HostInfoView stream={stream} defaultOpen />
      </div>
    </div>
  );
}
