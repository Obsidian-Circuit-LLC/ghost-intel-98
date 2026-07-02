/**
 * GhostScrape: renderer-safe job-error mapping. The renderer must never receive a raw error
 * message — it can embed a filesystem path, an account id, or a credential token. safeJobErrorMessage
 * returns one of a small set of fixed, actionable sentences and NEVER the raw text.
 */
import { describe, it, expect } from 'vitest';
import {
  GhostScrapeGatedError,
  GhostScrapeNoCredsError,
  safeJobErrorMessage
} from '../src/main/x/ghostscrape/errors';

describe('safeJobErrorMessage', () => {
  it('maps the gate error to the enable-network sentence', () => {
    expect(safeJobErrorMessage(new GhostScrapeGatedError())).toMatch(/enable X network/i);
  });

  it('maps the no-creds error to the add-cookies sentence', () => {
    expect(safeJobErrorMessage(new GhostScrapeNoCredsError('acct-1'))).toMatch(/add its cookies in X Intel/i);
  });

  it('collapses an unknown error to a generic sentence — never leaking the raw message', () => {
    const leaky = new Error('ENOENT /home/desirae/.config/GhostAccess98/secret auth_token=SECRETTOKEN');
    const msg = safeJobErrorMessage(leaky);
    expect(msg).toBe('Scrape failed. Check the app log for details.');
    expect(msg).not.toContain('auth_token');
    expect(msg).not.toContain('SECRETTOKEN');
    expect(msg).not.toContain('/home/');
  });

  it('handles non-Error throwables without leaking them', () => {
    const msg = safeJobErrorMessage('raw string with /path/and/ct0=abc');
    expect(msg).toBe('Scrape failed. Check the app log for details.');
    expect(msg).not.toContain('ct0=abc');
  });
});
