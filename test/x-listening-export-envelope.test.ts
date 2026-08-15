/**
 * X Listening Station — FB4 (audit HIGH #10): self-describing JSON export envelope + a
 * NETWORK JSON export.
 *
 * Enterprise's `exportJson` (`main.cjs:2116-2134`) never wrote a bare `posts` array — it wrote
 * a self-describing MANIFEST envelope: `{format, schemaVersion, exportedAt, case, filters,
 * profiles, posts, notes, matches, entities, provenance, manifestHash}`. Ours had regressed to
 * `JSON.stringify(items)`. His `exportRelationshipsJson` (`main.cjs:2485-2490`) likewise wrote a
 * network envelope embedding `computeNetworkAnalysis` + a `manifestHash`; ours offered network
 * CSV only. This suite pins the restored behaviour, KEEPING our hardening: synthetic exclusion,
 * a DETERMINISTIC `manifestHash` (stable field order, no `Date.now()` folded into the hash), and
 * the SHA-256 checksum sidecar.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { XPostArtifact, XNote, XPreset, XProfileSnapshot } from '../src/main/x-listening/store';
import { computeNetworkAnalysis, type AnalysisRelationship } from '../src/main/x-listening/analysis';

function post(over: Partial<XPostArtifact> = {}): XPostArtifact {
  return {
    id: over.id ?? 'post-1',
    platform: 'x',
    authorHandle: '@alice',
    authorId: 'alice',
    text: 'contact bob@example.com about the drop',
    channelId: 'alice',
    channelLabel: '@alice',
    messageId: '1001',
    publishedAt: '2026-08-01T00:00:00.000Z',
    harvestedAt: '2026-08-06T12:00:00.000Z',
    url: 'https://x.com/alice/status/1001',
    provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: 'case-a' },
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 1, reposts: 0, likes: 1, views: 1 },
    metricsRaw: { replies: '1', reposts: '0', likes: '1', views: '1' },
    evidenceHash: 'deadbeef',
    ...over,
  };
}

const snapshot = (over: Partial<XProfileSnapshot> = {}): XProfileSnapshot => ({
  profileId: 'alice',
  sourceUsername: 'alice',
  displayName: 'Alice',
  bio: 'bio',
  avatar: '',
  location: '',
  website: '',
  capturedAt: '2026-08-06T12:00:00.000Z',
  signature: 'sig',
  ...over,
});

describe('buildPostsExportEnvelope (FB4 — audit HIGH #10)', () => {
  it('wraps the posts in a self-describing manifest envelope, not a bare array', async () => {
    const { buildPostsExportEnvelope, X_EXPORT_FORMAT, X_EXPORT_SCHEMA_VERSION } = await import(
      '../src/main/x-listening/exports'
    );
    const env = buildPostsExportEnvelope({
      case: { id: 'case-a', name: 'Op Nightingale' },
      filters: { source: 'alice', type: 'post', query: 'drop' },
      profiles: [snapshot()],
      posts: [post()],
      notes: [{ findingId: 'post-1', text: 'note', savedAt: '2026-08-06T12:00:00.000Z' }],
      matches: [{ presetId: 'p1', presetName: 'Drops', postId: 'post-1', matchedKeywords: ['drop'] }],
      entities: [],
      exportedAt: '2026-08-14T00:00:00.000Z',
    });

    expect(env.format).toBe(X_EXPORT_FORMAT);
    expect(env.schemaVersion).toBe(X_EXPORT_SCHEMA_VERSION);
    expect(env.exportedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(env.case).toEqual({ id: 'case-a', name: 'Op Nightingale' });
    expect(env.filters).toEqual({ source: 'alice', type: 'post', query: 'drop' });
    expect(env.profiles).toHaveLength(1);
    expect(env.posts).toHaveLength(1);
    expect(env.notes).toHaveLength(1);
    expect(env.matches[0]!.matchedKeywords).toEqual(['drop']);
    expect(env.provenance).toMatchObject({ recordHashAlgorithm: 'SHA-256' });
    expect(env.provenance.collectionMethod).toBeTruthy();
    expect(typeof env.manifestHash).toBe('string');
    expect(env.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('excludes synthetic/demo posts from the envelope', async () => {
    const { buildPostsExportEnvelope } = await import('../src/main/x-listening/exports');
    const env = buildPostsExportEnvelope({
      case: null,
      profiles: [],
      posts: [post({ id: 'real' }), post({ id: 'demo', synthetic: true })],
      notes: [],
      matches: [],
      entities: [],
      exportedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(env.posts.map((p) => p.id)).toEqual(['real']);
  });

  it('manifestHash is deterministic for the same payload and independent of exportedAt', async () => {
    const { buildPostsExportEnvelope } = await import('../src/main/x-listening/exports');
    const base = {
      case: { id: 'case-a' },
      profiles: [snapshot()],
      posts: [post()],
      notes: [] as XNote[],
      matches: [],
      entities: [],
    };
    const a = buildPostsExportEnvelope({ ...base, exportedAt: '2026-08-14T00:00:00.000Z' });
    const b = buildPostsExportEnvelope({ ...base, exportedAt: '2027-01-01T09:09:09.000Z' });
    expect(a.manifestHash).toBe(b.manifestHash);

    // a change to the actual intel DOES move the hash
    const c = buildPostsExportEnvelope({
      ...base,
      posts: [post({ text: 'different' })],
      exportedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(c.manifestHash).not.toBe(a.manifestHash);
  });

  it('manifestHash is stable under key-insertion-order differences in the case record', async () => {
    const { buildPostsExportEnvelope } = await import('../src/main/x-listening/exports');
    const mk = (caseRec: unknown) =>
      buildPostsExportEnvelope({
        case: caseRec,
        profiles: [],
        posts: [post()],
        notes: [],
        matches: [],
        entities: [],
        exportedAt: '2026-08-14T00:00:00.000Z',
      }).manifestHash;
    expect(mk({ id: 'x', name: 'y' })).toBe(mk({ name: 'y', id: 'x' }));
  });
});

describe('buildNetworkExportEnvelope (FB4 — network JSON export)', () => {
  const rels: AnalysisRelationship[] = [
    { profileId: 'alice', relationship: 'follower', username: 'carol', displayName: 'Carol' },
    { profileId: 'alice', relationship: 'follower', username: 'demo', displayName: 'Demo', synthetic: true },
  ];

  it('embeds the computeNetworkAnalysis result + a manifestHash, synthetic excluded', async () => {
    const { buildNetworkExportEnvelope, X_NETWORK_EXPORT_FORMAT } = await import(
      '../src/main/x-listening/exports'
    );
    const analysis = computeNetworkAnalysis(
      [{ id: 'alice', username: 'alice' }],
      rels,
      '2026-08-14T00:00:00.000Z',
    );
    const env = buildNetworkExportEnvelope({
      case: { id: 'case-a' },
      filters: {},
      relationships: rels,
      analysis,
      exportedAt: '2026-08-14T00:00:00.000Z',
    });

    expect(env.format).toBe(X_NETWORK_EXPORT_FORMAT);
    expect(env.analysis).toBe(analysis);
    // synthetic relationship dropped from the exported list
    expect(env.relationships.map((r) => r.username)).toEqual(['carol']);
    expect(env.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('manifestHash does not fold in the analysis generatedAt clock', async () => {
    const { buildNetworkExportEnvelope } = await import('../src/main/x-listening/exports');
    const profiles = [{ id: 'alice', username: 'alice' }];
    const a = buildNetworkExportEnvelope({
      case: { id: 'case-a' },
      relationships: rels,
      analysis: computeNetworkAnalysis(profiles, rels, '2026-08-14T00:00:00.000Z'),
      exportedAt: '2026-08-14T00:00:00.000Z',
    });
    const b = buildNetworkExportEnvelope({
      case: { id: 'case-a' },
      relationships: rels,
      analysis: computeNetworkAnalysis(profiles, rels, '2030-12-31T23:59:59.000Z'),
      exportedAt: '2030-12-31T23:59:59.000Z',
    });
    expect(a.manifestHash).toBe(b.manifestHash);
  });
});

describe('assemblePostsExportEnvelope (ipc production assembler)', () => {
  it('derives matches (enabled presets) + entities over the real posts', async () => {
    const { assemblePostsExportEnvelope } = await import('../src/main/x-listening/ipc');
    const preset: XPreset = {
      id: 'p1',
      name: 'Drops',
      keywords: ['drop'],
      mode: 'any',
      caseSensitive: false,
      profileIds: [],
      enabled: true,
      updatedAt: '2026-08-06T12:00:00.000Z',
    };
    const disabled: XPreset = { ...preset, id: 'p2', name: 'Off', enabled: false, keywords: ['contact'] };

    const env = await assemblePostsExportEnvelope(
      'case-a',
      [post({ id: 'real' }), post({ id: 'demo', synthetic: true })],
      {},
      {
        readNotes: async () => [{ findingId: 'real', text: 'n', savedAt: 't' }],
        readPresets: async () => [preset, disabled],
        readProfileSnapshots: async () => [snapshot()],
        readCase: async () => ({ id: 'case-a', name: 'Op' }),
        now: () => '2026-08-14T00:00:00.000Z',
      },
    );

    expect(env.posts.map((p) => p.id)).toEqual(['real']);
    // 'Drops' (enabled) matched; 'Off' (disabled) did not run even though 'contact' is present
    expect(env.matches).toHaveLength(1);
    expect(env.matches[0]!.presetName).toBe('Drops');
    // entity extractor found the email
    expect(env.entities.some((en) => en.type === 'email')).toBe(true);
    expect(env.exportedAt).toBe('2026-08-14T00:00:00.000Z');
  });
});

describe('exportNetworkJsonInteractive (ipc — save-dialog gated network JSON)', () => {
  it('a canceled dialog never writes anything', async () => {
    const { exportNetworkJsonInteractive } = await import('../src/main/x-listening/ipc');
    const writeFile = vi.fn();
    const readNetworkEnvelope = vi.fn();
    const res = await exportNetworkJsonInteractive('case-a', {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile,
      readNetworkEnvelope,
    });
    expect(res).toEqual({ canceled: true });
    expect(writeFile).not.toHaveBeenCalled();
    expect(readNetworkEnvelope).not.toHaveBeenCalled();
  });

  it('writes the network envelope JSON to the operator-chosen path plus a matching sidecar', async () => {
    const { exportNetworkJsonInteractive } = await import('../src/main/x-listening/ipc');
    const { buildNetworkExportEnvelope } = await import('../src/main/x-listening/exports');
    const rels: AnalysisRelationship[] = [
      { profileId: 'alice', relationship: 'follower', username: 'carol' },
    ];
    const analysis = computeNetworkAnalysis([{ id: 'alice', username: 'alice' }], rels, 't');
    const envelope = buildNetworkExportEnvelope({
      case: null,
      relationships: rels,
      analysis,
      exportedAt: 't',
    });
    const written = new Map<string, Buffer | string>();
    const res = await exportNetworkJsonInteractive('case-a', {
      showSaveDialog: async () => ({ canceled: false, filePath: '/chosen/net.json' }),
      writeFile: async (p, d) => void written.set(p, d),
      readNetworkEnvelope: async () => envelope,
    });

    expect(res.canceled).toBe(false);
    if (res.canceled) throw new Error('unreachable');
    expect(res.filePath).toBe('/chosen/net.json');
    expect(res.count).toBe(1);
    const body = String(written.get('/chosen/net.json'));
    const parsed = JSON.parse(body);
    expect(parsed.format).toBeTruthy();
    expect(parsed.analysis).toBeDefined();
    expect(parsed.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    // sidecar hashes the exact bytes written
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(res.sha256).toBe(digest);
    expect(written.get('/chosen/net.json.sha256.txt')).toBe(`${digest}  net.json\n`);
  });
});
