/**
 * Chat file transfer (Phase 2) — a pure, deterministic chunker + reassembler that sits ON TOP of the
 * encrypted session. A file is sent as one FileOffer envelope followed by N ordered FileChunk
 * envelopes, each its own AEAD-sealed `Msg` frame. Every chunk therefore inherits the session's
 * confidentiality, integrity, ordering, and replay protection for free.
 *
 * This module adds only the application-level concerns the transport can't give us:
 *   - bounding total transfer size (memory DoS),
 *   - validating chunk indices + per-index lengths,
 *   - deduping re-delivered chunks (idempotent) while rejecting CONFLICTING duplicates,
 *   - verifying the assembled file against the sha256 bound in the offer BEFORE the bytes are ever
 *     released to the caller (so a peer can't smuggle well-formed-but-wrong content to disk).
 *
 * No network, no fs, no time, no RNG (the transferId is supplied by the caller) → fully unit-testable.
 */
import { sha256, constantTimeEqual } from './crypto';
import {
  type MessageContent,
  CHUNK_SIZE,
  FILE_HASH_LEN,
  MAX_FILE_BYTES,
  MAX_FILENAME_LEN,
  MAX_MIME_LEN,
  TRANSFER_ID_LEN
} from './session';

export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferError';
  }
}

export type FileOffer = Extract<MessageContent, { type: 'file-offer' }>;
export type FileChunk = Extract<MessageContent, { type: 'file-chunk' }>;

/** Split a file into the offer + ordered chunk envelopes the engine seals + sends in order. The
 *  transferId is caller-supplied (engine mints 16 random bytes) so this stays deterministic. */
export function chunkFile(params: {
  transferId: Uint8Array;
  name: string;
  mime: string;
  data: Uint8Array;
}): { offer: FileOffer; chunks: FileChunk[] } {
  const { transferId, name, mime, data } = params;
  if (transferId.length !== TRANSFER_ID_LEN) throw new TransferError('bad transferId length');
  if (data.length === 0) throw new TransferError('refusing to send an empty file');
  if (data.length > MAX_FILE_BYTES) throw new TransferError('file exceeds max size');
  if (name.length === 0) throw new TransferError('file name required');
  const chunkCount = Math.ceil(data.length / CHUNK_SIZE);
  const hash = sha256(data);
  const offer: FileOffer = { type: 'file-offer', transferId, hash, name, size: data.length, mime, chunkCount };
  const chunks: FileChunk[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * CHUNK_SIZE;
    chunks.push({ type: 'file-chunk', transferId, index: i, data: data.slice(start, start + CHUNK_SIZE) });
  }
  return { offer, chunks };
}

/**
 * Reassembles one inbound transfer. Created from a validated FileOffer, then fed FileChunks in any
 * order. Fail-closed on every anomaly (wrong transfer, out-of-range index, wrong per-index length,
 * conflicting duplicate, total-size overflow). The assembled bytes are released by assemble() only
 * after the whole-file sha256 matches the offer.
 */
export class FileReceiver {
  private readonly chunks: (Uint8Array | undefined)[];
  private received = 0;
  private bytes = 0;
  private done = false;

  constructor(public readonly offer: FileOffer) {
    if (offer.hash.length !== FILE_HASH_LEN) throw new TransferError('bad offer hash length');
    if (offer.size < 0 || offer.size > MAX_FILE_BYTES) throw new TransferError('offer size out of range');
    if (offer.name.length === 0 || offer.name.length > MAX_FILENAME_LEN) throw new TransferError('bad offer name');
    if (offer.mime.length > MAX_MIME_LEN) throw new TransferError('bad offer mime');
    const expected = offer.size === 0 ? 0 : Math.ceil(offer.size / CHUNK_SIZE);
    if (offer.chunkCount !== expected) throw new TransferError('offer chunkCount inconsistent with size');
    this.chunks = new Array(offer.chunkCount).fill(undefined);
  }

  get complete(): boolean {
    return this.received === this.offer.chunkCount;
  }

  get progress(): { received: number; total: number; bytes: number } {
    return { received: this.received, total: this.offer.chunkCount, bytes: this.bytes };
  }

  /** Expected payload length for a given chunk index given the offer's size (last chunk is short). */
  private expectedLen(index: number): number {
    const isLast = index === this.offer.chunkCount - 1;
    return isLast ? this.offer.size - (this.offer.chunkCount - 1) * CHUNK_SIZE : CHUNK_SIZE;
  }

  /** Accept one chunk. Throws on any mismatch; an EXACT duplicate index is idempotent (no-op). */
  accept(chunk: FileChunk): void {
    if (this.done) throw new TransferError('transfer already assembled');
    if (!constantTimeEqual(chunk.transferId, this.offer.transferId)) throw new TransferError('chunk transferId mismatch');
    if (chunk.index < 0 || chunk.index >= this.offer.chunkCount) throw new TransferError('chunk index out of range');
    if (chunk.data.length !== this.expectedLen(chunk.index)) throw new TransferError('chunk length wrong for its index');
    const existing = this.chunks[chunk.index];
    if (existing) {
      if (!constantTimeEqual(existing, chunk.data)) throw new TransferError('conflicting duplicate chunk');
      return; // idempotent re-delivery
    }
    if (this.bytes + chunk.data.length > MAX_FILE_BYTES) throw new TransferError('transfer exceeds max size');
    this.chunks[chunk.index] = chunk.data;
    this.received += 1;
    this.bytes += chunk.data.length;
  }

  /** Concatenate + verify against the offer hash. Throws unless complete AND the hash matches. */
  assemble(): Uint8Array {
    if (!this.complete) throw new TransferError('transfer incomplete');
    const out = new Uint8Array(this.offer.size);
    let o = 0;
    for (let i = 0; i < this.offer.chunkCount; i += 1) {
      const c = this.chunks[i] as Uint8Array;
      out.set(c, o);
      o += c.length;
    }
    if (o !== this.offer.size) throw new TransferError('assembled size mismatch');
    if (!constantTimeEqual(sha256(out), this.offer.hash)) {
      throw new TransferError('file hash mismatch — corrupt or tampered transfer');
    }
    this.done = true;
    return out;
  }
}
