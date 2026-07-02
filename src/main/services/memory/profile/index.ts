/**
 * Adaptive-memory profile facade — the single seam `ai.ts` (profile injection at chat time) and
 * the conversation-save path (post-hoc learning) talk to. Wires the pure/tested pieces in this
 * directory — `profile-store`, `reconcile`, `extractor`, `summarizer`, `profile-retriever` — to a
 * real loopback-Ollama completion client and a real clock/id factory.
 *
 * Both exported operations are explicitly best-effort per the memory charter: a failure anywhere
 * in this pipeline (Ollama unreachable, a malformed completion, a store I/O error) must never
 * break a chat or a conversation save, so both `recallProfile` and `learnFromConversation` swallow
 * and degrade gracefully rather than reject.
 *
 * Zero egress beyond loopback: like `../embeddings.ts`, this ALWAYS talks to the bundled runtime's
 * fixed loopback address (`LOCAL_AI_ENDPOINT`), never the user's own-configured (possibly LAN)
 * chat endpoint — extraction/summarization must not depend on what endpoint the user picked for
 * chat, and must never reach further than 127.0.0.1.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { dataRoot } from '../../../storage/paths';
import { secureReadText, secureWriteFile } from '../../../storage/secure-fs';
import { ensureRuntime } from '../../local-ai';
import { LOCAL_AI_ENDPOINT, LOCAL_AI_MODEL } from '../../local-ai-paths';
import { createProfileStore, type ProfileStore } from './profile-store';
import { reconcile } from './reconcile';
import { extractItems, type ExtractorClient } from './extractor';
import { summarizeTurns, capSummary, type SummarizerClient } from './summarizer';
import { selectProfileItems, formatProfileBlock } from './profile-retriever';
import { normalizeItemText, type MemoryItem, type MemoryScope } from './types';
import { withLock } from '../../../util/mutex';

// Every profile read-modify-write (learn + all governance writes) is serialised on this one key.
// The store's put/remove/wipe and the summary file are each read-then-write and the facade chains
// several of them, so without a lock two concurrent learns (one fires per settled turn, each behind
// a slow Ollama call) — or a Memory-panel edit racing a learn — read the same base and the second
// write clobbers the first, losing updates. The slow LLM calls stay OUTSIDE the lock.
const PROFILE_LOCK = 'adaptive-memory-profile';

// ---------- Real loopback-Ollama completion client (shared by extractor + summarizer) ----------

async function ollamaComplete(prompt: string): Promise<string> {
  await ensureRuntime();
  const res = await fetch(`${LOCAL_AI_ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_AI_MODEL, prompt, stream: false }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`Local AI: HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { response?: string };
  return typeof body.response === 'string' ? body.response : '';
}

const realClient: ExtractorClient & SummarizerClient = { complete: ollamaComplete };

// ---------- Per-scope rolling-summary persistence (tiny sibling file to profile.json) ----------

interface SummaryIo {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

function summaryStorePath(): string {
  return join(dataRoot(), 'memory', 'profile-summary.json');
}

function defaultSummaryIo(): SummaryIo {
  const path = summaryStorePath();
  return {
    async read() {
      try {
        return await secureReadText(path);
      } catch {
        return null; // missing / unreadable / locked → treat as "no summaries yet"
      }
    },
    async write(text: string) {
      await secureWriteFile(path, text);
    }
  };
}

function parseSummaries(raw: string | null): Record<string, string> {
  if (raw == null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ---------- Injectable dependencies (real by default; tests override every seam) ----------

interface FacadeDeps {
  store: ProfileStore;
  extractorClient: ExtractorClient;
  summarizerClient: SummarizerClient;
  summaryIo: SummaryIo;
  now(): number;
  newId(): string;
}

function defaultDeps(): FacadeDeps {
  return {
    store: createProfileStore(),
    extractorClient: realClient,
    summarizerClient: realClient,
    summaryIo: defaultSummaryIo(),
    now: () => Date.now(),
    newId: () => randomUUID()
  };
}

// Lazily constructed (never at module load) — like `live-reindex.singleton.ts`'s `getReindexer()`,
// this avoids touching `app.getPath` (via the real store/summary IO) until the facade is actually
// used, so importing this module is always safe regardless of Electron app-ready timing.
let deps: FacadeDeps | null = null;

function getDeps(): FacadeDeps {
  if (!deps) deps = defaultDeps();
  return deps;
}

/** Test-only seam: override any subset of the facade's dependencies (store, LLM clients, clock,
 *  id factory, summary IO) — mirrors the `__set*ForTest` pattern used elsewhere in this module
 *  (e.g. `embeddings.ts`'s `setEmbedderForTest`). */
