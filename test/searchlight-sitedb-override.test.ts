import { describe, it, expect } from 'vitest';
import { pickSitesSource } from '../src/shared/searchlight/sites';

const OVERRIDE_JSON = JSON.stringify({ OverrideSite: { url: 'https://o.test/{username}' } });
const BUNDLED_JSON = JSON.stringify({ BundledSite: { url: 'https://b.test/{username}' } });

describe('pickSitesSource', () => {
  it('valid override wins', () => {
    expect(pickSitesSource(OVERRIDE_JSON, BUNDLED_JSON)[0].name).toBe('OverrideSite');
  });
  it('null override → bundled', () => {
    expect(pickSitesSource(null, BUNDLED_JSON)[0].name).toBe('BundledSite');
  });
  it('malformed override → bundled (no throw)', () => {
    expect(pickSitesSource('{bad', BUNDLED_JSON)[0].name).toBe('BundledSite');
  });
  it('valid override suppresses bundled entries', () => {
    const result = pickSitesSource(OVERRIDE_JSON, BUNDLED_JSON);
    expect(result.find((s) => s.name === 'BundledSite')).toBeUndefined();
  });
});
