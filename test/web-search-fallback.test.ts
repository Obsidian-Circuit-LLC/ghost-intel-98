import { describe, it, expect } from 'vitest';
import { planWebSearch } from '../src/main/services/web-search/directive';

describe('planWebSearch', () => {
  it('chooses tor when the Tor search returned results, regardless of clearnet setting', () => {
    expect(planWebSearch({ torResults: 3, clearnetOn: true })).toEqual({ mode: 'tor' });
    expect(planWebSearch({ torResults: 3, clearnetOn: false })).toEqual({ mode: 'tor' });
    expect(planWebSearch({ torResults: 1, clearnetOn: false })).toEqual({ mode: 'tor' });
  });

  it('chooses clearnet ONLY when Tor returned zero results AND clearnet is opted in', () => {
    expect(planWebSearch({ torResults: 0, clearnetOn: true })).toEqual({ mode: 'clearnet' });
  });

  it('chooses empty when Tor returned zero results and clearnet is not opted in', () => {
    expect(planWebSearch({ torResults: 0, clearnetOn: false })).toEqual({ mode: 'empty' });
  });

  it('clearnet fallback is DDG-only: an ineligible engine (SearXNG) never falls back to clearnet even opted in', () => {
    // The DDG clearnet fallback (searchWebClearnet) is DDG-specific; onion metasearch (SearXNG) must
    // never leak the real IP to a clearnet DDG scrape on a zero result.
    expect(planWebSearch({ torResults: 0, clearnetOn: true, clearnetEligible: false })).toEqual({ mode: 'empty' });
    expect(planWebSearch({ torResults: 0, clearnetOn: true, clearnetEligible: true })).toEqual({ mode: 'clearnet' });
  });

  it('omitting clearnetEligible preserves the existing DDG behavior (eligible by default)', () => {
    expect(planWebSearch({ torResults: 0, clearnetOn: true })).toEqual({ mode: 'clearnet' });
  });
});
