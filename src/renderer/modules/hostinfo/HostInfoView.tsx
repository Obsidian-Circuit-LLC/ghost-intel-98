import * as React from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { useHostInfo } from './useHostInfo';

export function HostInfoView({ stream, defaultOpen = false }: { stream: CameraStream; defaultOpen?: boolean }): JSX.Element {
  // Tor-only host-resolution recon toggle (settings.geoint.cctvResolveHosts, on by default). Gates
  // BOTH the stream-driven drill-down and the standalone Host Info entry, since both render through
  // this view. Null settings (pre-load) reads as the default (on). When OFF we never fire a lookup
  // — no egress, and never a clearnet fallback that would leak the operator's real IP.
  const resolveHosts = useSettings((s) => s.settings?.geoint.cctvResolveHosts ?? true);
  const { info, loading, run } = useHostInfo(stream.url);
  const [opened, setOpened] = React.useState(false);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
    // Gate the auto-run: only resolve on expand when host resolution is enabled.
    if (e.currentTarget.open && !opened && resolveHosts) { setOpened(true); run(); }
  };
  // <details open> never fires `onToggle` on initial mount (only on a subsequent user toggle),
  // so the defaultOpen (already-expanded) case must kick off the lookup itself. Let main be
  // authoritative on the gate — do not condition this on the possibly-stale cached `resolveHosts`;
  // a disabled result comes back with `resolve-disabled` and renders the "turned off" message via
  // the branch below, with no egress ever performed by main in that case.
  React.useEffect(() => {
    if (defaultOpen && !opened) { setOpened(true); run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);
  // Tor bootstrap fast-fail: the main-side resolve returns a partial HostInfo whose errors carry the
  // `tor-not-ready` marker (no IPs) instead of hanging on a slow Tor start. Surface a clear message
  // rather than the generic "couldn't resolve" block or an indefinite spinner.
  const torNotReady = info != null && info.ips.length === 0 && info.errors.includes('tor-not-ready');
  // Once a result exists, the "turned off" notice is driven by the main process's authoritative
  // answer (resolve-disabled) rather than the renderer's possibly-stale cached setting; before a
  // result exists, the cached setting is used only as a pre-run hint.
  const resolveDisabled = info != null && info.errors.includes('resolve-disabled');
  return (
    <details open={defaultOpen} onToggle={onToggle} style={{ fontSize: 11, padding: '4px 6px', borderTop: '1px solid #808080' }}>
      <summary style={{ cursor: 'pointer' }}>Host resolution{loading ? ' — resolving via Tor…' : ''}</summary>
      {(info ? resolveDisabled : !resolveHosts) ? (
        <div style={{ marginTop: 4, opacity: 0.8 }}>Host resolution is turned off in Settings → GeoINT.</div>
      ) : torNotReady ? (
        <div style={{ color: '#a33', marginTop: 4 }}>
          Host resolution needs Tor (bootstrapping / unavailable).{' '}
          <button style={{ marginLeft: 4 }} onClick={() => run(true)}>Retry</button>
        </div>
      ) : info ? (
        <div style={{ marginTop: 4 }}>
          <div><b>host:</b> {info.host}{info.port ? `:${info.port}` : ''}{info.isIpLiteral ? ' (IP)' : ''}</div>
          {info.ips.length > 0 && <div><b>IP:</b> {info.ips.join(', ')}</div>}
          {info.ptr && <div><b>PTR:</b> {info.ptr}</div>}
          {info.rdap && <div><b>rdap:</b> {[info.rdap.org, info.rdap.asn, info.rdap.country, info.rdap.range].filter(Boolean).join(' · ')}</div>}
          {info.errors.filter((e) => e !== 'resolve-disabled').length > 0 &&
            <div style={{ color: '#a33' }}>Couldn't fully resolve via Tor ({info.errors.filter((e) => e !== 'resolve-disabled').join(', ')}).</div>}
          <button style={{ marginTop: 4 }} onClick={() => run(true)}>Refresh</button>
          <span style={{ opacity: 0.6, marginLeft: 6 }}>{info.resolvedAt}</span>
        </div>
      ) : (
        !loading && opened && <div style={{ color: '#a33', marginTop: 4 }}>Couldn't resolve via Tor.</div>
      )}
    </details>
  );
}
