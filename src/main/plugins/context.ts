import type { Capability } from '../../shared/plugin-types';

export interface PluginFetchInit { method?: string; headers?: Record<string, string>; body?: string; direct?: boolean; }
export interface PluginFetchResponse { status: number; body: string; finalUrl: string; blocked?: boolean; }

export interface ContextDeps {
  isNetworkEnabled(id: string): boolean;
  rawFetch(url: string, init: PluginFetchInit): Promise<PluginFetchResponse>;
  validateUrl(url: string): string;
  secretBackend: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; delete(k: string): Promise<void> };
  entities: unknown;
  timelineAppend(caseId: string, event: unknown): Promise<void>;
  caseSidecar: { read(caseId: string, name: string): Promise<string | null>; write(caseId: string, name: string, data: string): Promise<void> };
  pluginStore: { read(id: string, rel: string): Promise<Uint8Array | null>; write(id: string, rel: string, data: Uint8Array | string): Promise<void>; list(id: string, rel?: string): Promise<string[]>; delete(id: string, rel: string): Promise<void> };
}

export interface PluginContext {
  readonly id: string;
  readonly logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
  registerHandler(name: string, fn: (...args: unknown[]) => unknown): void;
  egress?: { fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>; isEnabled(): boolean };
  secrets?: { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<void> };
  entities?: unknown;
  timeline?: { append(caseId: string, event: unknown): Promise<void> };
  caseStorage?: { readSidecar(caseId: string, name: string): Promise<string | null>; writeSidecar(caseId: string, name: string, data: string): Promise<void> };
  storage?: { read(rel: string): Promise<Uint8Array | null>; write(rel: string, data: Uint8Array | string): Promise<void>; list(rel?: string): Promise<string[]>; delete(rel: string): Promise<void> };
}

export function createPluginContext(
  id: string,
  capabilities: Capability[],
  deps: ContextDeps,
  handlers: Map<string, (...args: unknown[]) => unknown> = new Map()
): PluginContext {
  const has = (c: Capability): boolean => capabilities.includes(c);
  const ctx: PluginContext = {
    id,
    logger: {
      info: (m) => console.log(`[plugin:${id}]`, m),
      warn: (m) => console.warn(`[plugin:${id}]`, m),
      error: (m) => console.error(`[plugin:${id}]`, m)
    },
    registerHandler(name, fn) { handlers.set(`${id}:${name}`, fn); }
  };

  if (has('egress')) {
    ctx.egress = {
      isEnabled: () => deps.isNetworkEnabled(id),
      async fetch(url, init = {}) {
        if (!deps.isNetworkEnabled(id)) {
          const e = new Error('EEGRESSOFF: plugin network is disabled');
          e.name = 'EEGRESSOFF';
          throw e;
        }
        const safe = deps.validateUrl(url);
        return deps.rawFetch(safe, init);
      }
    };
  }
  if (has('secrets')) {
    ctx.secrets = {
      get: (name) => deps.secretBackend.get(`plugin:${id}:${name}`),
      set: (name, v) => deps.secretBackend.set(`plugin:${id}:${name}`, v),
      delete: (name) => deps.secretBackend.delete(`plugin:${id}:${name}`)
    };
  }
  if (has('entity-registry')) ctx.entities = deps.entities;
  if (has('timeline')) ctx.timeline = { append: (caseId, event) => deps.timelineAppend(caseId, event) };
  if (has('case-storage')) {
    ctx.caseStorage = {
      readSidecar: (caseId, name) => deps.caseSidecar.read(caseId, name),
      writeSidecar: (caseId, name, data) => deps.caseSidecar.write(caseId, name, data)
    };
  }
  if (has('plugin-storage')) {
    ctx.storage = {
      read: (rel) => deps.pluginStore.read(id, rel),
      write: (rel, data) => deps.pluginStore.write(id, rel, data),
      list: (rel) => deps.pluginStore.list(id, rel),
      delete: (rel) => deps.pluginStore.delete(id, rel)
    };
  }
  return ctx;
}
