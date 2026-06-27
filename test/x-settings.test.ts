/**
 * X-7: Settings UI pure-logic tests.
 *
 * Tests the pure functions and constants exported from
 * src/renderer/modules/x/x-settings-logic.ts that drive the X settings pane.
 *
 * Three invariants under test (spec §3.1, §5.2):
 *
 * 1. GATING — xNetworkToggleEnabled(clearnetAcknowledged) returns false when
 *    clearnetAcknowledged is false; the network toggle is disabled until the
 *    operator has confirmed the clearnet disclosure dialog.
 *
 * 2. DIALOG — CLEARNET_DIALOG_TEXT contains the required disclosure strings:
 *    "over the public internet", IP/request-pattern visibility, and "Tor".
 *    These are spec §3.1 requirements for the acknowledgement dialog text.
 *
 * 3. CREDS NEVER RENDERED — makeXAccountRow() produces a shape with only
 *    `id` and `hasCredential`; hasNoCredentialFields() catches objects that
 *    carry auth_token, ct0, or other credential fields. This mirrors the
 *    IPC contract (x.listAccounts → string[], x.hasAccount → boolean) at
 *    the renderer display layer.
 *
 * No DOM, no React, no Electron — runs in the default vitest node environment.
 */

import { describe, it, expect } from 'vitest';
import {
  xNetworkToggleEnabled,
  CLEARNET_DIALOG_TEXT,
  makeXAccountRow,
  hasNoCredentialFields,
  type XAccountRow,
} from '../src/renderer/modules/x/x-settings-logic';

// ---------------------------------------------------------------------------
// Gating — toggle disabled when clearnetAcknowledged=false (spec §3.1)
// ---------------------------------------------------------------------------

