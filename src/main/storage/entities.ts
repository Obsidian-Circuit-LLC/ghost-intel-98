/**
 * Cross-case entity registry. A single global registry (dataRoot/entities.json) holds every
 * entity once; each case references entities by id via a per-case sidecar
 * (caseDir/entity-links.json) carrying the Family/Associates/Other bucket plus links to the
 * case's own web links + attachments. This lets the same person/org/wallet be referenced and
 * cross-referenced from many cases that are otherwise worked separately.
 *
 * Dangling references (an entity removed from the registry, or a link/attachment id that no
 * longer exists) are tolerated and dropped at resolution — no cascade deletes, keeping every
 * operation additive and crash-safe.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EntityLink,
  EntityRecord,
  EntityRelationship,
  EntityType,
  ResolvedEntity
} from '@shared/types';
import { casesDir, caseDir, caseFile, dataRoot } from './paths';
import { withLock } from '../util/mutex';
import { secureReadText, secureWriteFile } from './secure-fs';

function nowIso(): string { return new Date().toISOString(); }
function registryFile(): string { return join(dataRoot(), 'entities.json'); }
function linksFile(caseId: string): string { return join(caseDir(caseId), 'entity-links.json'); }

async function readJsonArr<T>(path: string): Promise<T[]> {
  try {
    return JSON.parse(await secureReadText(path)) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeJsonArr<T>(path: string, list: T[]): Promise<void> {
  await secureWriteFile(path, JSON.stringify(list, null, 2));
}

// ---------- registry ----------

export async function listAll(): Promise<EntityRecord[]> {
  return withLock('entities', () => readJsonArr<EntityRecord>(registryFile()));
}

/** Merge imported entity records into the registry (used by per-case bundle import). Adds any
 *  record whose id isn't already present; existing ids are left as-is (recipient wins). */
export async function importEntities(records: EntityRecord[]): Promise<void> {
  return withLock('entities', async () => {
    const all = await readJsonArr<EntityRecord>(registryFile());
    const have = new Set(all.map((e) => e.id));
    let changed = false;
    for (const r of records) {
      if (r && typeof r.id === 'string' && !have.has(r.id)) { all.push(r); have.add(r.id); changed = true; }
    }
    if (changed) await writeJsonArr(registryFile(), all);
  });
}

