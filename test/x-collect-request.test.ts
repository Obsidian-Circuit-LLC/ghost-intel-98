/**
 * X collector — collect-request builder + gate logic (regression for the
 * "loaded cookie never used" bug, v3.24.2).
 *
 * Bug: XCollectPanel built its IPC collect request with only
 * {caseId, mode, query|username, limit} and NEVER threaded an accountId.
 * handleXCollect only attaches stored credentials when req.accountId is
 * present (src/main/x/ipc.ts:254,291), so every harvest ran against an empty
 * twscrape account pool → near-zero results / instant rate-limiting, even
 * though the user had pasted a valid auth_token/ct0 cookie in Settings.
 *
 * These tests lock the request shape (accountId IS carried) and the gate
 * (you cannot launch an anonymous harvest that is guaranteed to yield nothing).
 *
 * Pure-logic file: no DOM/React/Electron — runs in the default vitest node env.
 */

import { describe, it, expect } from 'vitest';
import {
  buildXCollectRequest,
  canCollect,
} from '../src/renderer/modules/x/x-collect-request';

const CASE = '11111111-1111-1111-1111-111111111111';

describe('buildXCollectRequest: accountId threading (the bug)', () => {
  it('includes accountId when an account is selected', () => {
    const req = buildXCollectRequest({
      caseId: CASE,
      mode: 'search',
      query: 'nasa',
      accountId: 'acct-1',
    });
    expect(req.accountId).toBe('acct-1');
  });

  it('omits accountId when none is selected (no empty-string key)', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'nasa', accountId: '' });
    expect('accountId' in req).toBe(false);
  });

  it('trims surrounding whitespace from accountId', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'nasa', accountId: '  acct-1  ' });
    expect(req.accountId).toBe('acct-1');
  });
});

describe('buildXCollectRequest: search vs userTweets fields', () => {
  it('search mode carries a trimmed query and no username', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'search', query: '  from:user kw  ', accountId: 'a' });
    expect(req.mode).toBe('search');
    expect(req.query).toBe('from:user kw');
    expect('username' in req).toBe(false);
  });

  it('userTweets mode carries a @-stripped username and no query', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'userTweets', username: '  @target ', accountId: 'a' });
    expect(req.mode).toBe('userTweets');
    expect(req.username).toBe('target');
    expect('query' in req).toBe(false);
  });

  it('carries the case id verbatim', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'x', accountId: 'a' });
    expect(req.caseId).toBe(CASE);
  });
});

describe('buildXCollectRequest: limit', () => {
  it('includes a positive integer limit', () => {
    const req = buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'x', accountId: 'a', limit: 250 });
    expect(req.limit).toBe(250);
  });

  it('omits a non-positive or non-finite limit', () => {
    expect('limit' in buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'x', accountId: 'a', limit: 0 })).toBe(false);
    expect('limit' in buildXCollectRequest({ caseId: CASE, mode: 'search', query: 'x', accountId: 'a', limit: NaN })).toBe(false);
  });
});

describe('canCollect: an account is required (no silent anonymous harvest)', () => {
  const base = {
    gateOpen: true,
    collecting: false,
    caseId: CASE,
    mode: 'search' as const,
    query: 'nasa',
    username: '',
    accountId: 'acct-1',
  };

  it('allows collect when gate is open, a case + query + account are present', () => {
    expect(canCollect(base)).toBe(true);
  });

  it('blocks collect when no account is selected (the footgun this fix closes)', () => {
    expect(canCollect({ ...base, accountId: '' })).toBe(false);
  });

  it('blocks collect when the gate is closed', () => {
    expect(canCollect({ ...base, gateOpen: false })).toBe(false);
  });

  it('blocks collect while a harvest is already running', () => {
    expect(canCollect({ ...base, collecting: true })).toBe(false);
  });

  it('blocks collect with no case id', () => {
    expect(canCollect({ ...base, caseId: '' })).toBe(false);
  });

  it('search mode blocks collect with an empty query', () => {
    expect(canCollect({ ...base, query: '   ' })).toBe(false);
  });

  it('userTweets mode requires a username', () => {
    expect(canCollect({ ...base, mode: 'userTweets', query: '', username: '' })).toBe(false);
    expect(canCollect({ ...base, mode: 'userTweets', query: '', username: 'target' })).toBe(true);
  });
});
