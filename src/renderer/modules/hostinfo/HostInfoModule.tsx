import * as React from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { HostInfoView } from './HostInfoView';

/**
 * Host resolution module. Reachable two ways:
 *  - drill-down from the EyeSpy/GeoINT flow, which passes the CameraStream being inspected;
 *  - standalone from the OSINT Toolkit with no stream, where the operator types a host/IP.
 *
 * With a stream present this behaves exactly as before (no regression to the camera flow).
 * With no stream it renders a host/IP entry form that feeds the SAME resolve path — a bare
 * host/IP entry is wrapped in a minimal synthetic stream so `HostInfoView`/`useHostInfo`
 * (and the resolve IPC behind them) are reused verbatim. Resolution semantics and Tor gating
 * are unchanged here; this only adds the entry point.
 */
export function HostInfoModule({ stream }: { stream?: CameraStream }): JSX.Element {
  if (!stream) return <HostInfoStandalone />;
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

/** Wrap a typed-in host/IP as a minimal stream so the existing resolve view can consume it.
 *  The resolve path parses `url` with `new URL(...)`, which throws on a bare host/IP (yielding
 *  errors:['bad-url'] and no resolution). Normalize to an absolute URL so hostFromStreamUrl can
 *  extract host+port; keep id/label as the raw host the operator typed. */
function synthStream(host: string): CameraStream {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`;
  return { id: `hostinfo:${host}`, label: host, url, kind: 'webpage', caseId: null, addedAt: '', notes: '' };
}

function HostInfoStandalone(): JSX.Element {
  const [value, setValue] = React.useState('');
  const [target, setTarget] = React.useState<CameraStream | null>(null);

  const submit = (): void => {
    const host = value.trim();
    if (!host) return;
    // Remount the view on each submit (keyed by host) so a new host re-runs resolution cleanly.
    setTarget(synthStream(host));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        Host resolution
      </div>
      <div style={{ padding: 6, borderBottom: '1px solid #808080', display: 'flex', gap: 6, alignItems: 'center' }}>
        <label className="ga98-text" style={{ fontSize: 11 }} htmlFor="hostinfo-entry">Host / IP</label>
        <input
          id="hostinfo-entry"
          className="ga98-text"
          type="text"
          value={value}
          placeholder="example.com  or  203.0.113.4:554"
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          style={{ flex: 1, fontSize: 11 }}
        />
        <button onClick={submit} disabled={!value.trim()}>Resolve</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 4 }}>
        {target
          ? <HostInfoView key={target.id} stream={target} defaultOpen />
          : <div className="ga98-text" style={{ fontSize: 11, opacity: 0.6, padding: 4 }}>Enter a host or IP and choose Resolve.</div>}
      </div>
    </div>
  );
}