describe('X-7 Settings: gating', () => {
  it('xNetworkToggleEnabled returns false when clearnetAcknowledged is false', () => {
    expect(xNetworkToggleEnabled(false)).toBe(false);
  });

  it('xNetworkToggleEnabled returns true when clearnetAcknowledged is true', () => {
    expect(xNetworkToggleEnabled(true)).toBe(true);
  });

  it('the network toggle remains disabled (false) before the dialog is confirmed', () => {
    // Simulates a new install where clearnetAcknowledged has not been set.
    const clearnetAcknowledged = false;
    const toggleEnabled = xNetworkToggleEnabled(clearnetAcknowledged);
    expect(toggleEnabled).toBe(false);
  });

  it('the network toggle becomes enabled only after clearnetAcknowledged is set', () => {
    // Simulates state after the operator confirms the clearnet dialog.
    const clearnetAcknowledged = true;
    const toggleEnabled = xNetworkToggleEnabled(clearnetAcknowledged);
    expect(toggleEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dialog — CLEARNET_DIALOG_TEXT contains required disclosure strings (spec §3.1)
// ---------------------------------------------------------------------------

describe('X-7 Settings: clearnet dialog disclosure', () => {
  it('CLEARNET_DIALOG_TEXT is a non-empty string', () => {
    expect(typeof CLEARNET_DIALOG_TEXT).toBe('string');
    expect(CLEARNET_DIALOG_TEXT.trim().length).toBeGreaterThan(0);
  });

  it('CLEARNET_DIALOG_TEXT mentions the public internet', () => {
    expect(CLEARNET_DIALOG_TEXT.toLowerCase()).toContain('public internet');
  });

  it('CLEARNET_DIALOG_TEXT mentions IP address or request pattern visibility', () => {
    const lower = CLEARNET_DIALOG_TEXT.toLowerCase();
    // Must mention either "IP" (address) or "request patterns" or both
    expect(lower.includes('ip') || lower.includes('request')).toBe(true);
  });

  it('CLEARNET_DIALOG_TEXT mentions network observers', () => {
    expect(CLEARNET_DIALOG_TEXT.toLowerCase()).toContain('observer');
  });

  it('CLEARNET_DIALOG_TEXT explicitly mentions Tor (cannot use it)', () => {
    const lower = CLEARNET_DIALOG_TEXT.toLowerCase();
    expect(lower).toContain('tor');
    // Must express that Tor is not available — "cannot" or "not" near "routed"
    expect(lower).toMatch(/cannot|not.*rout|bans|defeat/);
  });

  it('CLEARNET_DIALOG_TEXT references x.com', () => {
    expect(CLEARNET_DIALOG_TEXT.toLowerCase()).toContain('x.com');
  });
});

// ---------------------------------------------------------------------------
// Creds never rendered — account display shape carries no credential values
// ---------------------------------------------------------------------------

describe('X-7 Settings: creds never rendered', () => {
  it('makeXAccountRow returns an object with only id and hasCredential', () => {
    const row = makeXAccountRow('acct-1', true);
    expect(Object.keys(row).sort()).toEqual(['hasCredential', 'id'].sort());
  });

  it('makeXAccountRow with hasCredential=false', () => {
    const row = makeXAccountRow('acct-2', false);
    expect(row.id).toBe('acct-2');
    expect(row.hasCredential).toBe(false);
    expect(hasNoCredentialFields(row)).toBe(true);
  });

  it('makeXAccountRow with hasCredential=true', () => {
    const row = makeXAccountRow('acct-3', true);
    expect(row.id).toBe('acct-3');
    expect(row.hasCredential).toBe(true);
    expect(hasNoCredentialFields(row)).toBe(true);
  });

  it('hasNoCredentialFields returns true for a valid XAccountRow', () => {
    const row: XAccountRow = { id: 'test', hasCredential: false };
    expect(hasNoCredentialFields(row)).toBe(true);
  });

  it('hasNoCredentialFields returns false for an object containing auth_token', () => {
    expect(hasNoCredentialFields({ id: 'x', auth_token: 'AAAA…' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for an object containing ct0', () => {
    expect(hasNoCredentialFields({ id: 'x', ct0: 'csrf-token-value' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for an object containing username (cred context)', () => {
    // In the credential store, username is a secret — it must not be echoed to the renderer.
    expect(hasNoCredentialFields({ id: 'x', username: '@burner123' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for an object containing password', () => {
    expect(hasNoCredentialFields({ id: 'x', password: 'secret' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for an object containing token', () => {
    expect(hasNoCredentialFields({ id: 'x', token: 'bearer-abc' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for an object containing secret', () => {
    expect(hasNoCredentialFields({ id: 'x', secret: 'shh' })).toBe(false);
  });

  it('hasNoCredentialFields returns false for null', () => {
    expect(hasNoCredentialFields(null)).toBe(false);
  });

  it('hasNoCredentialFields returns false for a non-object', () => {
    expect(hasNoCredentialFields('string')).toBe(false);
    expect(hasNoCredentialFields(42)).toBe(false);
    expect(hasNoCredentialFields(undefined)).toBe(false);
  });

  it('account list → display rows contain only IDs and boolean flags', () => {
    // Simulates what the UI produces from x.listAccounts() + x.hasAccount()
    const accountIds: string[] = ['burner-x-1', 'burner-x-2'];
    const rows = accountIds.map((id, i) => makeXAccountRow(id, i === 0));
    for (const row of rows) {
      expect(hasNoCredentialFields(row)).toBe(true);
      expect(typeof row.id).toBe('string');
      expect(typeof row.hasCredential).toBe('boolean');
    }
    // Verify the IDs are correct and no extra fields were added.
    expect(rows[0].id).toBe('burner-x-1');
    expect(rows[0].hasCredential).toBe(true);
    expect(rows[1].id).toBe('burner-x-2');
    expect(rows[1].hasCredential).toBe(false);
  });

  it('XAccountRow type structurally has exactly two fields (compile-time guard)', () => {
    // If XAccountRow gains a credential field, TypeScript errors at the assignment
    // below (strict mode + excess property checks). This is a belt-and-suspenders
    // check alongside hasNoCredentialFields.
    const row: XAccountRow = { id: 'compile-check', hasCredential: false };
    expect(Object.keys(row)).toHaveLength(2);
  });
});
