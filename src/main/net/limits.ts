/**
 * Outbound-fetch limits shared by the egress modules (Markets, GeoINT). A hostile or slow remote
 * feed must not be able to hang or OOM the main process, so: callers fetch with an AbortSignal
 * timeout, and read the body through readTextCapped, which aborts once the body exceeds a cap
 * instead of buffering an unbounded response into a string before JSON.parse.
 */

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB — generous for quote/feed JSON & CSV

/** Read a Response body as UTF-8 text, aborting if it exceeds maxBytes (DoS guard). */
export async function readTextCapped(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response exceeds ${Math.round(maxBytes / 1024 / 1024)} MB cap`);
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(out);
}
