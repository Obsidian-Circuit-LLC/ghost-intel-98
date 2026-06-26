/**
 * SOCMINT IPC handler implementations.
 *
 * Handler functions are exported individually so they can be imported into
 * register.ts (wired to safeHandle) and directly tested (gate unit tests).
 * Handler bodies are kept thin — they delegate to:
 *   store.ts    (upsertItems / listItems / recordJob / listJobs)
 *   rank.ts     (rankByRelevance)
 *   labels.ts   (recordLabel / listLabels)
 *   collector.ts (SocmintCollector interface / makeMtcuteCollector)
 *   secrets     (secretStore — burner credentials, never echoed to renderer)
 *
 * Egress gate:
 *   startMonitor checks settings.socmint.networkEnabled at the main-process
 *   boundary BEFORE constructing a collector or touching any network path.
 *   Non-egress handlers (list/rank/label over already-stored data) run regardless.
 *
 * Burner secrets:
 *   Stored in secretStore under socmint.burner.<id>.* (OS-encrypted, never
 *   plaintext in settings.json, never echoed — hasBurner returns boolean only).
 *
 * Monitored-channel sidecar:
 *   Per-case socmint-channels.json via the same lazy secure-fs pattern as store.ts.
 *   Every read-modify-write is serialised with withLock(key) to prevent corruption.
 */

import { randomUUID } from 'node:crypto';
import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { ItemLabel } from './labels';
import type { SocmintCollector } from './collector';

// ---------------------------------------------------------------------------
// CollectorFactory type — injected by register.ts; injectable for gate tests.
// ---------------------------------------------------------------------------

export type CollectorFactory = (opts: { burnerId: string; harvestedAt: () => string }) => SocmintCollector;

// ---------------------------------------------------------------------------
// Monitored-channel sidecar (lazy secure-fs, per case)
// ---------------------------------------------------------------------------

/** Build the per-case sidecar I/O helpers. Lazy-imported so the module is safe
 *  to import in tests that don't have electron/paths available at load time. */
