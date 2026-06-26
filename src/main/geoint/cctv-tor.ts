/**
 * Main-side CCTV-over-Tor session proxy.
 *
 * Applies a SOCKS5 proxy to the dedicated `persist:cctv-tor` partition so that a
 * `<webview partition="persist:cctv-tor">` (the EyeSpy Tor branch) egresses only
 * through the live bgconn Tor SOCKS port. The decision of whether a Tor session can
 * be established is delegated to the pure `resolveCctvSession` helper; this module is
 * only the Electron call site.
 *
 * Trust posture: when the feature is disabled, or Tor isn't bootstrapped, we NEVER
 * fall back to clearnet — the renderer is told `{ ok:false, reason }` and must refuse
 * to load the stream. When disabled we additionally clear the partition proxy back to
 * `direct://` defensively, so a previously-applied Tor proxy can't linger.
 */

import { session } from 'electron';
import { resolveCctvSession } from '@shared/cctv/tor';
import { getBgTor } from '../bgconn/tor-singleton';

const CCTV_PARTITION = 'persist:cctv-tor';

/** Live bgconn Tor SOCKS port, or null when Tor isn't bootstrapped. Never clearnet. */
function torSocksPort(): number | null {
  const t = getBgTor();
  return t && t.isBootstrapped() ? t.socksPort() : null;
}

/**
 * Apply (or clear) the Tor proxy on the CCTV partition.
 *
 * @param enabled — the `geoint.cctvOverTor` setting, passed from the IPC caller.
 * @returns `{ ok:true }` once the partition proxy is set to the Tor SOCKS rule, or
 *          `{ ok:false, reason }` (`DISABLED` | `TOR_UNAVAILABLE`) — in which case the
 *          renderer must not load the stream.
 */
export async function applyCctvTorProxy(
  enabled: boolean
): Promise<{ ok: boolean; reason?: 'DISABLED' | 'TOR_UNAVAILABLE' }> {
  const r = resolveCctvSession({ enabled, torPort: torSocksPort() });
  if (!r.ok) {
    // Defensively clear any previously-applied Tor proxy on this partition so a
    // disabled/unavailable state can't leave a stale proxy in place.
    try {
      await session.fromPartition(CCTV_PARTITION).setProxy({ proxyRules: 'direct://' });
    } catch {
      /* best-effort; the renderer refuses to load regardless */
    }
    return { ok: false, reason: r.reason };
  }
  await session.fromPartition(CCTV_PARTITION).setProxy({ proxyRules: r.proxyRules });
  return { ok: true };
}
