/**
 * X-4: X/Twitter collector store-integration tests.
 *
 * Exercises collectX() with a mock sidecar client (deps.runJob) and mock store
 * (deps.upsertItems / deps.recordJob). No real twscrape-runner binary is required.
 * No electron mock needed (deps.runJob is always injected; the lazy sidecar-client
 * import inside collectX is never triggered).
 *
 * Covered scenarios:
 *   1. Happy path: 3 tweets → correct HarvestedItems upserted, job recorded, status 'done'
 *   2. sidecar-missing propagated: no upsert, job still recorded
 *   3. partial (truncated): items upserted, job recorded, status 'partial'
 *   4. breakage-detected: propagated, zero items upserted
 *   5. Credential read: correct secretStore keys requested, XCreds assembled
 *   6. No accountId: creds is undefined (no secretStore calls)
 *   7. Dedup: duplicate item ID → itemsSkipped increments, itemsAdded does not
 *   8. Batch flush: 55 tweets → two upsert calls (50 + 5)
 *   9. channelId derivation: search → query; userTweets → @username
 *  10. mapXTweet: all HarvestedItem fields populated correctly (platform, authorHandle,
 *      authorId, messageId, text, url, publishedAt, harvestedAt, provenance)
 *  11. URL scheme-guard in mapXTweet: non-X URL → empty string stored
 *  12. mediaType recorded when tweet.media is present; absent otherwise
 *  13. jobId plumbing: caller-supplied jobId flows to sidecarResult + provenance
 *  14. Generated jobId used when none supplied
 *  15. collectorVersion in provenance defaults to COLLECTOR_VERSION constant
 */

