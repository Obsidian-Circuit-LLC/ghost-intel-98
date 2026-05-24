/**
 * Renderer-supplied path consent registry. Closes the mail.send arbitrary-attachment
 * exfiltration vector found in the v2.0 audit (red-team Critical #1, skeptic Premise 1).
 *
 * Threat model: a compromised renderer can call IPC freely. Without consent binding,
 * `mail.send` accepting `{path: '/etc/shadow'}` would silently exfil over SMTP. We
 * now require that every attachment path was previously surfaced by either:
 *   (a) `files.pickOpen` — the user clicked through the native dialog, or
 *   (b) `mail.listDrafts` — the renderer is rehydrating a path the user already chose
 *       in a prior session (the draft was persisted by user action).
 *
 * Paths are added to an in-memory Set on those events. Process restart clears the set;
 * persisted drafts re-populate it on next listDrafts call. No TTL — the consent lasts
 * for the session, matching the "I picked this file, I'll send it later" UX.
 */

import { ValidationError } from './validate';

/** LRU-bounded — long-lived sessions don't accumulate every prior pick forever.
 *  Round-3 audit MED: previous Set had no eviction. 1000 is generous for realistic UX. */
const MAX_ENTRIES = 1000;
const consented = new Map<string, true>();

export function markConsented(paths: Iterable<string>): void {
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) continue;
    if (consented.has(p)) {
      // Refresh recency
      consented.delete(p);
    }
    consented.set(p, true);
    if (consented.size > MAX_ENTRIES) {
      const oldest = consented.keys().next().value;
      if (oldest !== undefined) consented.delete(oldest);
    }
  }
}

export function isConsented(path: string): boolean {
  return consented.has(path);
}

/** Throws ValidationError if any path is not in the consent set. */
export function assertAllConsented(paths: string[], context = 'attachment'): void {
  for (const p of paths) {
    if (!isConsented(p)) {
      throw new ValidationError(
        `${context} path was not picked via a file dialog or previously-saved draft — refusing. Use Add file… in the compose window.`
      );
    }
  }
}

/** For tests / hard reset. Production code does not call this. */
export function _clearConsent(): void {
  consented.clear();
}

/** Debug helper — visible in Settings → diagnostics in the future. */
export function consentedCount(): number {
  return consented.size;
}
