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
import { resolveTransport, type SocmintTransport } from './tor-identity';
// WA_SEALED_MESSAGE is no longer thrown here (§5.5 de-sealed 2026-06-27); it is
// still exported by whatsapp-collector.ts for audit-trail purposes.
import type { WaSocketLike, WaConnectionUpdate } from './whatsapp-collector';
import type { WhatsAppAuthState } from './whatsapp-auth';

// ---------------------------------------------------------------------------
// CollectorFactory type — injected by register.ts; injectable for gate tests.
// ---------------------------------------------------------------------------

export type CollectorFactory = (opts: { burnerId: string; transport: SocmintTransport; harvestedAt: () => string }) => SocmintCollector;

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
  const ranked = await rankByRelevance(keyword, items);
  const { recordJob } = await import('./store');
  const { EMBED_MODEL } = await import('../services/memory/embeddings');
  await recordJob(caseId, { jobId: randomUUID(), caseId, startedAt: new Date().toISOString(), model: EMBED_MODEL, runtime: 'ollama' });
  return ranked;
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

/** Active job registry (in-process; reset on restart). */
const activeJobs = new Map<string, {
  burnerId: string;
  caseId: string;
  collector: SocmintCollector;
  unsubscribe: () => void;
}>();

/**
 * Start monitoring channels for a case.
 *
 * EGRESS GATE: returns { disabled: true } immediately — without constructing
 * a collector or touching Tor — when settings.socmint.networkEnabled is false.
 * Callers inject `deps` so this function is independently testable (gate test).
 *
 * When the gate is open, transport is resolved AT THE EGRESS BOUNDARY via
 * resolveTransport(). In 'tor' mode this THROWS SocmintTorUnavailableError when
 * Tor is down — never a silent clearnet fallback. In 'direct' mode this is the
 * operator's explicit clearnet choice (settings.socmint.transport='direct').
 *
 * The collector is then constructed, connected, and subscribed strictly downstream
 * of the gate. connect() is the first network-touching operation and runs AFTER
 * the gate check and transport resolution — never before.
 *
 * @param rawReq   { caseId, burnerId, channelIds?, keywords? }
 * @param deps     Injectable for tests: networkEnabled, transport, collectorFactory,
 *                 and optional sendToRenderer for live streaming to the renderer.
 */