import { describe, it, expect, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import {
  collectX,
  mapXTweet,
  channelIdFromReq,
  COLLECTOR_VERSION,
} from '../src/main/x/collector';
import type { XCollectDeps, XCollectRequest } from '../src/main/x/collector';
import type { RawTweet, XSidecarResult, XSidecarRequest } from '../src/main/x/sidecar-client';
import type { HarvestedItem, SocmintJob } from '../src/shared/socmint/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_JOB_ID = 'test-job-x4-001';
const FIXED_CASE_ID = 'case-x4-001';
const FIXED_TS = '2026-06-27T10:00:00.000Z';

function makeTweet(id: string, overrides: Partial<RawTweet> = {}): RawTweet {
  return {
    id_str: id,
    date: FIXED_TS,
    rawContent: `Tweet ${id} raw content`,
    lang: 'en',
    url: `https://x.com/testuser/status/${id}`,
    user: {
      id_str: '9900',
      username: 'testuser',
      displayname: 'Test User',
    },
    ...overrides,
  };
}

function makeSearchReq(query = 'ghost intel', limit = 10): XSidecarRequest {
  return { type: 'search', query, limit };
}

function makeUserTweetsReq(username = 'testuser', limit = 10): XSidecarRequest {
  return { type: 'userTweets', username, limit };
}

function makeCollectReq(overrides: Partial<XCollectRequest> = {}): XCollectRequest {
  return {
    sidecarReq: makeSearchReq(),
    caseId: FIXED_CASE_ID,
    channelLabel: 'Test Collection',
    jobId: FIXED_JOB_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock runJob that delivers the given tweets synchronously via onItem,
 * then resolves with the given sidecar result (jobId is always the caller-supplied jobId).
 */
function makeMockRunJob(
  tweets: RawTweet[],
  baseResult: Omit<XSidecarResult, 'jobId'>,
): MockedFunction<NonNullable<XCollectDeps['runJob']>> {
  return vi.fn(
    async (
      _req: XSidecarRequest,
      _creds: unknown,
      onItem: (t: RawTweet) => void,
      jobId: string,
    ): Promise<XSidecarResult> => {
      for (const t of tweets) onItem(t);
      return { ...baseResult, jobId };
    },
  );
}

/** Create a simple in-memory mock store with id-based dedup. */
function makeMockStore() {
  const storedItems: HarvestedItem[] = [];
  const storedJobs: SocmintJob[] = [];
  const seenIds = new Set<string>();

  const upsertItems = vi.fn(
    async (_caseId: string, items: HarvestedItem[]): Promise<{ added: number; skipped: number }> => {
      let added = 0;
      let skipped = 0;
      for (const item of items) {
        if (seenIds.has(item.id)) {
          skipped++;
        } else {
          seenIds.add(item.id);
          storedItems.push(item);
          added++;
        }
      }
      return { added, skipped };
    },
  );

  const recordJob = vi.fn(async (_caseId: string, job: SocmintJob): Promise<void> => {
    storedJobs.push(job);
  });

  return { upsertItems, recordJob, storedItems, storedJobs, seenIds };
}

/** Create a mock getSecret that returns values from the provided map. */
function makeGetSecret(
  secrets: Record<string, string | null> = {},
): MockedFunction<XCollectDeps['getSecret']> {
  return vi.fn(async (key: string) => secrets[key] ?? null);
}

/** Build a complete XCollectDeps with all mocks. */
function makeDeps(
  overrides: Partial<{
    tweets: RawTweet[];
    baseResult: Omit<XSidecarResult, 'jobId'>;
    secrets: Record<string, string | null>;
    store: ReturnType<typeof makeMockStore>;
  }> = {},
): XCollectDeps & { store: ReturnType<typeof makeMockStore>; getSecretMock: MockedFunction<XCollectDeps['getSecret']> } {
  const tweets = overrides.tweets ?? [];
  const baseResult = overrides.baseResult ?? { status: 'done', totalFromSidecar: tweets.length };
  const store = overrides.store ?? makeMockStore();
  const getSecretMock = makeGetSecret(overrides.secrets ?? {});

  return {
    runJob: makeMockRunJob(tweets, baseResult),
    upsertItems: store.upsertItems,
    recordJob: store.recordJob,
    getSecret: getSecretMock,
    harvestedAt: () => FIXED_TS,
    store,
    getSecretMock,
  };
}

// ---------------------------------------------------------------------------
// 1. Happy path: 3 tweets, status 'done'
// ---------------------------------------------------------------------------

describe('X-4: collectX — happy path (3 tweets, status done)', () => {
  it('returns status done with correct itemsAdded and totalFromSidecar', async () => {
    const tweets = [makeTweet('1'), makeTweet('2'), makeTweet('3')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 3 } });
    const req = makeCollectReq();

    const result = await collectX(req, deps);

    expect(result.status).toBe('done');
    expect(result.totalFromSidecar).toBe(3);
    expect(result.itemsAdded).toBe(3);
    expect(result.itemsSkipped).toBe(0);
    expect(result.jobId).toBe(FIXED_JOB_ID);
  });

  it('calls upsertItems with the mapped HarvestedItems', async () => {
    const tweets = [makeTweet('1'), makeTweet('2'), makeTweet('3')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 3 } });
    const req = makeCollectReq();

    await collectX(req, deps);

    expect(deps.store.storedItems.length).toBe(3);
    for (const item of deps.store.storedItems) {
      expect(item.platform).toBe('x');
      expect(item.channelId).toBe('ghost intel'); // search query
      expect(item.channelLabel).toBe('Test Collection');
      expect(item.authorHandle).toBe('testuser');
      expect(item.authorId).toBe('9900');
    }
  });

  it('calls recordJob with the correct jobId, caseId, and runtime', async () => {
    const tweets = [makeTweet('1')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq();

    await collectX(req, deps);

    expect(deps.store.recordJob).toHaveBeenCalledOnce();
    const [calledCaseId, calledJob] = (deps.store.recordJob as MockedFunction<typeof deps.store.recordJob>).mock.calls[0];
    expect(calledCaseId).toBe(FIXED_CASE_ID);
    expect(calledJob.jobId).toBe(FIXED_JOB_ID);
    expect(calledJob.caseId).toBe(FIXED_CASE_ID);
    expect(calledJob.runtime).toBe('twscrape');
  });
});

