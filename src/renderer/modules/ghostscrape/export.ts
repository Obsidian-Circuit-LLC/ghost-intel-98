/**
 * GhostScrape (Task 7) — pure JSON/TXT/CSV export generators.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native
 * Electron primitives.
 *
 * No DOM, no React, no Electron — importable in the vitest node environment.
 *
 * CSV-injection invariant (mirrors src/renderer/modules/searchlight/report-gen.ts
 * generateCSV): any cell whose string form starts with '=', '+', '-', '@', a
 * tab, or a CR is prefixed with a leading `'` before quoting, so a scraped
 * tweet can never plant a spreadsheet formula when the export is opened in
 * Excel/Sheets. Quotes are doubled per RFC 4180.
 */

import type { GhostScrapeResult } from '@shared/ipc-contracts';

/** JSON export — a direct, round-trippable serialization of the result. */
export function toJson(r: GhostScrapeResult): string {
  return JSON.stringify(r, null, 2);
}

/** Human-readable plaintext export: profile summary (if any) then tweets, newest-first. */
export function toTxt(r: GhostScrapeResult): string {
  const lines: string[] = [];

  if (r.profile) {
    lines.push(`@${r.profile.handle} — ${r.profile.displayName}`);
    if (r.profile.bio) lines.push(r.profile.bio);
    lines.push(
      `Followers: ${r.profile.followers}  Following: ${r.profile.following}  Joined: ${r.profile.joined}`
    );
    lines.push('');
  }

  for (const t of r.tweets) {
    lines.push(`[${t.createdAt}]${t.isRetweet ? ' (RT)' : ''} ${t.text}`);
    lines.push(`  ${t.url}  likes:${t.likeCount} retweets:${t.retweetCount} replies:${t.replyCount}`);
  }

  lines.push('');
  lines.push(`Captured: ${r.captured}${r.partial ? ' (partial — job was cancelled or hit a limit)' : ''}`);
  return lines.join('\n');
}

/** Neutralize spreadsheet formula injection (=, +, -, @, tab, CR lead chars); double quotes. */
function csvCell(v: unknown): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV export of the scraped tweets (formula-injection safe). */
export function toCsv(r: GhostScrapeResult): string {
  const header = 'ID,Created At,Is Retweet,Text,Likes,Retweets,Replies,URL';
  const rows = r.tweets.map((t) =>
    [t.id, t.createdAt, t.isRetweet ? 'YES' : 'NO', t.text, t.likeCount, t.retweetCount, t.replyCount, t.url]
      .map(csvCell)
      .join(',')
  );
  return [header, ...rows].join('\n');
}