async function buildChannelSidecar() {
  const [{ join }, { caseDir }, { secureReadFile, secureWriteFile }] = await Promise.all([
    import('node:path'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
  ]);
  return {
    read: async (caseId: string): Promise<MonitoredChannel[]> => {
      try {
        const buf = await secureReadFile(join(caseDir(caseId), 'socmint-channels.json'));
        return JSON.parse(buf.toString('utf8')) as MonitoredChannel[];
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
    },
    write: async (caseId: string, channels: MonitoredChannel[]): Promise<void> => {
      await secureWriteFile(
        join(caseDir(caseId), 'socmint-channels.json'),
        JSON.stringify(channels, null, 2),
      );
    },
  };
}

/**
 * Add or update a monitored channel for a case.
 * If channelId already exists the entry is replaced (upsert semantics).
 * Returns the full updated channel list.
 */
export async function handleAddChannel(caseId: string, rawChannel: unknown): Promise<MonitoredChannel[]> {
  const io = await buildChannelSidecar();
  const { withLock } = await import('../util/mutex');
  return withLock(`socmint-channels:${caseId}`, async () => {
    const existing = await io.read(caseId);
    const ch = (rawChannel ?? {}) as { channelId?: unknown; label?: unknown; keywords?: unknown };
    const channelId = typeof ch.channelId === 'string' ? ch.channelId : '';
    if (!channelId) throw new Error('socmint:addChannel requires channelId');
    const label = typeof ch.label === 'string' ? ch.label : channelId;
    const keywords = Array.isArray(ch.keywords)
      ? (ch.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : [];
    // Remove any existing entry with the same channelId, then append the new one.
    const updated: MonitoredChannel[] = [
      ...existing.filter((c) => c.channelId !== channelId),
      { channelId, label, keywords },
    ];
    await io.write(caseId, updated);
    return updated;
  });
}

/**
 * Remove a monitored channel from a case.
 * Returns the updated channel list. No-op if channelId is not present.
 */
export async function handleRemoveChannel(caseId: string, channelId: string): Promise<MonitoredChannel[]> {
  const io = await buildChannelSidecar();
  const { withLock } = await import('../util/mutex');
  return withLock(`socmint-channels:${caseId}`, async () => {
    const existing = await io.read(caseId);
    const updated = existing.filter((c) => c.channelId !== channelId);
    if (updated.length !== existing.length) {
      await io.write(caseId, updated);
    }
    return updated;
  });
}

/** List all monitored channels for a case in append order. */
export async function handleListChannels(caseId: string): Promise<MonitoredChannel[]> {
  const io = await buildChannelSidecar();
  return io.read(caseId);
}

// ---------------------------------------------------------------------------
// Items + ranking (delegates to store.ts / rank.ts)
// ---------------------------------------------------------------------------

/** List all harvested items for a case in stable (append) order. */
export async function handleListItems(caseId: string): Promise<HarvestedItem[]> {
  const { listItems } = await import('./store');
  return listItems(caseId);
}

/**
 * Rank items stored for a case by keyword relevance.
 * Delegates to rankByRelevance which enforces the loopback-only AI invariant.
 * Returns [] if no items are stored.
 */
export async function handleRankItems(caseId: string, keyword: string): Promise<HarvestedItem[]> {
  const { listItems } = await import('./store');
  const { rankByRelevance } = await import('./rank');
  const items = await listItems(caseId);
  if (items.length === 0) return [];
  return rankByRelevance(keyword, items);
}

// ---------------------------------------------------------------------------
// Analyst labels (delegates to labels.ts)
// ---------------------------------------------------------------------------

/**
 * Record an analyst accept/reject label for a harvested item.
 * Validates the required fields at the IPC boundary; delegates storage to labels.ts.
 */
export async function handleRecordLabel(caseId: string, rawLabel: unknown): Promise<void> {
  const { recordLabel } = await import('./labels');
  const l = (rawLabel ?? {}) as Partial<ItemLabel>;
  if (typeof l.itemId !== 'string' || !l.itemId) {
    throw new Error('socmint:recordLabel requires itemId');
  }
  if (l.decision !== 'accept' && l.decision !== 'reject') {
    throw new Error("socmint:recordLabel requires decision 'accept' or 'reject'");
  }
  const label: ItemLabel = {
    itemId: l.itemId,
    decision: l.decision,
    entityCorrections: Array.isArray(l.entityCorrections) ? l.entityCorrections : undefined,
    labeledAt: typeof l.labeledAt === 'string' ? l.labeledAt : new Date().toISOString(),
  };
  return recordLabel(caseId, label);
}

// ---------------------------------------------------------------------------
// Burner secrets (secretStore, never echoed to renderer)
// ---------------------------------------------------------------------------

const BURNER_KEY_PREFIX = 'socmint.burner.';

/**
 * Store burner credentials in the OS-encrypted secretStore.
 * Accepts { sessionString, apiId?, apiHash? }.
 * NEVER echoes secrets back — hasBurner returns a boolean only.
 */
export async function handleSetBurner(burnerId: string, rawCreds: unknown): Promise<void> {
  if (!burnerId) throw new Error('socmint:setBurner requires burnerId');
  const { secretStore } = await import('../secrets/index');
  const creds = (rawCreds ?? {}) as { sessionString?: unknown; apiId?: unknown; apiHash?: unknown };
  if (typeof creds.sessionString !== 'string' || !creds.sessionString) {
    throw new Error('socmint:setBurner requires sessionString');
  }
  // Sanitise to basename: burner IDs must not contain path separators.
  const safeBurnerId = burnerId.replace(/[/\\]/g, '_');
  await secretStore.set(`${BURNER_KEY_PREFIX}${safeBurnerId}.sessionString`, creds.sessionString);
  if (typeof creds.apiId === 'string' && creds.apiId) {
    await secretStore.set(`${BURNER_KEY_PREFIX}${safeBurnerId}.apiId`, creds.apiId);
  }
  if (typeof creds.apiHash === 'string' && creds.apiHash) {
    await secretStore.set(`${BURNER_KEY_PREFIX}${safeBurnerId}.apiHash`, creds.apiHash);
  }
}

/**
 * Returns true when a sessionString is stored for the given burnerId.
 * Never exposes the secret value — boolean only.
 * Returns false on keyring errors (the actual startMonitor call will surface them).
 */
export async function handleHasBurner(burnerId: string): Promise<boolean> {
  if (!burnerId) return false;
  const { secretStore } = await import('../secrets/index');
  const safeBurnerId = burnerId.replace(/[/\\]/g, '_');
  try {
    const v = await secretStore.get(`${BURNER_KEY_PREFIX}${safeBurnerId}.sessionString`);
    return typeof v === 'string' && v.length > 0;
  } catch {
    // Keyring locked / unavailable — treat as "no usable burner" at the check stage;
    // the error will surface properly when startMonitor actually tries to connect.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Monitor lifecycle — startMonitor is the only egress-causing handler
// ---------------------------------------------------------------------------

/** Active job registry (in-process; reset on restart; v1 only). */
const activeJobs = new Map<string, { burnerId: string; caseId: string }>();

/**
 * Start monitoring channels for a case.
 *
 * EGRESS GATE: returns { disabled: true } immediately — without constructing
 * a collector or touching Tor — when settings.socmint.networkEnabled is false.
 * Callers inject `deps` so this function is independently testable (gate test).
 *
 * When the gate is open, the collector is constructed (which validates Tor via
 * burnerProxyConfig in the sealed adapter). In v1 the sealed seam means connect()
 * throws "not installed" until the operator pins the library (spec §7).
 *
 * @param rawReq   { caseId, burnerId, channelIds, keywords? }
 * @param deps     { networkEnabled, collectorFactory } — injectable for tests
 */
export async function handleStartMonitor(
  rawReq: unknown,
  deps: {
    networkEnabled: () => Promise<boolean>;
    collectorFactory: CollectorFactory;
  },
): Promise<{ disabled: true } | { started: true; jobId: string }> {
  // EGRESS GATE: precedes ALL network/collector operations.
  if (!await deps.networkEnabled()) return { disabled: true };

  const req = (rawReq ?? {}) as Record<string, unknown>;
  const burnerId = typeof req.burnerId === 'string' ? req.burnerId.trim() : '';
  const caseId  = typeof req.caseId  === 'string' ? req.caseId.trim()  : '';
  if (!burnerId) throw new Error('socmint:startMonitor requires burnerId');
  if (!caseId)   throw new Error('socmint:startMonitor requires caseId');

  // Construct the collector (validates proxy config; inherits Tor-required invariant
  // from burnerProxyConfig inside the collector). connect() is a sealed seam in v1
  // and is NOT called here — the factory call is sufficient to validate the burner
  // credentials and Tor availability at construction time for the gate test.
  deps.collectorFactory({ burnerId, harvestedAt: () => new Date().toISOString() });

  const jobId = randomUUID();
  activeJobs.set(jobId, { burnerId, caseId });
  return { started: true, jobId };
}

/**
 * Stop an active monitor job by jobId.
 * Removes the job from the registry. No-op if the jobId is unknown.
 * In v1 there is no live connection to close (sealed seam); the registry
 * is cleared so future startMonitor calls can reuse the slot.
 */
export async function handleStopMonitor(jobId: string): Promise<void> {
  activeJobs.delete(jobId);
}
