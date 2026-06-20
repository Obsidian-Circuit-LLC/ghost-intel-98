import * as React from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { useHostInfo } from './useHostInfo';

export function HostInfoView({ stream, defaultOpen = false }: { stream: CameraStream; defaultOpen?: boolean }): JSX.Element {
  const { info, loading, run } = useHostInfo(stream.url);
  const [opened, setOpened] = React.useState(false);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
    if (e.currentTarget.open && !opened) { setOpened(true); run(); }
  };
  return (
    <details open={defaultOpen} onToggle={onToggle} style={{ fontSize: 11, padding: '4px 6px', borderTop: '1px solid #808080' }}>
      <summary style={{ cursor: 'pointer' }}>Host resolution{loading ? ' — resolving via Tor…' : ''}</summary>
      {info ? (
        <div style={{ marginTop: 4 }}>
          <div><b>host:</b> {info.host}{info.port ? `:${info.port}` : ''}{info.isIpLiteral ? ' (IP)' : ''}</div>
          {info.ips.length > 0 && <div><b>IP:</b> {info.ips.join(', ')}</div>}
          {info.ptr && <div><b>PTR:</b> {info.ptr}</div>}
          {info.rdap && <div><b>rdap:</b> {[info.rdap.org, info.rdap.asn, info.rdap.country, info.rdap.range].filter(Boolean).join(' · ')}</div>}
          {info.errors.length > 0 && <div style={{ color: '#a33' }}>Couldn't fully resolve via Tor ({info.errors.join(', ')}).</div>}
          <button style={{ marginTop: 4 }} onClick={() => run(true)}>Refresh</button>
          <span style={{ opacity: 0.6, marginLeft: 6 }}>{info.resolvedAt}</span>
        </div>
      ) : (
        !loading && opened && <div style={{ color: '#a33', marginTop: 4 }}>Couldn't resolve via Tor.</div>
      )}
    </details>
  );
}