export async function create(input: { type: EntityType; value: string; notes?: string; aliases?: string[] }): Promise<EntityRecord> {
  return withLock('entities', async () => {
    const all = await readJsonArr<EntityRecord>(registryFile());
    const rec: EntityRecord = {
      id: `ent-${randomUUID()}`,
      type: input.type,
      value: input.value,
      notes: input.notes ?? '',
      aliases: input.aliases ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    all.push(rec);
    await writeJsonArr(registryFile(), all);
    return rec;
  });
}

export async function update(id: string, patch: Partial<Pick<EntityRecord, 'type' | 'value' | 'notes' | 'aliases'>>): Promise<EntityRecord> {
  return withLock('entities', async () => {
    const all = await readJsonArr<EntityRecord>(registryFile());
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Entity not found: ${id}`);
    const next: EntityRecord = { ...all[idx], ...patch, updatedAt: nowIso() };
    all[idx] = next;
    await writeJsonArr(registryFile(), all);
    return next;
  });
}

export async function remove(id: string): Promise<void> {
  return withLock('entities', async () => {
    const all = await readJsonArr<EntityRecord>(registryFile());
    await writeJsonArr(registryFile(), all.filter((e) => e.id !== id));
  });
}

/** Fold mergeId into keepId: record provenance + absorb the merged value/aliases, delete the
 *  merged record, and repoint every case's link from mergeId to keepId (de-duping). */
export async function merge(keepId: string, mergeId: string): Promise<EntityRecord> {
  if (keepId === mergeId) throw new Error('Cannot merge an entity into itself');
  const kept = await withLock('entities', async () => {
    const all = await readJsonArr<EntityRecord>(registryFile());
    const keep = all.find((e) => e.id === keepId);
    const merged = all.find((e) => e.id === mergeId);
    if (!keep || !merged) throw new Error('Both entities must exist to merge');
    const aliases = Array.from(new Set([...keep.aliases, merged.value, ...merged.aliases].filter((a) => a && a !== keep.value)));
    const next: EntityRecord = {
      ...keep,
      aliases,
      mergedFrom: Array.from(new Set([...(keep.mergedFrom ?? []), mergeId])),
      updatedAt: nowIso()
    };
    await writeJsonArr(registryFile(), all.filter((e) => e.id !== mergeId).map((e) => (e.id === keepId ? next : e)));
    return next;
  });
  // Repoint links in every case (each under its own lock).
  let caseIds: string[] = [];
  try { caseIds = await readdir(casesDir()); } catch { caseIds = []; }
  for (const caseId of caseIds) {
    await withLock(`entity-links:${caseId}`, async () => {
      const links = await readJsonArr<EntityLink>(linksFile(caseId));
      if (!links.some((l) => l.entityId === mergeId)) return;
      const byEntity = new Map<string, EntityLink>();
      for (const l of links) {
        const targetId = l.entityId === mergeId ? keepId : l.entityId;
        const existing = byEntity.get(targetId);
        if (existing) {
          existing.linkIds = Array.from(new Set([...existing.linkIds, ...l.linkIds]));
          existing.attachmentFileNames = Array.from(new Set([...existing.attachmentFileNames, ...l.attachmentFileNames]));
          existing.relationship = existing.relationship ?? l.relationship;
        } else {
          byEntity.set(targetId, { ...l, entityId: targetId });
        }
      }
      await writeJsonArr(linksFile(caseId), [...byEntity.values()]);
    });
  }
  return kept;
}

// ---------- per-case links ----------

export async function linkToCase(
  caseId: string,
  entityId: string,
  opts: { relationship?: EntityRelationship; linkIds?: string[]; attachmentFileNames?: string[] }
): Promise<void> {
  return withLock(`entity-links:${caseId}`, async () => {
    const links = await readJsonArr<EntityLink>(linksFile(caseId));
    const existing = links.find((l) => l.entityId === entityId);
    if (existing) {
      if (opts.relationship !== undefined) existing.relationship = opts.relationship;
      if (opts.linkIds) existing.linkIds = Array.from(new Set([...existing.linkIds, ...opts.linkIds]));
      if (opts.attachmentFileNames) existing.attachmentFileNames = Array.from(new Set([...existing.attachmentFileNames, ...opts.attachmentFileNames]));
    } else {
      links.push({
        entityId,
        relationship: opts.relationship,
        linkIds: opts.linkIds ?? [],
        attachmentFileNames: opts.attachmentFileNames ?? [],
        addedAt: nowIso()
      });
    }
    await writeJsonArr(linksFile(caseId), links);
  });
}

export async function unlinkFromCase(caseId: string, entityId: string): Promise<void> {
  return withLock(`entity-links:${caseId}`, async () => {
    const links = await readJsonArr<EntityLink>(linksFile(caseId));
    await writeJsonArr(linksFile(caseId), links.filter((l) => l.entityId !== entityId));
  });
}

export async function setRelationship(caseId: string, entityId: string, relationship: EntityRelationship | null): Promise<void> {
  return withLock(`entity-links:${caseId}`, async () => {
    const links = await readJsonArr<EntityLink>(linksFile(caseId));
    const l = links.find((x) => x.entityId === entityId);
    if (!l) throw new Error('Entity is not linked to this case');
    l.relationship = relationship ?? undefined;
    await writeJsonArr(linksFile(caseId), links);
  });
}

/** Resolve a case's links against the registry (drops dangling). Lock-free read — used on the
 *  case read path (loadFullCase). */
export async function resolveCaseEntities(caseId: string): Promise<ResolvedEntity[]> {
  const [links, registry] = await Promise.all([
    readJsonArr<EntityLink>(linksFile(caseId)),
    readJsonArr<EntityRecord>(registryFile())
  ]);
  const byId = new Map(registry.map((e) => [e.id, e]));
  const out: ResolvedEntity[] = [];
  for (const l of links) {
    const entity = byId.get(l.entityId);
    if (!entity) continue; // dangling — tolerated
    out.push({ entity, relationship: l.relationship, linkIds: l.linkIds, attachmentFileNames: l.attachmentFileNames });
  }
  return out;
}

/** Which other cases reference this entity (for cross-case navigation). */
export async function casesForEntity(entityId: string): Promise<{ caseId: string; title: string }[]> {
  let caseIds: string[] = [];
  try { caseIds = await readdir(casesDir()); } catch { return []; }
  const out: { caseId: string; title: string }[] = [];
  for (const caseId of caseIds) {
    const links = await readJsonArr<EntityLink>(linksFile(caseId));
    if (!links.some((l) => l.entityId === entityId)) continue;
    let title = caseId;
    try {
      const meta = JSON.parse(await secureReadText(caseFile(caseId))) as { title?: string };
      if (meta.title) title = meta.title;
    } catch { /* keep id as title */ }
    out.push({ caseId, title });
  }
  return out;
}
