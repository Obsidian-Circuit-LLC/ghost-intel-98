/**
 * Pure settings logic for the X/Twitter collector UI (X-7).
 *
 * No DOM, no React, no Electron — importable in vitest node environment.
 * The component (SettingsModule.tsx XPane) imports constants and helpers from
 * here so the test-verified logic is what the component actually executes.
 *
 * Spec references:
 *   §3.1 — clearnet acknowledgement gate
 *   §5.2 — credentials stored main-side only, never echoed to renderer
 */

/**
 * The verbatim text displayed in the clearnet-acknowledgement dialog before
 * settings.x.clearnetAcknowledged can be set to true.
 *
 * Required content (spec §3.1):
 *   - "connects to x.com over the public internet"
 *   - "IP and request patterns are visible to X and any network observer"
 *   - "cannot be routed through Tor"
 *
 * The dialog is persistent — it must be confirmed before the network toggle
 * can be turned on, and clearnetAcknowledged persists across sessions.
 */
export const CLEARNET_DIALOG_TEXT =
  'The X/Twitter collector connects to x.com over the public internet. ' +
  'Your IP address and request patterns are visible to X, Cloudflare, ' +
  'and any network observer on the path. This collector cannot be routed ' +
  'through Tor (X bans Tor exit nodes near-instantly; Cloudflare Turnstile ' +
  'defeats Tor clients). Only continue if you understand and accept this ' +
  'clearnet exposure.';

/**
 * Returns true when the X network-enabled toggle may be activated.
 *
 * The toggle is disabled until clearnetAcknowledged is true — the operator
 * must explicitly confirm the clearnet disclosure dialog before enabling egress.
 *
 * Spec §3.1: "both flags must be true before any sidecar path is entered at
 * the IPC boundary."
 */
export function xNetworkToggleEnabled(clearnetAcknowledged: boolean): boolean {
  return clearnetAcknowledged;
}

/**
 * The shape of an X account as presented in the Settings UI.
 *
 * INVARIANT (spec §5.2): no credential values (auth_token, ct0, username)
 * may appear here. The renderer calls x.listAccounts() → string[] (IDs) and
 * x.hasAccount(id) → boolean; it never receives the raw credential values.
 */
export interface XAccountRow {
  /** Account ID from the secretStore index. */
  id: string;
  /** True when secretStore holds a non-empty auth_token for this account. */
  hasCredential: boolean;
}

/**
 * Build a display-only account row from an ID and its credential-presence flag.
 *
 * The function signature makes it structurally impossible to include credential
 * values — they are not accepted as parameters. The test verifies that the
 * returned object contains only `id` and `hasCredential`.
 */
export function makeXAccountRow(id: string, hasCredential: boolean): XAccountRow {
  return { id, hasCredential };
}

/**
 * Returns true when the given object contains NO forbidden credential fields.
 *
 * Used in tests to assert that account display data never carries credential
 * values. Checks for: auth_token, ct0, username, password, token, secret.
 */
export function hasNoCredentialFields(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const keys = Object.keys(row as object);
  const forbidden = ['auth_token', 'ct0', 'username', 'password', 'token', 'secret'];
  return !forbidden.some((k) => keys.includes(k));
}
