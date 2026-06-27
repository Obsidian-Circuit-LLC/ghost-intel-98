export type SocmintPlatform = 'telegram' | 'whatsapp' | 'x';

/**
 * Scheme-guard for X/Twitter permalink URLs.
 * Accepts only https://x.com/* and https://twitter.com/* with no userinfo.
 * Returns false for any other scheme, host, or malformed input.
 * Use at the IPC boundary and in the renderer before rendering any harvested url.
 */
export function isXUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    // Reject userinfo — a harvested permalink could spoof the displayed host.
    if (u.username || u.password) return false;
    return u.hostname === 'x.com' || u.hostname === 'twitter.com';
  } catch {
    return false;
  }
}

export interface HarvestedItem {
  /** SHA-256 hex of `${platform}:${channelId}:${messageId}` — deterministic dedup key. */
  id: string;
  platform: SocmintPlatform;
  authorHandle: string;
  authorId: string;
  text: string;
  mediaType?: string;
  mediaRef?: string;
  channelId: string;
  channelLabel: string;
  messageId: string;
  /** ISO timestamp from the platform — never Date.now(). */
  publishedAt: string;
  /** ISO timestamp supplied by the caller (injected clock); not computed inside pure code. */
  harvestedAt: string;
  /** Permalink URL — scheme-guard to http(s) before rendering in the renderer. */
  url: string;
  provenance: {
    collectorVersion: string;
    jobId: string;
    caseId: string;
    keyword?: string;
  };
  /** Absent on raw harvest; filled by the ranking step. */
  relevanceScore?: number;
}

export interface MonitoredChannel {
  channelId: string;
  label: string;
  keywords: string[];
}

export interface SocmintJob {
  jobId: string;
  caseId: string;
  startedAt: string;
  /** Recorded for AI-output provenance — not a determinism claim. */
  model?: string;
  runtime?: string;
  quantization?: string;
}

