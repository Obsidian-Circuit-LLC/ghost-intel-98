/**
 * Pluggable search-engine registry. Q's `[SEARCH:]` loop resolves the operator-selected engine by id
 * and calls its `run()`; every engine is a self-contained descriptor (endpoint + parser + egress class)
 * so a broken parser for one engine can never affect another. This is a behavior-preserving refactor of
 * the previously hard-wired DuckDuckGo search into the first entry of the registry — nothing about DDG's
 * onion enforcement, parsing, or fail-closed posture changes.
 *
 * Egress class (`tor` = onion-to-onion, IP-hidden, `.onion`-enforced fail-closed; `clearnet` = opt-in,
 * deanon-warned) is declared per engine and enforced by the loop. Results from every engine remain
 * UNTRUSTED downstream (fenced in ai.ts) regardless of which engine produced them.
 */
import type { WebResult, SearchReason } from './ddg';
import { ddgEngine } from './ddg';
import { searxngEngine } from './searxng';
export { ddgEngine, searxngEngine };
import type { torFetch, ensurePluginTor } from '../../plugins/tor-egress';

/** Injectable per-run dependencies. `endpoint` selects/overrides the engine's onion instance (still
 *  `.onion`-enforced by the engine); `fetch`/`ensure` are injected in tests. */
export interface EngineRunDeps {
  caseId?: string;
  endpoint?: string;
  fetch?: typeof torFetch;
  ensure?: typeof ensurePluginTor;
}

export interface SearchEngine {
  id: string;
  label: string;
  egress: 'tor' | 'clearnet';
  run(query: string, deps?: EngineRunDeps): Promise<{ results: WebResult[]; reason: SearchReason }>;
}

/** All shipped engines, keyed by id. Both current engines are onion (`egress:'tor'`); the `clearnet`
 *  tier ships empty (no viable clearnet engine — Google/Bing/Yandex block scraping). */
export const SEARCH_ENGINES: Record<string, SearchEngine> = {
  [ddgEngine.id]: ddgEngine,
  [searxngEngine.id]: searxngEngine,
};

/** Resolve an engine by id; an unknown/removed id falls back to DuckDuckGo (the safe onion default),
 *  so a stale settings value can never leave the loop without an engine. */
export function getEngine(id: string): SearchEngine {
  return SEARCH_ENGINES[id] ?? ddgEngine;
}

/** The endpoint the loop passes to `engine.run`. Only SearXNG takes the operator-configurable onion
 *  (`ai.searxngOnion`); every other engine (DDG) uses its own pinned onion default — so the SearXNG
 *  setting can never become the endpoint of a different engine. The engine still `.onion`-enforces
 *  whatever it receives. Returns `undefined` for engines that carry their own default. */
export function endpointForEngine(engine: SearchEngine, searxngOnion: string): string | undefined {
  return engine.id === 'searxng' ? searxngOnion : undefined;
}

/** Human-facing engine name for the transparency line (`🔍 searching <name> over Tor …`) — the bare
 *  engine name without the ` · Tor` egress badge the picker label carries. */
export function engineDisplayName(engine: Pick<SearchEngine, 'label'>): string {
  return engine.label.split(' · ')[0].trim();
}
