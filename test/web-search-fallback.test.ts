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
});
