/**
 * Resolves a playlist item to a concrete, playable source — and is the single
 * choke point for the streaming opt-in gate. A remote URL resolves ONLY when
 * streaming is enabled; a local track always resolves (it never touches the
 * network — it is served by the ga98media:// protocol). Returns null when the
 * item cannot/should not play (e.g. a stream while streaming is off).
 */

export type Resolved = { kind: 'local' | 'stream'; src: string };

export function resolveSource(item: { path?: string; url?: string }, streamingEnabled: boolean): Resolved | null {
  if (item.path) return { kind: 'local', src: 'ga98media://track/' + encodeURIComponent(item.path) };
  if (item.url) {
    if (!streamingEnabled) return null; // app-layer egress gate
    return { kind: 'stream', src: item.url };
  }
  return null;
}

/** True if a stream URL points at an HLS manifest (play via hls.js, not <audio src>). */
export function isHlsUrl(url: string): boolean {
  try { return new URL(url).pathname.toLowerCase().endsWith('.m3u8'); } catch { return false; }
}
