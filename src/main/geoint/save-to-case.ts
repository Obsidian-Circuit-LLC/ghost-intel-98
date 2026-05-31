/**
 * Orchestrates saving a GeoINT event into a case. Composes the existing self-locking
 * case/entity/note stores (so it holds no lock itself). Forms: a saved-event record, a
 * web-link, or a note. Auto-creates/links a `location` entity from the matched place name,
 * links any manually-chosen entities, and emits a `geo-event` timeline entry. Local only.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { caseStore, noteStore } from '../storage/json-fs';
import * as entities from '../storage/entities';
import { addCaseEvent } from './case-events';

export interface SaveToCaseOpts { form: 'record' | 'link' | 'note'; entityIds?: string[] }

function isHttp(u: string | undefined): u is string {
  if (!u) return false;
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

export async function saveToCase(caseId: string, item: GeoItem, opts: SaveToCaseOpts): Promise<{ savedEventId?: string }> {
  let savedEventId: string | undefined;

  if (opts.form === 'record') {
    savedEventId = (await addCaseEvent(caseId, item)).id;
  } else if (opts.form === 'link') {
    if (!isHttp(item.link)) throw new Error('This event has no http(s) link to save as a bookmark.');
    await caseStore.addLink(caseId, item.link, item.title);
  } else {
    const coords = item.lat != null && item.lon != null ? `\n\ncoords: ${item.lat}, ${item.lon}` : '';
    const link = item.link ? `\n\n${item.link}` : '';
    const body = `${item.title}\n\n${item.summary ?? ''}${link}${coords}`;
    await noteStore.write(caseId, `GeoINT — ${item.title}`.slice(0, 80), body);
  }

  // Auto location-entity (find-or-create by type+value), then any manual entities.
  if (item.place) {
    const all = await entities.listAll();
    const existing = all.find((e) => e.type === 'location' && e.value === item.place);
    const id = existing ? existing.id : (await entities.create({ type: 'location', value: item.place })).id;
    await entities.linkToCase(caseId, id, {});
  }
  for (const eid of opts.entityIds ?? []) await entities.linkToCase(caseId, eid, {});

  await caseStore.addTimeline(caseId, { kind: 'geo-event', message: `Saved GeoINT event: ${item.title}` });
  return { savedEventId };
}
