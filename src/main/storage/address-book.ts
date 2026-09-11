/**
 * Address Book store — contacts, their repeatable fields, and the symmetric "common contacts" graph.
 *
 * Persisted under dataRoot via secure-fs, so contacts are encrypted at rest exactly when the app's
 * vault login is on — same as case data, briefcase notes and journal entries. Zero network. Photo
 * bytes live in their own encrypted store (`address-book-assets.ts`), never inline here.
 *
 * THE ONE RULE WORTH READING. GhostExodus's spec: "I want that common contact attribution to be
 * retro-active, and attribute the common contact to the other one, too." So a link is symmetric by
 * construction and the STORE owns it — `save` reconciles both directions on every write, `remove`
 * sweeps the deleted id out of everyone who referenced it, and a link to a non-existent contact or
 * to oneself is refused. Nothing in the renderer can produce a half-link, because the renderer is
 * not consulted. A one-sided link would read as "these two don't know each other" from one side and
 * "they do" from the other, which in an investigative tool is not a cosmetic bug.
 *
 * Shape mirrors journal.ts: one JSON array, serialized read-modify-write, ENOENT means "not written
 * yet" while any other read failure is re-thrown rather than swallowed as empty — a save() does
 * readAll → writeAll, so treating a decrypt error as [] would overwrite an intact-but-unreadable
 * address book with a single contact.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import type { Contact, ContactInput, ContactSummary } from '@shared/address-book';

const MAX_CONTACTS = 20000;
const MAX_NAME = 200;
/** Per repeatable field. Generous — his spec is "add as many as I want" — but not unbounded. */
const MAX_VALUES = 200;
const MAX_VALUE = 2000;
const MAX_TEXT = 20000;
const MAX_PHOTOS = 500;

const bookFile = (): string => join(dataRoot(), 'address-book.json');

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<Contact[]> {
  try {
    const parsed = JSON.parse(await secureReadText(bookFile())) as unknown;
    return Array.isArray(parsed) ? (parsed as Contact[]).map(withDefaults) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // never written yet
    throw err;
  }
}

async function writeAll(list: Contact[]): Promise<void> {
  await secureWriteFile(bookFile(), JSON.stringify(list, null, 2));
}

/** A record read off disk may predate a field; fill in the empty shape rather than emitting
 *  `undefined` into the renderer. Pure read-time view — never written back by this function. */
function withDefaults(raw: Contact): Contact {
  return {
    ...raw,
    alias: raw.alias ?? '',
    emails: raw.emails ?? [],
    phones: raw.phones ?? [],
    urls: raw.urls ?? [],
    socials: raw.socials ?? [],
    affiliations: raw.affiliations ?? [],
    occupation: raw.occupation ?? '',
    skills: raw.skills ?? '',
    notes: raw.notes ?? '',
    thoughts: raw.thoughts ?? '',
    bioPicRef: raw.bioPicRef ?? null,
    photoRefs: raw.photoRefs ?? [],
    commonContacts: raw.commonContacts ?? [],
  };
}

/** Trim, drop the blanks the plus button leaves behind, cap length and count. */
function cleanValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v ?? '').trim().slice(0, MAX_VALUE))
    .filter(Boolean)
    .slice(0, MAX_VALUES);
}

function text(raw: unknown): string {
  return String(raw ?? '').slice(0, MAX_TEXT);
}

/** Alphabetical by NAME — his spec, explicitly regardless of alias. `localeCompare` with
 *  `sensitivity: 'base'` so "ábel" files under A and case never decides the order, which is how a
 *  person reads a list and not how a byte comparison does. */
function byName(a: Contact, b: Contact): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function toSummary(c: Contact): ContactSummary {
  return {
    id: c.id,
    name: c.name,
    alias: c.alias,
    occupation: c.occupation,
    bioPicRef: c.bioPicRef,
    commonContactCount: c.commonContacts.length,
    updatedAt: c.updatedAt,
  };
}

export async function list(): Promise<ContactSummary[]> {
  return (await readAll()).slice().sort(byName).map(toSummary);
}

export async function read(id: string): Promise<Contact | null> {
  return (await readAll()).find((c) => c.id === id) ?? null;
}

/** Every text field a query may match. Notes and thoughts included: an analyst searching for how
 *  they met someone is searching their own words about them. */
function haystack(c: Contact): string {
  return [
    c.name, c.alias, c.occupation, c.skills, c.notes, c.thoughts,
    ...c.emails, ...c.phones, ...c.urls, ...c.socials, ...c.affiliations,
  ].join('\n').toLowerCase();
}

export async function search(query: string): Promise<ContactSummary[]> {
  const q = String(query ?? '').trim().toLowerCase();
  const all = (await readAll()).slice().sort(byName);
  if (!q) return all.map(toSummary);
  return all.filter((c) => haystack(c).includes(q)).map(toSummary);
}

/**
 * Upsert a contact and reconcile the common-contact graph in BOTH directions.
 *
 * `commonContacts` is only touched when the caller actually supplied it — an edit that omits the
 * field (a rename, say) must not read as "unlink everyone", which is the shape of silent data loss
 * a partial update invites.
 */
