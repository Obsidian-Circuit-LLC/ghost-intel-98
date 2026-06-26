import { createHash } from 'node:crypto';

import type { SocmintPlatform } from '@shared/socmint/types';

/**
 * Deterministic item ID: SHA-256 hex of `${platform}:${channelId}:${messageId}`.
 * Main-process only — keeps `node:crypto` out of the renderer-safe `src/shared/` tree.
 * Pattern mirrors src/main/services/memory/chunker.ts:22.
 */
export function harvestedItemId(
  platform: SocmintPlatform,
  channelId: string,
  messageId: string
): string {
  return createHash('sha256')
    .update(`${platform}:${channelId}:${messageId}`, 'utf8')
    .digest('hex');
}
