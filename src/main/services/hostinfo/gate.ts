// Settings gate for camera host resolution. Pure over injected deps (settings read + the Tor-only
// resolver + local host extraction), so the IPC handler stays thin and the gate is unit-testable
// without electron or a network.
//
// Invariant (see settings.geoint.cctvResolveHosts): when the toggle is OFF, host resolution is
// disabled ENTIRELY. We return a `resolve-disabled` HostInfo WITHOUT calling the resolver — so no
// Tor lookup happens — and we NEVER fall back to a clearnet resolve (a clearnet DNS/RDAP lookup
// would leak the operator's real IP to the camera's registry path). The disabled result is built
// from a purely-local host extraction; nothing egresses.
import type { HostInfo } from './types';

export interface HostInfoGateDeps {
  /** Reads settings.geoint.cctvResolveHosts. False ⇒ resolution disabled entirely. */
  resolveEnabled(): Promise<boolean>;
  /** The Tor-only resolver facade (hostInfoService.resolve). Invoked ONLY when enabled. */
  resolve(url: string, opts: { force?: boolean }): Promise<HostInfo>;
  /** Pure, local host extraction (no network) used to label the disabled result. */
  hostOf(url: string): string;
  now(): string;
}

/** Reads the host-resolution toggle from settings. Extracted so the IPC wiring's FIELD CHOICE is
 *  unit-testable: `geoint.cctvResolveHosts` (resolution) and `geoint.cctvOverTor` (the stream proxy)
 *  are both booleans in the same settings block, so a wrong-field regression would be type-safe and
 *  otherwise pass every test. register.ts wires `resolveEnabled` through this helper. */
export function hostResolveEnabledFrom(settings: { geoint: { cctvResolveHosts: boolean } }): boolean {
  return settings.geoint.cctvResolveHosts;
}

export async function resolveHostInfoGated(
  deps: HostInfoGateDeps,
  url: string,
  opts: { force?: boolean } = {}
): Promise<HostInfo> {
  if (!(await deps.resolveEnabled())) {
    return { host: deps.hostOf(url), isIpLiteral: false, ips: [], resolvedAt: deps.now(), errors: ['resolve-disabled'] };
  }
  return deps.resolve(url, opts);
}
