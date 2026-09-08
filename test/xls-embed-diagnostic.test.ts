// @vitest-environment node
/**
 * The station explains itself.
 *
 * WHY THIS EXISTS. Three consecutive field reports of the same shape — "reverted back to not
 * scraping / no display pictures" — each investigated by reading code and reasoning about
 * mechanisms, each finding a real and DIFFERENT defect. That pattern says there is more than one
 * failure mode here and that a bare symptom cannot distinguish them. The fourth report should not
 * cost another round of guessing.
 *
 * The single most valuable fact is the one no report has ever carried: are the pictures MISSING
 * from the captured records, or PRESENT and merely not displayed? Those are opposite bugs with
 * opposite fixes, and several releases have been spent on the wrong one. `postsWithPicture` splits
 * them: remote references mean the capture read them and the cache never localised them; zero of
 * both means the scrape never saw them at all.
 *
 * The second most valuable is the version, because "reverted to a previous state" has a boring
 * explanation this project has already hit once (v3.70.1, an installer that left a stale install
 * in place) and nothing in the app has ever stated which build is running.
 */
import { describe, expect, it } from 'vitest';
import { buildStationDiagnostic } from '../src/main/xls-embed/diagnostic';
import { defaultStationState, type PersistedStationState } from '../src/main/xls-embed/state-store';

const CASE = 'ba5eba11-0000-4000-8000-00000000cafe';

function stationState(): PersistedStationState {
  const s = defaultStationState(() => 'T0', () => 'seed') as PersistedStationState;
  s.activeCaseId = CASE;
  s.cases = [{ id: CASE, name: 'Operation Midnight', description: '', createdAt: 'T0', updatedAt: 'T0' }];
  s.profiles = [
    { id: 'p1', caseId: CASE, username: 'exodusghost', displayName: 'GhostExodus', enabled: true, addedAt: 'T0', lastCheckedAt: null, lastError: null, collectedCount: 2 },
    { id: 'p2', caseId: CASE, username: 'dcs_vortex', displayName: 'Vortex', enabled: true, imageMode: 'off', addedAt: 'T0', lastCheckedAt: null, lastError: null, collectedCount: 0 },
  ] as never;
  return s;
}

const BASE = {
  version: '3.81.0',
  session: { connected: true, hasWindow: false },
  tor: { connected: false, clearnetAcked: true },
};

describe('buildStationDiagnostic', () => {
  it('names the running build, because "reverted" has a boring explanation', () => {
    expect(buildStationDiagnostic({ ...BASE, state: stationState() })).toMatch(/3\.81\.0/);
  });

  it('separates the signed-in cookie from an actually-open capture window', () => {
    const text = buildStationDiagnostic({ ...BASE, state: stationState() });
    // "signed in (cookie) != ready to capture (window)" — the v3.71.1 trap. The UI reads the
    // cookie and says SESSION CONNECTED while this campaign has no window to capture through.
    expect(text).toMatch(/cookie: connected/i);
    expect(text).toMatch(/capture window: none/i);
  });

  it('reports the effective image setting per source, override included', () => {
    const text = buildStationDiagnostic({ ...BASE, state: stationState() });
    expect(text).toMatch(/@exodusghost[^\n]*on/i);
    // A source whose per-source override is OFF collects no pictures — and until v3.81.0 that
    // switch did nothing, so it may have been left off without any visible effect.
    expect(text).toMatch(/@dcs_vortex[^\n]*off/i);
  });

  it('splits "no pictures captured" from "pictures captured but not displayed"', () => {
    const s = stationState();
    s.posts = [
      { id: 'a', caseId: CASE, profileId: 'p1', username: 'exodusghost', sourceUsername: 'exodusghost', url: 'https://x.com/a/status/1', text: 'x', createdAt: 'T', collectedAt: 'T', kind: 'post', isReply: false, parentPostId: null, metrics: { replies: 0, reposts: 0, likes: 0, views: 0 }, media: [], avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg' },
      { id: 'b', caseId: CASE, profileId: 'p1', username: 'exodusghost', sourceUsername: 'exodusghost', url: 'https://x.com/a/status/2', text: 'y', createdAt: 'T', collectedAt: 'T', kind: 'post', isReply: false, parentPostId: null, metrics: { replies: 0, reposts: 0, likes: 0, views: 0 }, media: [], avatar: `x-media/${'d'.repeat(64)}` },
      { id: 'c', caseId: CASE, profileId: 'p1', username: 'exodusghost', sourceUsername: 'exodusghost', url: 'https://x.com/a/status/3', text: 'z', createdAt: 'T', collectedAt: 'T', kind: 'post', isReply: false, parentPostId: null, metrics: { replies: 0, reposts: 0, likes: 0, views: 0 }, media: [] },
    ] as never;

    const text = buildStationDiagnostic({ ...BASE, state: s });
    expect(text).toMatch(/findings: 3/i);
    // 2 of 3 carry a picture: one still remote (never localised), one already cached.
    expect(text).toMatch(/with a picture: 2 of 3/i);
    expect(text).toMatch(/1 cached/i);
    expect(text).toMatch(/1 not yet fetched/i);
  });

  it('quotes the most recent collection runs, with their stop reasons', () => {
    const s = stationState();
    s.collectionRuns = [
      { id: 'r1', caseId: CASE, profileId: 'p1', username: 'exodusghost', operation: 'posts', startedAt: 'T', completedAt: 'T', requestedPasses: 0, passesCompleted: 5, observed: 0, added: 0, duplicates: 0, stopReason: 'stable_end', reachedEnd: true, frontierUsernames: [], status: 'ok', error: null },
      { id: 'r2', caseId: CASE, profileId: 'p2', username: 'dcs_vortex', operation: 'followers', startedAt: 'T', completedAt: 'T', requestedPasses: 0, passesCompleted: 0, observed: 0, added: 0, duplicates: 0, stopReason: 'Tor is not connected.', reachedEnd: false, frontierUsernames: [], status: 'error', error: 'Tor is not connected.' },
    ] as never;

    const text = buildStationDiagnostic({ ...BASE, state: s });
    expect(text).toMatch(/posts @exodusghost/);
    expect(text).toMatch(/observed=0/);
    expect(text).toMatch(/followers @dcs_vortex/);
    expect(text).toMatch(/Tor is not connected/);
  });

  it('says plainly when nothing has ever been collected', () => {
    const text = buildStationDiagnostic({ ...BASE, state: stationState() });
    expect(text).toMatch(/findings: 0/i);
    expect(text).toMatch(/no collection runs recorded/i);
  });

  it('is compact enough to paste into a message', () => {
    const s = stationState();
    s.collectionRuns = Array.from({ length: 200 }, (_, i) => ({
      id: `r${i}`, caseId: CASE, profileId: 'p1', username: 'exodusghost', operation: 'posts',
      startedAt: 'T', completedAt: 'T', requestedPasses: 0, passesCompleted: 1, observed: 0, added: 0,
      duplicates: 0, stopReason: 'stable_end', reachedEnd: true, frontierUsernames: [], status: 'ok', error: null,
    })) as never;
    const text = buildStationDiagnostic({ ...BASE, state: s });
    expect(text.split('\n').length).toBeLessThan(25);
    expect(text.length).toBeLessThan(2000);
  });
});
