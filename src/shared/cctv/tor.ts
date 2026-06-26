/**
 * Pure helpers for CCTV-over-Tor routing.
 * No Electron or Node imports — safe to import from renderer, main, and tests.
 */

/** Returns a SOCKS5 proxy rules string for Electron's session.setProxy. */
export function torProxyRules(port: number): string {
  return `socks5://127.0.0.1:${port}`;
}

/** Discriminated-union result returned by resolveCctvSession. */
export type CctvSessionResult =
  | { ok: true; partition: 'persist:cctv-tor'; proxyRules: string }
  | { ok: false; reason: 'DISABLED' | 'TOR_UNAVAILABLE' };

/**
 * Resolves whether a CCTV Tor session can be established.
 *
 * - If `enabled` is false → DISABLED (feature toggled off by user).
 * - If `enabled` is true but `torPort` is null → TOR_UNAVAILABLE (Tor not bootstrapped).
 * - Otherwise → ok with the fixed partition name and the SOCKS5 proxy rule.
 *
 * The caller (main-process IPC) is responsible for calling getBgTor() to obtain
 * the port; this function is a pure decision point, not an Electron call site.
 */
export function resolveCctvSession(o: { enabled: boolean; torPort: number | null }): CctvSessionResult {
  if (!o.enabled) {
    return { ok: false, reason: 'DISABLED' };
  }
  if (o.torPort === null) {
    return { ok: false, reason: 'TOR_UNAVAILABLE' };
  }
  return {
    ok: true,
    partition: 'persist:cctv-tor',
    proxyRules: torProxyRules(o.torPort)
  };
}

/**
 * Whitelisted stream kinds for the bundled CCTV player.
 * `webpage` and `youtube` are handled outside the player (Task 8).
 */
const PLAYER_KINDS = new Set(['hls', 'http', 'mjpeg', 'mp4'] as const);
type PlayerKind = 'hls' | 'http' | 'mjpeg' | 'mp4';

/**
 * Builds a query-string fragment for the bundled CCTV player.
 * The caller appends this to the base path of `resources/cctv-player/player.html`.
 *
 * Throws for kinds not in the player whitelist (`hls`, `http`, `mjpeg`, `mp4`).
 * `webpage` and `youtube` are handled separately in the viewer.
 *
 * @example
 *   const playerPath = path.join(app.getAppPath(), 'resources/cctv-player/player.html');
 *   const src = `file://${playerPath}${cctvPlayerUrl({ kind, url })}`;
 */
export function cctvPlayerUrl(o: { kind: string; url: string }): string {
  if (!PLAYER_KINDS.has(o.kind as PlayerKind)) {
    throw new Error(
      `cctvPlayerUrl: unsupported kind "${o.kind}". ` +
      `Whitelisted kinds for the bundled player: ${[...PLAYER_KINDS].join(', ')}. ` +
      `Use webpage/youtube paths in the viewer directly.`
    );
  }
  return `?kind=${encodeURIComponent(o.kind)}&url=${encodeURIComponent(o.url)}`;
}
