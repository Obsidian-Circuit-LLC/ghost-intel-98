/**
 * M3U / M3U8 playlist parsing + serialization (pure functions, no IO).
 * Local relative paths resolve against the playlist's directory; http(s) entries
 * are treated as streams. #EXTINF titles are used as display hints.
 */

import { isAbsolute, resolve, basename } from 'node:path';

export interface M3uItem { title: string; path?: string; url?: string }

export function parseM3u(text: string, baseDir: string): M3uItem[] {
  const out: M3uItem[] = [];
  let pendingTitle: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      pendingTitle = comma >= 0 ? (line.slice(comma + 1).trim() || null) : null;
      continue;
    }
    if (line.startsWith('#')) continue; // #EXTM3U and other directives
    if (/^https?:\/\//i.test(line)) {
      out.push({ title: pendingTitle ?? line, url: line });
    } else {
      const p = isAbsolute(line) ? line : resolve(baseDir, line);
      out.push({ title: pendingTitle ?? basename(p), path: p });
    }
    pendingTitle = null;
  }
  return out;
}

export function toM3u(items: M3uItem[]): string {
  const lines = ['#EXTM3U'];
  for (const it of items) {
    lines.push(`#EXTINF:-1,${it.title}`);
    lines.push(it.url ?? it.path ?? '');
  }
  return lines.join('\n') + '\n';
}