export function __setProfileFacadeDepsForTest(overrides: Partial<FacadeDeps>): void {
  deps = { ...getDeps(), ...overrides };
}

/** Test-only seam: drop back to real (production) dependencies, reconstructed lazily on next use. */
export function __resetProfileFacadeForTest(): void {
  deps = null;
}

// ---------- Facade ----------

/** `scopesFor()` in `ai.ts` always orders scopes with `'global'` first and the active case scope
 *  (if any) last — so the last entry is the most specific context this conversation happened in,
 *  and is where newly-learned facts/summary updates get attributed. */
function targetScopeOf(scopes: string[]): string {
  return scopes[scopes.length - 1] ?? 'global';
}

/**
 * Look up the profile relevant to `scopes` (deterministic selection, no embedding) plus the
 * rolling summary for those scopes, and render both into a system-context block ready to inject
 * into a chat request. `query` is accepted for interface symmetry with the vector-RAG `recall()`
 * but is not used to filter — profile selection is recency/confidence ranked, not semantic.
 * Never throws: any failure (store I/O, corrupt summary file) degrades to "nothing recalled".
 */
export async function recallProfile(
  _query: string,
  scopes: string[]
): Promise<{ items: MemoryItem[]; summary: string; block: string }> {
  try {
    const d = getDeps();
    const inScope = await d.store.byScope(scopes);
    const items = selectProfileItems(inScope, scopes);
    const summaries = parseSummaries(await d.summaryIo.read());
    const summary = scopes
      .map((s) => summaries[s]?.trim())
      .filter((s): s is string => Boolean(s))
      .join('\n\n');
    return { items, summary, block: formatProfileBlock(items, summary) };
  } catch {
    return { items: [], summary: '', block: '' };
  }
}

/**
 * Learn from a settled conversation: best-effort extract candidate facts, reconcile them into the
 * profile for the most specific of `scopes` (dedupe/reinforce existing items, decay/expire stale
 * ones), persist the result — including actually removing anything reconcile dropped, not just
 * omitting it — and roll that scope's rolling summary forward. Never throws or rejects: a failure
 * anywhere in this pipeline must never break the caller's flow (a conversation save), per the
 * memory charter.
 *
 * `reconcile()` is a pure, single-call function: it decays a survivor by
 * `decayPerDay * daysSince(lastSeenAt)` and returns the decayed confidence WITHOUT advancing
 * `lastSeenAt` for items no candidate matched this call. Because the renderer auto-saves (and
 * this then re-runs) on every settled turn of a conversation, not once per session, persisting
 * that decayed confidence verbatim while leaving `lastSeenAt` untouched would make the very next
 * call re-decay by the same `daysSince(lastSeenAt)` amount again — compounding per *call* rather
 * than per real elapsed day, and wiping out unreinforced items within a single chat session. To
 * keep decay anchored to real elapsed time, every persisted survivor's `lastSeenAt` is checkpointed
 * to `now` here: the next call (however soon after, in real time) then decays only for whatever
 * real time actually elapsed since this checkpoint, not for the same window twice.
 */
export async function learnFromConversation(convoId: string, turns: string, scopes: string[]): Promise<void> {
  try {
    const d = getDeps();
    const scope = targetScopeOf(scopes);
    const provenance = [`conversation:${convoId}`];
    const now = d.now();

    // LLM work (extraction + summarization) runs OUTSIDE the lock — it is slow (~30s Ollama) and
    // best-effort, and must never block a governance action (e.g. Wipe) waiting on the same lock.
    const candidates = await extractItems(d.extractorClient, turns, scope, provenance);
    const prevSummary = parseSummaries(await d.summaryIo.read())[scope] ?? '';
    // summarizeTurns returns the COMPLETE updated summary — it is REPLACED (capped), never folded
    // onto prevSummary (folding duplicated the prior content on every settled turn).
    const nextSummary = await summarizeTurns(d.summarizerClient, prevSummary, turns);

    // Only the fast store + summary read-modify-write is serialised, so concurrent learns and
    // Memory-panel edits can't interleave and lose each other's writes.
    await withLock(PROFILE_LOCK, async () => {
      const existing = await d.store.byScope(scopes);
      const reconciled = reconcile({ existing, candidates, now, newId: d.newId });
      // Checkpoint the decay: whatever confidence reconcile() just computed is now the baseline
      // as of `now`, so the next call's `daysSince(lastSeenAt)` starts from zero real-time elapsed
      // instead of re-decaying the same already-elapsed window.
      const survivors = reconciled.map((it) => (it.lastSeenAt === now ? it : { ...it, lastSeenAt: now }));

      const keep = new Set(survivors.map((it) => it.id));
      const expiredIds = existing.filter((it) => !keep.has(it.id)).map((it) => it.id);
      if (expiredIds.length) await d.store.remove(expiredIds);
      await d.store.put(survivors);

      // Re-read the summary map INSIDE the lock so a concurrent write to a DIFFERENT scope isn't
      // clobbered; replace only this scope's summary with the freshly-distilled full rewrite.
      const cur = parseSummaries(await d.summaryIo.read());
      await d.summaryIo.write(JSON.stringify({ ...cur, [scope]: capSummary(nextSummary, now).text }));
    });
  } catch {
    // best-effort: extraction/reconcile/store/summarization failures must never break the
    // caller's flow (the conversation-save path is not the response hot path, but this is still
    // never allowed to surface — see the memory charter).
  }
}

