/**
 * Piper TTS — pure renderer-side text chunking (no DOM, no AudioContext) so it's unit-testable.
 * Splitting a long reply into sentence-ish chunks lets us pipeline synth+play: chunk N plays while
 * chunk N+1 synthesizes, so delay-to-first-audio is ~one short sentence instead of the whole reply
 * (important for the High-quality voice, whose whole-utterance synth is slow).
 */

/** Hard cap matching the Web Speech path's per-utterance bound. */
export const MAX_TTS_CHARS = 4000;
/** Target max chunk length; sentences are coalesced up to this, and an over-long sentence is split. */
export const DEFAULT_CHUNK_LEN = 240;

/**
 * Split text into ordered chunks on sentence boundaries (`.`/`!`/`?`/newline), coalescing short
 * sentences up to `maxLen` and hard-splitting any sentence longer than `maxLen`. Whitespace-only
 * input yields no chunks. Total input is bounded to MAX_TTS_CHARS first. Deterministic.
 */
export function chunkText(text: string, maxLen: number = DEFAULT_CHUNK_LEN): string[] {
  const bounded = text.slice(0, MAX_TTS_CHARS);
  // Split keeping the terminator with its sentence; also break on newlines.
  const pieces = bounded
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: string[] = [];
  let cur = '';
  const flush = (): void => { if (cur) { chunks.push(cur); cur = ''; } };

  for (const piece of pieces) {
    // Hard-split a single piece that itself exceeds maxLen (no sentence boundary to lean on).
    if (piece.length > maxLen) {
      flush();
      for (let i = 0; i < piece.length; i += maxLen) chunks.push(piece.slice(i, i + maxLen));
      continue;
    }
    if (cur.length === 0) {
      cur = piece;
    } else if (cur.length + 1 + piece.length <= maxLen) {
      cur = `${cur} ${piece}`;
    } else {
      flush();
      cur = piece;
    }
  }
  flush();
  return chunks;
}