// ---------------------------------------------------------------------------
// 2. sidecar-missing: propagated, no upsert, job still recorded
// ---------------------------------------------------------------------------

describe('X-4: collectX — sidecar-missing propagation', () => {
  it('propagates sidecar-missing status from the sidecar client', async () => {
    const deps = makeDeps({
      tweets: [],
      baseResult: {
        status: 'sidecar-missing',
        totalFromSidecar: 0,
        errorMessage: 'X collector sidecar not installed — pending operator lock',
      },
    });
    const req = makeCollectReq();

    const result = await collectX(req, deps);

    expect(result.status).toBe('sidecar-missing');
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsSkipped).toBe(0);
    expect(result.errorMessage).toMatch(/not installed/i);
  });

  it('records the job even for sidecar-missing (complete job history)', async () => {
    const deps = makeDeps({
      tweets: [],
      baseResult: { status: 'sidecar-missing', totalFromSidecar: 0 },
    });
    const req = makeCollectReq();

    await collectX(req, deps);

    expect(deps.store.recordJob).toHaveBeenCalledOnce();
  });

  it('does not call upsertItems when no tweets are delivered', async () => {
    const deps = makeDeps({
      tweets: [],
      baseResult: { status: 'sidecar-missing', totalFromSidecar: 0 },
    });
    const req = makeCollectReq();

    await collectX(req, deps);

    expect(deps.store.upsertItems).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. partial (truncated): items upserted, job recorded
// ---------------------------------------------------------------------------

describe('X-4: collectX — partial (truncated) status', () => {
  it('propagates partial status with truncationReason', async () => {
    const tweets = [makeTweet('1')];
    const deps = makeDeps({
      tweets,
      baseResult: {
        status: 'partial',
        totalFromSidecar: 1,
        truncationReason: 'rate-limit',
        truncationMessage: 'Rate limited after 1 tweet',
      },
    });
    const req = makeCollectReq();

    const result = await collectX(req, deps);

    expect(result.status).toBe('partial');
    expect(result.truncationReason).toBe('rate-limit');
    expect(result.truncationMessage).toBe('Rate limited after 1 tweet');
    expect(result.itemsAdded).toBe(1);
  });

  it('partial ≠ done (fail-loud invariant)', async () => {
    const deps = makeDeps({
      tweets: [makeTweet('1')],
      baseResult: { status: 'partial', totalFromSidecar: 1, truncationReason: 'rate-limit' },
    });
    const result = await collectX(makeCollectReq(), deps);
    expect(result.status).not.toBe('done');
  });
});

// ---------------------------------------------------------------------------
// 4. breakage-detected: propagated, zero items
// ---------------------------------------------------------------------------

describe('X-4: collectX — breakage-detected propagation', () => {
  it('propagates breakage-detected with DOC_ID_ROTATION errorCode', async () => {
    const deps = makeDeps({
      tweets: [],
      baseResult: {
        status: 'breakage-detected',
        totalFromSidecar: 0,
        errorCode: 'DOC_ID_ROTATION',
        errorMessage: 'GraphQL operation ID changed — update twscrape-runner sidecar',
      },
    });
    const req = makeCollectReq();

    const result = await collectX(req, deps);

    expect(result.status).toBe('breakage-detected');
    expect(result.errorCode).toBe('DOC_ID_ROTATION');
    expect(result.itemsAdded).toBe(0);
  });

  it('breakage-detected is never treated as done or partial', async () => {
    const deps = makeDeps({
      tweets: [],
      baseResult: { status: 'breakage-detected', totalFromSidecar: 0, errorCode: 'DOC_ID_ROTATION' },
    });
    const result = await collectX(makeCollectReq(), deps);
    expect(result.status).not.toBe('done');
    expect(result.status).not.toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// 5. Credential read: correct secretStore keys requested
// ---------------------------------------------------------------------------

describe('X-4: collectX — credential retrieval', () => {
  it('reads auth_token, ct0, and username from secretStore under x.accounts.<accountId>', async () => {
    const accountId = 'acct-uuid-001';
    const secrets: Record<string, string | null> = {
      [`x.accounts.${accountId}.auth_token`]: 'tok123',
      [`x.accounts.${accountId}.ct0`]: 'ct0abc',
      [`x.accounts.${accountId}.username`]: 'burneruser',
    };
    const deps = makeDeps({
      tweets: [],
      baseResult: { status: 'done', totalFromSidecar: 0 },
      secrets,
    });
    const req = makeCollectReq({ accountId });

    await collectX(req, deps);

    expect(deps.getSecretMock).toHaveBeenCalledWith(`x.accounts.${accountId}.auth_token`);
    expect(deps.getSecretMock).toHaveBeenCalledWith(`x.accounts.${accountId}.ct0`);
    expect(deps.getSecretMock).toHaveBeenCalledWith(`x.accounts.${accountId}.username`);
  });

  it('passes assembled XCreds to runJob when secrets are present', async () => {
    const accountId = 'acct-uuid-002';
    const secrets: Record<string, string | null> = {
      [`x.accounts.${accountId}.auth_token`]: 'tok999',
      [`x.accounts.${accountId}.ct0`]: 'ct0xyz',
      [`x.accounts.${accountId}.username`]: null,
    };
    let capturedCreds: unknown = 'NOT_SET';
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 }, secrets });
    deps.runJob = vi.fn(async (_req, creds, _onItem, jobId) => {
      capturedCreds = creds;
      return { status: 'done', totalFromSidecar: 0, jobId };
    });
    const req = makeCollectReq({ accountId });

    await collectX(req, deps);

    expect(capturedCreds).toMatchObject({ authToken: 'tok999', ct0: 'ct0xyz' });
    expect((capturedCreds as Record<string, unknown>).username).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. No accountId: creds is undefined, no secretStore calls
// ---------------------------------------------------------------------------

describe('X-4: collectX — no accountId', () => {
  it('does not call getSecret when accountId is absent', async () => {
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 } });
    // No accountId in request
    const req = makeCollectReq({ accountId: undefined });

    await collectX(req, deps);

    expect(deps.getSecretMock).not.toHaveBeenCalled();
  });

  it('passes undefined creds to runJob when accountId is absent', async () => {
    let capturedCreds: unknown = 'NOT_SET';
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 } });
    deps.runJob = vi.fn(async (_req, creds, _onItem, jobId) => {
      capturedCreds = creds;
      return { status: 'done', totalFromSidecar: 0, jobId };
    });
    const req = makeCollectReq({ accountId: undefined });

    await collectX(req, deps);

    expect(capturedCreds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Dedup: duplicate tweet ID → itemsSkipped increments
// ---------------------------------------------------------------------------

describe('X-4: collectX — dedup via store', () => {
  it('counts skipped items when a tweet ID already exists in the store', async () => {
    const tweet = makeTweet('42');
    const store = makeMockStore();

    // Run once to seed the store.
    const deps1 = makeDeps({
      tweets: [tweet],
      baseResult: { status: 'done', totalFromSidecar: 1 },
      store,
    });
    await collectX(makeCollectReq({ jobId: 'job-first' }), deps1);
    expect(store.storedItems.length).toBe(1);

    // Run again with the same tweet — should be skipped.
    const deps2 = makeDeps({
      tweets: [tweet],
      baseResult: { status: 'done', totalFromSidecar: 1 },
      store,
    });
    const result = await collectX(makeCollectReq({ jobId: 'job-second' }), deps2);

    expect(result.itemsAdded).toBe(0);
    expect(result.itemsSkipped).toBe(1);
    expect(store.storedItems.length).toBe(1); // unchanged
  });

  it('correctly counts mixed added and skipped in the same run', async () => {
    const store = makeMockStore();

    // Seed with tweet '1' first.
    const deps1 = makeDeps({
      tweets: [makeTweet('1')],
      baseResult: { status: 'done', totalFromSidecar: 1 },
      store,
    });
    await collectX(makeCollectReq({ jobId: 'job-seed' }), deps1);

    // Second run: tweet '1' (dup) + tweet '2' (new).
    const deps2 = makeDeps({
      tweets: [makeTweet('1'), makeTweet('2')],
      baseResult: { status: 'done', totalFromSidecar: 2 },
      store,
    });
    const result = await collectX(makeCollectReq({ jobId: 'job-mixed' }), deps2);

    expect(result.itemsAdded).toBe(1);
    expect(result.itemsSkipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Batch flush: 55 tweets → two upsertItems calls (50 + 5)
// ---------------------------------------------------------------------------

describe('X-4: collectX — batch flush (BATCH_SIZE = 50)', () => {
  it('calls upsertItems twice for 55 tweets (50 + 5)', async () => {
    const tweets = Array.from({ length: 55 }, (_, i) => makeTweet(String(i + 1)));
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 55 } });
    const req = makeCollectReq();

    const result = await collectX(req, deps);

    expect(deps.store.upsertItems).toHaveBeenCalledTimes(2);
    const calls = (deps.store.upsertItems as MockedFunction<typeof deps.store.upsertItems>).mock.calls;
    expect(calls[0][1].length).toBe(50);
    expect(calls[1][1].length).toBe(5);
    expect(result.itemsAdded).toBe(55);
  });

  it('calls upsertItems once for exactly 50 tweets', async () => {
    const tweets = Array.from({ length: 50 }, (_, i) => makeTweet(String(i + 1)));
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 50 } });

    await collectX(makeCollectReq(), deps);

    expect(deps.store.upsertItems).toHaveBeenCalledTimes(1);
  });

  it('does not call upsertItems for zero tweets', async () => {
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 } });

    await collectX(makeCollectReq(), deps);

    expect(deps.store.upsertItems).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. channelId derivation
// ---------------------------------------------------------------------------

describe('X-4: channelIdFromReq', () => {
  it('returns the query string for a search request', () => {
    expect(channelIdFromReq({ type: 'search', query: 'ghost intel', limit: 10 })).toBe('ghost intel');
  });

  it('returns @username for a userTweets request', () => {
    expect(channelIdFromReq({ type: 'userTweets', username: 'testuser', limit: 10 })).toBe('@testuser');
  });

  it('uses query as channelId when collecting by search', async () => {
    const tweets = [makeTweet('99')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq({ sidecarReq: makeSearchReq('osint operators') });

    await collectX(req, deps);

    const stored = deps.store.storedItems[0];
    expect(stored.channelId).toBe('osint operators');
    expect(stored.provenance.keyword).toBe('osint operators');
  });

  it('uses @username as channelId when collecting by user timeline', async () => {
    const tweets = [makeTweet('77')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq({ sidecarReq: makeUserTweetsReq('opensint') });

    await collectX(req, deps);

    const stored = deps.store.storedItems[0];
    expect(stored.channelId).toBe('@opensint');
    expect(stored.provenance.keyword).toBe('@opensint');
  });
});

// ---------------------------------------------------------------------------
// 10. mapXTweet: all HarvestedItem fields (unit test of the mapper directly)
// ---------------------------------------------------------------------------

describe('X-4: mapXTweet — field mapping', () => {
  const mapCtx = {
    channelId: 'test query',
    channelLabel: 'My Collection',
    jobId: FIXED_JOB_ID,
    caseId: FIXED_CASE_ID,
    collectorVersion: 'x-v1',
    harvestedAt: () => FIXED_TS,
  };

  it('sets platform to x', () => {
    const item = mapXTweet(makeTweet('1'), mapCtx);
    expect(item.platform).toBe('x');
  });

  it('sets authorHandle to tweet.user.username', () => {
    const tweet = makeTweet('1', { user: { id_str: '1', username: 'burner42', displayname: 'Burner' } });
    const item = mapXTweet(tweet, mapCtx);
    expect(item.authorHandle).toBe('burner42');
  });

  it('sets authorId to tweet.user.id_str', () => {
    const tweet = makeTweet('1', { user: { id_str: '555', username: 'u', displayname: 'd' } });
    const item = mapXTweet(tweet, mapCtx);
    expect(item.authorId).toBe('555');
  });

  it('sets messageId to tweet.id_str', () => {
    const item = mapXTweet(makeTweet('999'), mapCtx);
    expect(item.messageId).toBe('999');
  });

  it('sets text to tweet.rawContent', () => {
    const tweet = makeTweet('1', { rawContent: 'Hello world from X' });
    const item = mapXTweet(tweet, mapCtx);
    expect(item.text).toBe('Hello world from X');
  });

  it('sets publishedAt to tweet.date (not Date.now())', () => {
    const tweet = makeTweet('1', { date: '2026-01-15T08:30:00Z' });
    const item = mapXTweet(tweet, mapCtx);
    expect(item.publishedAt).toBe('2026-01-15T08:30:00Z');
  });

  it('sets harvestedAt from the injected clock', () => {
    const item = mapXTweet(makeTweet('1'), mapCtx);
    expect(item.harvestedAt).toBe(FIXED_TS);
  });

  it('sets provenance.collectorVersion, jobId, caseId, keyword', () => {
    const item = mapXTweet(makeTweet('1'), mapCtx);
    expect(item.provenance.collectorVersion).toBe('x-v1');
    expect(item.provenance.jobId).toBe(FIXED_JOB_ID);
    expect(item.provenance.caseId).toBe(FIXED_CASE_ID);
    expect(item.provenance.keyword).toBe('test query');
  });

  it('produces a deterministic id from harvestedItemId(x, channelId, id_str)', () => {
    const item1 = mapXTweet(makeTweet('1'), mapCtx);
    const item2 = mapXTweet(makeTweet('1'), mapCtx);
    expect(item1.id).toBe(item2.id);
    expect(typeof item1.id).toBe('string');
    expect(item1.id.length).toBe(64); // SHA-256 hex
  });

  it('produces different ids for different tweet id_str values', () => {
    const item1 = mapXTweet(makeTweet('1'), mapCtx);
    const item2 = mapXTweet(makeTweet('2'), mapCtx);
    expect(item1.id).not.toBe(item2.id);
  });

  it('does not set mediaRef (absent in v1, spec §5.4)', () => {
    const item = mapXTweet(makeTweet('1'), mapCtx);
    expect(item.mediaRef).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11. URL scheme-guard in mapXTweet
// ---------------------------------------------------------------------------

describe('X-4: mapXTweet — URL scheme-guard (spec §5.3)', () => {
  const mapCtx = {
    channelId: 'q', channelLabel: 'l', jobId: 'j', caseId: 'c',
    collectorVersion: 'x-v1', harvestedAt: () => FIXED_TS,
  };

  it('accepts a valid https://x.com permalink', () => {
    const tweet = makeTweet('1', { url: 'https://x.com/user/status/1' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('https://x.com/user/status/1');
  });

  it('accepts a valid https://twitter.com permalink', () => {
    const tweet = makeTweet('1', { url: 'https://twitter.com/user/status/1' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('https://twitter.com/user/status/1');
  });

  it('rejects http:// and stores empty string', () => {
    const tweet = makeTweet('1', { url: 'http://x.com/user/status/1' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('');
  });

  it('rejects javascript: and stores empty string', () => {
    const tweet = makeTweet('1', { url: 'javascript:alert(1)' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('');
  });

  it('rejects a URL with userinfo (host-spoof guard)', () => {
    const tweet = makeTweet('1', { url: 'https://attacker@x.com/status/1' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('');
  });

  it('rejects an off-platform URL', () => {
    const tweet = makeTweet('1', { url: 'https://evil.com/x.com/status/1' });
    expect(mapXTweet(tweet, mapCtx).url).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 12. mediaType recorded when present; absent when not
// ---------------------------------------------------------------------------

describe('X-4: mapXTweet — media handling (spec §5.4)', () => {
  const mapCtx = {
    channelId: 'q', channelLabel: 'l', jobId: 'j', caseId: 'c',
    collectorVersion: 'x-v1', harvestedAt: () => FIXED_TS,
  };

  it('sets mediaType from the first media element', () => {
    const tweet = makeTweet('1', {
      media: [{ mediaType: 'photo' }, { mediaType: 'video' }],
    });
    expect(mapXTweet(tweet, mapCtx).mediaType).toBe('photo');
  });

  it('sets mediaType for video', () => {
    const tweet = makeTweet('1', { media: [{ mediaType: 'video' }] });
    expect(mapXTweet(tweet, mapCtx).mediaType).toBe('video');
  });

  it('leaves mediaType undefined when tweet.media is absent', () => {
    const tweet = makeTweet('1');
    expect(mapXTweet(tweet, mapCtx).mediaType).toBeUndefined();
  });

  it('leaves mediaType undefined when tweet.media is empty', () => {
    const tweet = makeTweet('1', { media: [] });
    expect(mapXTweet(tweet, mapCtx).mediaType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 13. jobId plumbing
// ---------------------------------------------------------------------------

describe('X-4: collectX — jobId plumbing', () => {
  it('uses the caller-supplied jobId in the result and provenance', async () => {
    const myJobId = 'explicit-job-id-001';
    const tweets = [makeTweet('1')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq({ jobId: myJobId });

    const result = await collectX(req, deps);

    expect(result.jobId).toBe(myJobId);
    expect(deps.store.storedItems[0].provenance.jobId).toBe(myJobId);
  });

  it('passes the jobId to the sidecar runJob', async () => {
    let capturedJobId = '';
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 } });
    deps.runJob = vi.fn(async (_req, _creds, _onItem, jobId) => {
      capturedJobId = jobId;
      return { status: 'done', totalFromSidecar: 0, jobId };
    });
    const req = makeCollectReq({ jobId: 'passed-job-id' });

    await collectX(req, deps);

    expect(capturedJobId).toBe('passed-job-id');
  });
});

// ---------------------------------------------------------------------------
// 14. Generated jobId when none supplied
// ---------------------------------------------------------------------------

describe('X-4: collectX — auto-generated jobId', () => {
  it('generates a UUID jobId when none is supplied', async () => {
    const deps = makeDeps({ tweets: [], baseResult: { status: 'done', totalFromSidecar: 0 } });
    const req = makeCollectReq({ jobId: undefined });

    const result = await collectX(req, deps);

    expect(typeof result.jobId).toBe('string');
    // UUID format: 8-4-4-4-12
    expect(result.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// 15. collectorVersion in provenance defaults to COLLECTOR_VERSION
// ---------------------------------------------------------------------------

describe('X-4: collectX — collectorVersion', () => {
  it('uses the COLLECTOR_VERSION constant when collectorVersion is not specified', async () => {
    const tweets = [makeTweet('1')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq({ collectorVersion: undefined });

    await collectX(req, deps);

    const stored = deps.store.storedItems[0];
    expect(stored.provenance.collectorVersion).toBe(COLLECTOR_VERSION);
  });

  it('uses the caller-supplied collectorVersion when provided', async () => {
    const tweets = [makeTweet('1')];
    const deps = makeDeps({ tweets, baseResult: { status: 'done', totalFromSidecar: 1 } });
    const req = makeCollectReq({ collectorVersion: 'x-v2-test' });

    await collectX(req, deps);

    expect(deps.store.storedItems[0].provenance.collectorVersion).toBe('x-v2-test');
  });
});