// ---------- Governance (list / edit / pin / delete / wipe) ----------
//
// Unlike recall/learn above, these are direct, deterministic reads/writes on the profile store —
// there is nothing best-effort about "the user asked to see/edit/erase what was learned", so
// none of the functions below swallow errors: a failure here must surface to the renderer as a
// real error, not a silent no-op, per the memory charter's "nothing learned is silent" invariant.

/** List every item in `scope`, or every item in the profile when `scope` is omitted — the
 *  read side of the governance UI (Task 10's Memory panel "Learned" browser). */
export async function profileList(scope?: MemoryScope): Promise<MemoryItem[]> {
  const d = getDeps();
  return scope === undefined ? d.store.all() : d.store.byScope([scope]);
}

/** Read side of governance for the rolling per-scope summaries (scope → distilled prose). The
 *  summary is durable, injected learned content (see `recallProfile`), so it must be inspectable
 *  in the Memory panel — not just erasable — or it would be a silent, invisible profile. Returns
 *  `{}` when no summary file exists yet. */
export async function profileSummaries(): Promise<Record<string, string>> {
  const d = getDeps();
  return parseSummaries(await d.summaryIo.read());
}

/** User-authored edit/pin: always `source: 'user'`, always `confidence: 1` (user-authoritative,
 *  never subject to reconcile's extractor-confidence gain/decay), text is normalized the same
 *  way extractor candidates are so a user edit still dedupes/matches correctly. Existing
 *  `provenance`/`createdAt` are preserved when editing an item that already exists; a brand-new
 *  id starts a fresh item with `provenance: ['user']`. Returns the full post-upsert item set. */
export async function profileUpsert(item: Pick<MemoryItem, 'id' | 'scope' | 'text' | 'pinned'>): Promise<MemoryItem[]> {
  const d = getDeps();
  const now = d.now();
  return withLock(PROFILE_LOCK, async () => {
    const prior = (await d.store.byScope([item.scope])).find((it) => it.id === item.id);
    const upserted: MemoryItem = {
      id: item.id,
      scope: item.scope,
      text: item.text,
      normalized: normalizeItemText(item.text),
      provenance: prior?.provenance ?? ['user'],
      confidence: 1,
      createdAt: prior?.createdAt ?? now,
      lastSeenAt: now,
      pinned: item.pinned,
      source: 'user'
    };
    await d.store.put([upserted]);
    return d.store.all();
  });
}

/** Erase specific items by id — irreversible, per the "erasable" governance invariant. */
export async function profileDelete(ids: string[]): Promise<void> {
  const d = getDeps();
  await withLock(PROFILE_LOCK, () => d.store.remove(ids));
}

/** Erase every item in `scope`, or the entire profile when `scope` is omitted — AND the matching
 *  rolling summary. The summary is injected learned content (`recallProfile`), so leaving it on
 *  disk after a wipe would silently outlive an explicit erase and keep being pushed into every
 *  chat — a break of the "everything learned is erasable" invariant. Wipe-all drops the whole
 *  summary file; a scoped wipe drops only that scope's key. */
export async function profileWipe(scope?: MemoryScope): Promise<void> {
  const d = getDeps();
  await withLock(PROFILE_LOCK, async () => {
    await d.store.wipe(scope);
    const summaries = parseSummaries(await d.summaryIo.read());
    if (scope === undefined) {
      if (Object.keys(summaries).length > 0) await d.summaryIo.write(JSON.stringify({}));
      return;
    }
    if (scope in summaries) {
      const rest = { ...summaries };
      delete rest[scope];
      await d.summaryIo.write(JSON.stringify(rest));
    }
  });
}
