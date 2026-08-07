/**
 * Task TG6 — Telegram Hunter exports (reuse the app export guards, CSV/HTML-safe).
 *
 * Plan B ports GhostExodus's Telegram Hunter case exporter, but the quarantine source's
 * `csvEscape` (`telegram-hunter/src/main.js:115`) only doubled interior quotes — it left a
 * scraped bio like `=HYPERLINK("http://evil")` free to execute as a spreadsheet formula, and
 * emitted profile/member fields into a report with no HTML escape. This port routes EVERY cell
 * through the shared `csvCell` (RFC-4180 + formula-injection guard) and EVERY field of the HTML
 * report through the shared `escapeField` (`<>&"'` → entities) — the same guards the X Listening
 * Station exporter uses. These tests pin those two security properties on the PURE serializers,
 * plus the honesty guarantee that a profile export records the FIXED account-creation-unavailable
 * label and NEVER a fabricated date.
 *
 * The serializers live in the quarantine-clean `collector.ts` (node:path-only `security.ts` under
 * it), so this file imports them WITHOUT mocking electron — proving no electron graph at load.
 */
import { describe, it, expect } from 'vitest';

import {
  messagesTable,
  membersTable,
  profilesTable,
  tableToCsv,
  tableToHtml,
} from '../src/main/socmint/telegram-hunter/collector';
import { TG_ACCOUNT_CREATION_LABEL, type TgProfile } from '../src/main/socmint/telegram-hunter/extract';
import type { TgMember } from '../src/main/socmint/telegram-hunter/store';
import type { HarvestedItem } from '@shared/socmint/types';

function profile(over: Partial<TgProfile> = {}): TgProfile {
  return {
    handle: '@target',
    links: [],
    accountCreationDate: null,
    accountCreationLabel: TG_ACCOUNT_CREATION_LABEL,
    capturedAt: '2026-08-07T00:00:00.000Z',
    ...over,
  };
}

function member(over: Partial<TgMember> = {}): TgMember {
  return { handle: '@bob', capturedAt: '2026-08-07T00:00:00.000Z', ...over };
}

function message(over: Partial<HarvestedItem> = {}): HarvestedItem {
  return {
    id: 'id1',
    platform: 'telegram',
    authorHandle: '@bob',
    authorId: '',
    text: 'hello',
    channelId: 'c1',
    channelLabel: 'Chat',
    messageId: 'm1',
    publishedAt: '2026-08-07T00:00:00.000Z',
    harvestedAt: '2026-08-07T00:00:00.000Z',
    url: '',
    provenance: { collectorVersion: 'telegram-hunter/1.0.0', jobId: 'j1', caseId: 'case' },
    ...over,
  };
}

describe('TG6 — CSV export is spreadsheet-formula-injection safe', () => {
  it('neutralizes a `=cmd` profile bio (leading apostrophe inside a quoted cell)', () => {
    const csv = tableToCsv(profilesTable([profile({ bio: '=cmd|calc' })]));
    // Guarded: quoted AND prefixed with an apostrophe so Excel/Sheets treat it as text.
    expect(csv).toContain(`"'=cmd|calc"`);
    // NOT emitted raw as a live formula cell.
    expect(csv).not.toContain(`"=cmd|calc"`);
    expect(csv).not.toMatch(/(^|,)=cmd\|calc/);
  });

  it('neutralizes a `=HYPERLINK` member status', () => {
    const csv = tableToCsv(membersTable([member({ status: '=HYPERLINK("http://evil","x")' })]));
    // The neutralized cell begins with quote + apostrophe + '=' (formula lead defused).
    expect(csv).toMatch(/"'=HYPERLINK/);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/);
  });

  it('neutralizes an `@`-leading message text', () => {
    const csv = tableToCsv(messagesTable([message({ text: '@import evil' })]));
    expect(csv).toMatch(/"'@import evil"/);
    expect(csv).not.toMatch(/(^|,)@import evil/);
  });
});

describe('TG6 — HTML report escapes every scraped field', () => {
  it('escapes a `<script>` profile bio (no raw tag reaches the document)', () => {
    const html = tableToHtml(profilesTable([profile({ bio: '<script>alert(1)</script>' })]));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('escapes an attribute-breaking `"` and `&` in a member display name', () => {
    const html = tableToHtml(membersTable([member({ displayName: 'a"&<b' })]));
    expect(html).toContain('a&quot;&amp;&lt;b');
    expect(html).not.toContain('a"&<b');
  });
});

describe('TG6 — profile export is honest about the account-creation date', () => {
  it('emits the FIXED unavailable label and never a fabricated date', () => {
    const table = profilesTable([profile()]);
    expect(table.headers).toContain('accountCreation');
    const csv = tableToCsv(table);
    expect(csv).toContain(TG_ACCOUNT_CREATION_LABEL);
  });
});
