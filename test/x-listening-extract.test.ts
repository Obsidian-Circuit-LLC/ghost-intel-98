/**
 * X3 — Visible-post capture → HarvestedItem (pure extract + normalizer).
 *
 * These tests pin the honesty-critical guarantees of the X Listening Station's
 * post-capture layer, all on PURE functions (no electron, no network):
 *
 *  1. `X_POST_SCRIPT` is a STATIC in-page payload — it contains no `${…}`
 *     interpolation, so scraped/attacker-controlled content can never be spliced
 *     into the code the capture window executes.
 *  2. `parseMetricText` stores a rounded display metric ("1.2K") VERBATIM with
 *     `approx:true` and a best-effort numeric expansion — never a bare
 *     false-precision integer (the review's false-precision finding).
 *  3. `normalizePost` maps a captured-DOM post → a `HarvestedItem` stamped
 *     `verified:false` + `captureProvenance:'visible-capture'`, preserves the
 *     post text VERBATIM (escaping is a render/export concern, done by
 *     `escapeField`, not baked into storage), and admits media only as local
 *     `data:` thumbnails — a remote `http(s)` media URL is dropped, never stored
 *     (the beacon finding).
 *
 * extract.ts is quarantine-clean: this file imports it WITHOUT mocking electron,
 * proving the module pulls in nothing from the main-process/electron graph.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  X_POST_SCRIPT,
  parseMetricText,
  normalizePost,
  type RawPost,
  type NormalizeContext,
} from '../src/main/x-listening/extract';
import { escapeField } from '../src/main/capture/security';

const CTX: NormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'x-listening/1.0.0',
  harvestedAt: '2026-08-06T12:00:00.000Z',
  channelId: 'target',
  channelLabel: '@target timeline',
};

const rawPost = (o: Partial<RawPost> = {}): RawPost => ({
  id: '1789000000000000001',
  username: 'target',
  url: 'https://x.com/target/status/1789000000000000001',
  text: 'Visible tweet body — <script>alert(1)</script> & more',
  createdAt: '2026-08-06T11:59:00.000Z',
  isReply: false,
  isRepost: false,
  socialContext: '',
  metricsRaw: { replies: '12', reposts: '3', likes: '1.2K', views: '45.6K' },
  media: ['data:image/png;base64,AAAA'],
  ...o,
});

// ---- 1. static payload, no interpolation -------------------------------

describe('X_POST_SCRIPT: static, no interpolation', () => {
  it('is a non-empty string', () => {
    expect(typeof X_POST_SCRIPT).toBe('string');
    expect(X_POST_SCRIPT.length).toBeGreaterThan(0);
  });

  it('contains NO `${` interpolation (scraped content can never be spliced in)', () => {
    expect(X_POST_SCRIPT.includes('${')).toBe(false);
  });

  it('reads only the visible tweet-article DOM', () => {
    expect(X_POST_SCRIPT).toContain('article[data-testid="tweet"]');
  });
});

// ---- 2. metric honesty --------------------------------------------------

describe('parseMetricText: rounded metrics stored verbatim + approx', () => {
  it('a "1.2K" source is approx:true, verbatim raw, best-effort value', () => {
    expect(parseMetricText('1.2K')).toEqual({ raw: '1.2K', value: 1200, approx: true });
  });

  it('expands M / B suffixes and flags them approx', () => {
    expect(parseMetricText('2.3M')).toEqual({ raw: '2.3M', value: 2_300_000, approx: true });
    expect(parseMetricText('4B')).toEqual({ raw: '4B', value: 4_000_000_000, approx: true });
  });

  it('an exact small integer is NOT approx', () => {
    expect(parseMetricText('42')).toEqual({ raw: '42', value: 42, approx: false });
  });

  it('a comma-grouped exact count is preserved verbatim and NOT approx', () => {
    // X aria-labels often carry the exact count, e.g. "1,234 replies. Reply".
    expect(parseMetricText('1,234 replies. Reply')).toEqual({
      raw: '1,234',
      value: 1234,
      approx: false,
    });
  });

  it('an empty/absent metric is a zeroed, non-approx cell (no guess)', () => {
    expect(parseMetricText('')).toEqual({ raw: '', value: 0, approx: false });
  });
});

// ---- 3. normalizePost ---------------------------------------------------

describe('normalizePost: captured DOM → HarvestedItem', () => {
  it('stamps the honesty markers (verified:false, visible-capture)', () => {
    const item = normalizePost(rawPost(), CTX);
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.platform).toBe('x');
    expect(item.kind).toBe('post');
  });

  it('preserves the post text VERBATIM (escaping is a render concern)', () => {
    const item = normalizePost(rawPost(), CTX);
    expect(item.text).toBe('Visible tweet body — <script>alert(1)</script> & more');
    // …and escapeField renders it safe on the way OUT, not in storage.
    expect(escapeField(item.text)).toContain('&lt;script&gt;');
    expect(escapeField(item.text)).not.toContain('<script>');
  });

  it('stores rounded metrics as {value, approx} — likes "1.2K" is approx, replies "12" is not', () => {
    const item = normalizePost(rawPost(), CTX);
    expect(item.metrics.likes.approx).toBe(true);
    expect(item.metrics.likes.raw).toBe('1.2K');
    expect(item.metrics.replies.approx).toBe(false);
    expect(item.metrics.replies.value).toBe(12);
  });

  it('captures media only as local data: thumbnails — no field starts with http', () => {
    const item = normalizePost(
      rawPost({ media: ['data:image/png;base64,AAAA', 'https://pbs.twimg.com/media/x.jpg'] }),
      CTX,
    );
    expect(item.media[0].startsWith('data:')).toBe(true);
    // the remote URL is DROPPED (beacon finding), not stored.
    expect(item.media.every((m) => m.startsWith('data:'))).toBe(true);
    expect(item.media.some((m) => m.startsWith('http'))).toBe(false);
    expect(item.media).toEqual(['data:image/png;base64,AAAA']);
    // mediaRef, when set, is the local data: thumbnail — never a remote URL.
    if (item.mediaRef) expect(item.mediaRef.startsWith('data:')).toBe(true);
  });

  it('scheme-guards the permalink and carries case/channel provenance', () => {
    const item = normalizePost(rawPost(), CTX);
    expect(item.url).toBe('https://x.com/target/status/1789000000000000001');
    expect(item.channelId).toBe('target');
    expect(item.channelLabel).toBe('@target timeline');
    expect(item.harvestedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(item.provenance).toEqual({
      collectorVersion: 'x-listening/1.0.0',
      jobId: 'job-1',
      caseId: 'case-a',
    });
  });

  it('drops a non-x permalink rather than storing an off-domain URL', () => {
    const item = normalizePost(rawPost({ url: 'https://evil.example/target/status/1' }), CTX);
    expect(item.url).toBe('');
  });

  it('derives a deterministic sha256 id over x:channelId:messageId', () => {
    const item = normalizePost(rawPost(), CTX);
    const expected = createHash('sha256')
      .update('x:target:1789000000000000001', 'utf8')
      .digest('hex');
    expect(item.id).toBe(expected);
    expect(item.messageId).toBe('1789000000000000001');
    // deterministic: same input → same id.
    expect(normalizePost(rawPost(), CTX).id).toBe(item.id);
  });
});