export async function handleStartMonitor(
  rawReq: unknown,
  deps: {
    networkEnabled: () => Promise<boolean>;
    transport: () => Promise<'direct' | 'tor'>;
    /** Factory for Telegram (and generic) collectors. */
    collectorFactory: CollectorFactory;
    /**
     * Optional factory for WhatsApp collectors.
     * When provided and the request's `platform` is `'whatsapp'`, this factory
     * is used instead of `collectorFactory`.
     * Production: makeWhatsAppCollector; tests: mock factory.
     */
    whatsappCollectorFactory?: CollectorFactory;
    /** Optional: stream each harvested item to the renderer window via webContents.send. */
    sendToRenderer?: (item: HarvestedItem) => void;
  },
): Promise<{ disabled: true } | { started: true; jobId: string }> {
  // EGRESS GATE: precedes ALL network/collector operations.
  if (!await deps.networkEnabled()) return { disabled: true };

  const req = (rawReq ?? {}) as Record<string, unknown>;
  const { ensureUuid } = await import('../security/validate');
  const caseId = ensureUuid(req.caseId, 'caseId'); // trust boundary, matches sibling handlers
  const rawBurner = typeof req.burnerId === 'string' ? req.burnerId.trim() : '';
  if (!rawBurner) throw new Error('socmint:startMonitor requires burnerId');
  const burnerId = rawBurner.replace(/[/\\]/g, '_'); // basename-sanitise (secretStore key safety)

  // Parse channelIds from the request (trust boundary: filter to strings only).
  const channelIds = Array.isArray(req.channelIds)
    ? (req.channelIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  // Resolve transport AT THE EGRESS BOUNDARY. In 'tor' mode this THROWS
  // SocmintTorUnavailableError when Tor is down — never a silent clearnet fallback.
  // In 'direct' mode this is the operator's explicit clearnet choice.
  const transport = resolveTransport(burnerId, await deps.transport());

  // Select the collector factory based on the requested platform.
  // 'whatsapp' → whatsappCollectorFactory (if wired); everything else → collectorFactory (Telegram).
  const platform = typeof req.platform === 'string' ? req.platform : 'telegram';
  const factory =
    platform === 'whatsapp' && deps.whatsappCollectorFactory != null
      ? deps.whatsappCollectorFactory
      : deps.collectorFactory;

  // Construct the collector with the resolved transport.
  const collector = factory({ burnerId, transport, harvestedAt: () => new Date().toISOString() });

  // Connect — STRICTLY downstream of the gate and transport validation.
  // If connect() or any join() throws, attempt best-effort cleanup before re-throwing.
  try {
    await collector.connect();

    // Join each monitored channel (sequentially — mtcute enforces per-account rate limits).
    for (const channelId of channelIds) {
      await collector.join(channelId);
    }
  } catch (err) {
    // Best-effort cleanup: disconnect the partially-connected collector so we don't leak
    // the underlying TCP/Tor connection. Ignore cleanup errors — the original error wins.
    try { await collector.disconnect(); } catch { /* ignore */ }
    throw err;
  }

  // Subscribe to live items. onItem persists each item to the encrypted store and
  // optionally streams it to the renderer if deps.sendToRenderer is wired.
  // Fire-and-forget (void) so the synchronous subscribe callback signature is satisfied;
  // upsertItems errors are non-fatal for the live stream (items already in store are deduped).
  const onItem = async (item: HarvestedItem): Promise<void> => {
    const { upsertItems } = await import('./store');
    await upsertItems(caseId, [item]);
    deps.sendToRenderer?.(item);
  };
  const unsubscribe = collector.subscribe(channelIds, (item) => { void onItem(item); });

  const jobId = randomUUID();
  activeJobs.set(jobId, { burnerId, caseId, collector, unsubscribe });
  return { started: true, jobId };
}

/**
 * Stop an active monitor job by jobId.
 * Calls the subscriber's unsubscribe function, then disconnects the collector.
 * No-op if the jobId is unknown (already stopped or never started).
 */
export async function handleStopMonitor(jobId: string): Promise<void> {
  const job = activeJobs.get(jobId);
  if (!job) return;
  activeJobs.delete(jobId);
  job.unsubscribe();
  await job.collector.disconnect();
}

// ---------------------------------------------------------------------------
// WhatsApp linking ceremony — IPC handler stubs (WA-T5)
// Bodies are implemented in WA-T6 (hasWhatsappBurner / unlinkWhatsappBurner)
// and WA-T7 (setWhatsappBurnerPairingCode egress gate + sealed adapter).
// ---------------------------------------------------------------------------

const WA_BURNER_KEY_PREFIX = 'socmint.whatsapp.burner.';

/**
 * Request a WhatsApp pairing code for the given burnerId + phone number.
 *
 * EGRESS GATE: returns { disabled: true } when networkEnabled is false —
 * never constructs a socket or touches any network path.
 *
 * De-sealed per §5.5 supply-chain verification COMPLETE (operator sign-off 2026-06-27).
 * Live path (gate open):
 *   resolveTransport → secretStore-backed auth → makeWASocket (SOCKS5 agent if tor) →
 *   requestPairingCode(phone) → return { pairingCode }.
 *   creds.update: auth.saveCreds() (debounced).
 *   connection.update {connection:'open'}: explicit auth.saveCreds() (belt-and-suspenders).
 *
 * CRITICAL: makeWASocket EGRESSES ON CONSTRUCTION — the gate check must complete and
 * return true BEFORE any socket is constructed.
 *
 * The `deps` parameter is injected for testability (mirrors handleStartMonitor).
 */
export async function handleSetWhatsappBurnerPairingCode(
  burnerId: string,
  phone: string,
  deps: {
    networkEnabled: () => Promise<boolean>;
    /** Transport mode resolver; defaults to 'direct' when absent (test convenience). */
    transport?: () => Promise<'direct' | 'tor'>;
    /**
     * Test-only injection: bypass Baileys, SocksProxyAgent, and secretStore.
     * NEVER set in production.
     */
    _inject?: {
      createSocket: (proxyUrl: string | null) => WaSocketLike;
      authState?: WhatsAppAuthState;
    };
  },
): Promise<{ disabled: true } | { pairingCode: string }> {
  // EGRESS GATE — must precede ALL network / library operations.
  if (!await deps.networkEnabled()) return { disabled: true };

  // Resolve transport at the egress boundary. 'tor' throws SocmintTorUnavailableError
  // when Tor is down (fail-closed). 'direct' is the operator's explicit clearnet choice.
  const transportMode = deps.transport != null ? await deps.transport() : 'direct';
  const transport = resolveTransport(burnerId, transportMode);

  let auth: WhatsAppAuthState;
  let sock: WaSocketLike;

  if (deps._inject) {
    // ─── Test path ────────────────────────────────────────────────────────────
    // Bypass real Baileys, SocksProxyAgent, and secretStore.
    const [{ makeWhatsAppAuthState }, { buildBaileysProxy }] = await Promise.all([
      import('./whatsapp-auth'),
      import('./whatsapp-proxy'),
    ]);
    auth =
      deps._inject.authState ??
      makeWhatsAppAuthState(burnerId, {
        read: async () => null,
        write: async () => {},
        delete: async () => {},
      });
    await auth.initialize();
    sock = deps._inject.createSocket(buildBaileysProxy(transport));
  } else {
    // ─── Production path ─────────────────────────────────────────────────────
    // Lazy dynamic imports — sealed-seam / ESM footgun guard (no static Baileys import).
    const [baileysModule, { SocksProxyAgent }, { secretStore: ss }, { makeWhatsAppAuthState }, { buildBaileysProxy }, { buildBaileysSocketConfig }] =
      await Promise.all([
        import('@whiskeysockets/baileys'),
        import('socks-proxy-agent'),
        import('../secrets/index'),
        import('./whatsapp-auth'),
        import('./whatsapp-proxy'),
        import('./whatsapp-collector'),
      ]);
    const { makeWASocket } = baileysModule;

    const authInstance = makeWhatsAppAuthState(burnerId, {
      read: (k) => ss.get(k),
      write: (k, v) => ss.set(k, v),
      delete: (k) => ss.delete(k),
    });
    await authInstance.initialize();
    auth = authInstance;

    const proxyUrl = buildBaileysProxy(transport);
    const agent = proxyUrl !== null ? new SocksProxyAgent(proxyUrl) : undefined;

    // CRITICAL: makeWASocket EGRESSES ON CONSTRUCTION — only reached after gate check.
    type BaileysConfig = Parameters<typeof makeWASocket>[0];
    sock = makeWASocket(
      buildBaileysSocketConfig(transport, auth, agent) as BaileysConfig,
    ) as unknown as WaSocketLike;
  }

  // Register creds.update: persist auth on every Baileys key-ratchet.
  sock.ev.on('creds.update', () => { void auth.saveCreds(); });

  // Register connection.update: belt-and-suspenders saveCreds on open;
  // note fatal loggedOut close (the user must re-link the burner).
  sock.ev.on('connection.update', (update: WaConnectionUpdate) => {
    if (update.connection === 'open') {
      void auth.saveCreds();
    }
    // Fatal close (401): session invalidated — cannot surface back (pairingCode already returned).
    // Future: emit an IPC event via webContents when renderer wiring is in place.
  });

  // requestPairingCode is available immediately after socket construction (before 'open').
  // Guard against missing method (would indicate a library version mismatch).
  if (typeof sock.requestPairingCode !== 'function') {
    throw new Error(
      'SOCMINT: WhatsApp socket.requestPairingCode not available — check library version',
    );
  }
  const pairingCode = await sock.requestPairingCode(phone);
  return { pairingCode };
}

/**
 * Returns true when secretStore holds a non-empty creds blob for the given WhatsApp burnerId.
 * Boolean only — never echoes the stored secret value to the renderer.
 * Returns false on keyring errors; the error will surface properly on the linking call.
 *
 * Storage key: socmint.whatsapp.burner.<safeId>.creds  (set by whatsapp-auth.ts)
 *
 * @param store  Injectable store for tests; defaults to the production secretStore.
 */
export async function handleHasWhatsappBurner(
  burnerId: string,
  store?: { get(key: string): Promise<string | null> },
): Promise<boolean> {
  if (!burnerId) return false;
  const s = store ?? (await import('../secrets/index')).secretStore;
  const safeId = burnerId.replace(/[/\\]/g, '_');
  try {
    const v = await s.get(`${WA_BURNER_KEY_PREFIX}${safeId}.creds`);
    return typeof v === 'string' && v.length > 0;
  } catch {
    // Keyring locked / unavailable — treat as "no usable burner" at the check stage;
    // the real error will surface when the linking ceremony actually runs.
    return false;
  }
}

/**
 * Deletes both secretStore entries for the given WhatsApp burnerId:
 *   socmint.whatsapp.burner.<safeId>.creds  — serialised Baileys AuthenticationCreds
 *   socmint.whatsapp.burner.<safeId>.keys   — serialised Signal key store
 *
 * Does NOT perform server-side unlinking — the analyst must do that manually in
 * WhatsApp → Linked Devices before retiring the burner (per §5.1 of the design).
 *
 * @param store  Injectable store for tests; defaults to the production secretStore.
 */
export async function handleUnlinkWhatsappBurner(
  burnerId: string,
  store?: { delete(key: string): Promise<void> },
): Promise<void> {
  if (!burnerId) return;
  const s = store ?? (await import('../secrets/index')).secretStore;
  const safeId = burnerId.replace(/[/\\]/g, '_');
  await s.delete(`${WA_BURNER_KEY_PREFIX}${safeId}.creds`);
  await s.delete(`${WA_BURNER_KEY_PREFIX}${safeId}.keys`);
}