export async function save(input: ContactInput): Promise<Contact> {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('A contact needs a name.');

  return serialize(async () => {
    const all = await readAll();
    const nowIso = new Date().toISOString();
    const id = input.id && all.some((c) => c.id === input.id) ? input.id : input.id || randomUUID();
    const existing = all.find((c) => c.id === id);

    // Only ids that exist, never self, deduped. A dangling id renders as a blank row in someone
    // else's connections list; a self-link renders as "knows themselves".
    const known = new Set(all.map((c) => c.id));
    const links = input.commonContacts === undefined
      ? (existing?.commonContacts ?? [])
      : [...new Set(
          (Array.isArray(input.commonContacts) ? input.commonContacts : [])
            .map((v) => String(v ?? ''))
            .filter((other) => other && other !== id && known.has(other)),
        )];

    const record: Contact = {
      id,
      name: name.slice(0, MAX_NAME),
      alias: text(input.alias ?? existing?.alias ?? ''),
      emails: input.emails === undefined ? (existing?.emails ?? []) : cleanValues(input.emails),
      phones: input.phones === undefined ? (existing?.phones ?? []) : cleanValues(input.phones),
      urls: input.urls === undefined ? (existing?.urls ?? []) : cleanValues(input.urls),
      socials: input.socials === undefined ? (existing?.socials ?? []) : cleanValues(input.socials),
      affiliations: input.affiliations === undefined ? (existing?.affiliations ?? []) : cleanValues(input.affiliations),
      occupation: text(input.occupation ?? existing?.occupation ?? ''),
      skills: text(input.skills ?? existing?.skills ?? ''),
      notes: text(input.notes ?? existing?.notes ?? ''),
      thoughts: text(input.thoughts ?? existing?.thoughts ?? ''),
      bioPicRef: input.bioPicRef === undefined ? (existing?.bioPicRef ?? null) : (input.bioPicRef || null),
      photoRefs: input.photoRefs === undefined
        ? (existing?.photoRefs ?? [])
        : (Array.isArray(input.photoRefs) ? input.photoRefs.map(String).filter(Boolean).slice(0, MAX_PHOTOS) : []),
      commonContacts: links,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    const linked = new Set(links);
    const next = all
      .filter((c) => c.id !== id)
      .map((c) => {
        const has = c.commonContacts.includes(id);
        // THE RETRO-ACTIVE HALF. Someone this contact now names gains the back-reference; someone
        // dropped from the list loses it. Both directions, on every save.
        if (linked.has(c.id) && !has) return { ...c, commonContacts: [...c.commonContacts, id], updatedAt: nowIso };
        if (!linked.has(c.id) && has) return { ...c, commonContacts: c.commonContacts.filter((x) => x !== id), updatedAt: nowIso };
        return c;
      });

    await writeAll([record, ...next].slice(0, MAX_CONTACTS));
    return record;
  });
}

/** Every contact, full fidelity, alphabetised — the export the analyst can move or back up. Photo
 *  refs travel along with it (portable within THIS install; see `importAll` for why they are
 *  dropped on the way back in on another one). */
export async function exportAll(): Promise<Contact[]> {
  return (await readAll()).slice().sort(byName);
}

export interface ImportResult { added: number; skipped: number; }

/**
 * Import contacts from a previously exported (or hand-built) JSON array. Every row becomes a NEW
 * contact — ids from the file are never reused, so importing the same file twice safely produces
 * two sets rather than colliding with whatever is already in the book. A row with no name is
 * SKIPPED, never aborting the rest of the import over one bad entry.
 *
 * Common-contact links are remapped in a second pass, through an old-id → new-id table built while
 * creating the rows: a link between two contacts that are BOTH in the file survives, symmetrically,
 * through `save()`'s own reconciliation. A link to an id that is not present in the file cannot be
 * resolved on this machine and is dropped — the same discipline `save()` already applies to any
 * unknown id, not a special case for import.
 *
 * Photo refs are never carried over: `address-book-assets/<uuid>.<ext>` on the machine that
 * exported the file is not the folder on the machine reading it back in, so an imported ref would
 * point at nothing. Imported contacts start with no picture; the analyst re-attaches one if needed.
 */
export async function importAll(raw: unknown): Promise<ImportResult> {
  if (!Array.isArray(raw)) throw new Error('Expected a JSON array of contacts.');
  let skipped = 0;
  const idMap = new Map<string, string>();
  const created: Array<{ id: string; name: string; oldLinks: string[] }> = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') { skipped += 1; continue; }
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) { skipped += 1; continue; }
    const rec = await save({
      name,
      alias: text(o.alias),
      emails: cleanValues(o.emails),
      phones: cleanValues(o.phones),
      urls: cleanValues(o.urls),
      socials: cleanValues(o.socials),
      affiliations: cleanValues(o.affiliations),
      occupation: text(o.occupation),
      skills: text(o.skills),
      notes: text(o.notes),
      thoughts: text(o.thoughts),
      bioPicRef: null,
      photoRefs: [],
    });
    if (typeof o.id === 'string' && o.id) idMap.set(o.id, rec.id);
    const oldLinks = Array.isArray(o.commonContacts) ? o.commonContacts.map((v) => String(v ?? '')) : [];
    created.push({ id: rec.id, name: rec.name, oldLinks });
  }

  // Second pass: every imported row now has its NEW id, so links between two imported rows can be
  // resolved. save() needs `name` on every call (its own "a contact needs a name" invariant) — reuse
  // the name we already have rather than re-reading the record.
  for (const row of created) {
    const remapped = row.oldLinks.map((old) => idMap.get(old)).filter((v): v is string => Boolean(v));
    if (remapped.length) await save({ id: row.id, name: row.name, commonContacts: remapped });
  }

  return { added: created.length, skipped };
}

/** Delete a contact and sweep its id out of every other contact's links, so no one is left holding
 *  a reference to somebody who is gone. */
export async function remove(id: string): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const next = all
      .filter((c) => c.id !== id)
      .map((c) => (c.commonContacts.includes(id)
        ? { ...c, commonContacts: c.commonContacts.filter((x) => x !== id) }
        : c));
    if (next.length !== all.length) await writeAll(next);
  });
}
