/**
 * T3: scrapingCases IPC handler factory.
 *
 * A scraping case belongs to one of two isolated per-namespace stores — 'socmint' | 'x'
 * (see src/main/storage/scraping-cases.ts). Every handler here receives a renderer-supplied
 * `store` discriminator and MUST validate it main-side against the allowlist before doing
 * anything else: an unknown value throws (it never silently defaults to a namespace, and it
 * never reaches path construction). This is the security-critical seam of this task — the
 * discriminator selects a filesystem sub-tree, so it is treated as hostile input.
 *
 * The store seam (`getStore`) is injected so the handlers are unit-testable without Electron
 * or the FS. The `importToCase` body (writing a scraping case's items into a main
 * investigation case via the existing caseStore writers) is injected too — its production
 * implementation lands in a later task; T3 only owns the namespace, validation, and routing.
 *
 * This module MUST NOT be imported into src/main/x/** (it references the socmint store), and
 * it imports no bgconn/Tor/collector code — it is pure routing + validation.
 */

import type { ScrapingCaseNs } from '../storage/paths';
import type { ScrapingCaseStore } from '../storage/scraping-cases';
import type { ScrapingCase } from '@shared/types';
import { ensureUuid } from '../security/validate';

/** The only namespaces a scraping-case store may address. Renderer input is checked against this. */
export const SCRAPING_CASE_STORES = ['socmint', 'x'] as const;

/** Thrown when a renderer supplies a `store` discriminator outside the allowlist. */
export class InvalidScrapingStoreError extends Error {
  constructor(value: unknown) {
    super(`Invalid scraping-case store: ${JSON.stringify(value)} (expected 'socmint' | 'x')`);
    this.name = 'InvalidScrapingStoreError';
  }
}

/** Validate a renderer-supplied `store` discriminator against the allowlist. Throws on any
 *  other value — the caller must never reach path/store resolution with an unvalidated string. */
export function assertScrapingStore(value: unknown): ScrapingCaseNs {
  if (value === 'socmint' || value === 'x') return value;
  throw new InvalidScrapingStoreError(value);
}

/** Sanitise a user-supplied case name: strip control chars, trim, require non-empty, cap length.
 *  A name is stored inside case.json only (never used as a path), so this is content hygiene. */
function ensureScrapingName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Scraping-case name must be a string');
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (clean.length === 0) throw new Error('Scraping-case name required');
  return clean;
}

export interface ScrapingImportResult {
  /** Number of items written into the target main case. */
  imported: number;
}

export interface ScrapingCasesIpcDeps {
  /** Resolve the store for a validated namespace (prod: prodScrapingCaseStore; tests: mocks). */
  getStore(ns: ScrapingCaseNs): Promise<ScrapingCaseStore> | ScrapingCaseStore;
  /** Import a scraping case's items into a main investigation case (body lands in a later task). */
  importToCase(ns: ScrapingCaseNs, scrapingCaseId: string, mainCaseId: string): Promise<ScrapingImportResult>;
}

export interface ScrapingCasesHandlers {
  list(store: unknown): Promise<ScrapingCase[]>;
  create(store: unknown, name: unknown): Promise<ScrapingCase>;
  rename(store: unknown, id: unknown, name: unknown): Promise<ScrapingCase>;
  remove(store: unknown, id: unknown): Promise<void>;
  importToCase(store: unknown, scrapingCaseId: unknown, mainCaseId: unknown): Promise<ScrapingImportResult>;
}

/** Build the five scrapingCases handlers over an injected store seam. Each validates the `store`
 *  discriminator first (throwing before any store/import work) and each id as a UUID (path-safe). */
export function createScrapingCasesHandlers(deps: ScrapingCasesIpcDeps): ScrapingCasesHandlers {
  return {
    async list(store) {
      const s = await deps.getStore(assertScrapingStore(store));
      return s.list();
    },
    async create(store, name) {
      const s = await deps.getStore(assertScrapingStore(store));
      return s.create(ensureScrapingName(name));
    },
    async rename(store, id, name) {
      const s = await deps.getStore(assertScrapingStore(store));
      return s.rename(ensureUuid(id, 'scrapingCaseId'), ensureScrapingName(name));
    },
    async remove(store, id) {
      const s = await deps.getStore(assertScrapingStore(store));
      return s.remove(ensureUuid(id, 'scrapingCaseId'));
    },
    async importToCase(store, scrapingCaseId, mainCaseId) {
      const ns = assertScrapingStore(store);
      return deps.importToCase(
        ns,
        ensureUuid(scrapingCaseId, 'scrapingCaseId'),
        ensureUuid(mainCaseId, 'caseId'),
      );
    },
  };
}
