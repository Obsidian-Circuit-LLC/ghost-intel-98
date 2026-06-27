/**
 * Searchlight Tor connector — small idempotent state machine over the bundled
 * bgconn Tor singleton. Lets the renderer explicitly *start* Tor before running a
 * Tor-mode sweep, without weakening the no-silent-clearnet invariant: Tor mode
 * still refuses (TOR_UNAVAILABLE) when Tor isn't ready; this only lets the user
 * kick off the bootstrap. No new network egress — reuses the existing Tor process.
 *
 * Idempotent: shares one in-flight start promise so concurrent connects don't
 * double-spawn. BgconnTor.start() already no-ops if `this.proc` is set, but the
 * connector still tracks the in-flight promise to report 'connecting' accurately.
 */

export type TorConnState = 'off' | 'connecting' | 'ready';

export interface TorLike {
  isBootstrapped(): boolean;
  start(): Promise<void>;
}

export interface TorConnector {
  status(): TorConnState;
  connect(): Promise<{ state: TorConnState; error?: string }>;
}

export function makeTorConnector(getTor: () => TorLike | null): TorConnector {
  let inFlight: Promise<void> | null = null;

  function status(): TorConnState {
    const t = getTor();
    if (t?.isBootstrapped()) return 'ready';
    if (inFlight) return 'connecting';
    return 'off';
  }

  async function connect(): Promise<{ state: TorConnState; error?: string }> {
    const t = getTor();
    if (!t) return { state: 'off', error: 'Tor is unavailable' };
    if (t.isBootstrapped()) return { state: 'ready' };
    try {
      if (!inFlight) {
        inFlight = t.start().finally(() => { inFlight = null; });
      }
      await inFlight;
      return t.isBootstrapped() ? { state: 'ready' } : { state: 'connecting' };
    } catch (err) {
      return { state: 'off', error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { status, connect };
}
