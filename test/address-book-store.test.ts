import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { rm } from 'node:fs/promises';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-address-book-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { list, read, save, remove, search } from '../src/main/storage/address-book';

beforeEach(async () => {
  await rm('/tmp/ga98-address-book-test', { recursive: true, force: true });
});

const c = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });

describe('alphabetisation', () => {
  it('sorts by NAME, never by alias', async () => {
    // His spec is explicit: "alphabetized by Name despite if they have an alias". An alias that
    // sorts earlier must not move the row.
    await save(c('Zara Quinn', { alias: 'Aardvark' }));
    await save(c('Adam Fell', { alias: 'Zulu' }));
    await save(c('Mira Vale'));

    expect((await list()).map((r) => r.name)).toEqual(['Adam Fell', 'Mira Vale', 'Zara Quinn']);
  });

  it('orders case- and accent-insensitively, the way a person reads a list', async () => {
    await save(c('ábel Nagy'));
    await save(c('Aaron Blake'));
    await save(c('zoe Ray'));
    expect((await list()).map((r) => r.name)).toEqual(['Aaron Blake', 'ábel Nagy', 'zoe Ray']);
  });
});

describe('the repeatable fields', () => {
  it('keeps every entry the analyst added, in order, unparsed', async () => {
    const saved = await save(c('Ada Lovelace', {
      emails: ['a@x.test', 'b@y.test', 'c@z.test'],
      phones: ['+44 7000 000000', 'ext 12'],
      urls: ['https://example.org', 'not a url but they typed it'],
      socials: ['@ada', 'matrix:@ada:example.org'],
    }));
    expect(saved.emails).toHaveLength(3);
    expect(saved.emails[1]).toBe('b@y.test');
    expect(saved.phones).toEqual(['+44 7000 000000', 'ext 12']);
    // Never normalised into a shape they did not type — an OSINT record stores what was observed.
    expect(saved.urls[1]).toBe('not a url but they typed it');
    expect(saved.socials).toEqual(['@ada', 'matrix:@ada:example.org']);
  });

  it('drops blank rows left behind by the plus button', async () => {
    const saved = await save(c('Grace Hopper', { emails: ['g@navy.test', '', '   '] }));
    expect(saved.emails).toEqual(['g@navy.test']);
  });
});

describe('common contacts are symmetric and retroactive', () => {
  it('linking A to B also links B to A', async () => {
    // "I want that common contact attribution to be retro-active, and attribute the common contact
    // to the other one, too." The STORE owns this, so no UI path can create a one-sided link.
    const a = await save(c('Alice'));
    const b = await save(c('Bob'));

    await save({ ...a, commonContacts: [b.id] });

    expect((await read(a.id))!.commonContacts).toEqual([b.id]);
    expect((await read(b.id))!.commonContacts, 'the back-reference is the whole feature').toEqual([a.id]);
  });

  it('supports as many links as you like, without duplicating', async () => {
    const a = await save(c('Alice'));
    const b = await save(c('Bob'));
    const d = await save(c('Dana'));
    await save({ ...a, commonContacts: [b.id, d.id, b.id] });

    expect((await read(a.id))!.commonContacts.sort()).toEqual([b.id, d.id].sort());
    expect((await read(b.id))!.commonContacts).toEqual([a.id]);
    expect((await read(d.id))!.commonContacts).toEqual([a.id]);
  });

  it('unlinking removes BOTH sides', async () => {
    const a = await save(c('Alice'));
    const b = await save(c('Bob'));
    await save({ ...a, commonContacts: [b.id] });

    await save({ ...(await read(a.id))!, commonContacts: [] });

    expect((await read(a.id))!.commonContacts).toEqual([]);
    expect((await read(b.id))!.commonContacts, 'a half-removed link is a false negative').toEqual([]);
  });

  it('never links a contact to itself, or to an id that does not exist', async () => {
    const a = await save(c('Alice'));
    const saved = await save({ ...a, commonContacts: [a.id, 'no-such-contact'] });
    expect(saved.commonContacts).toEqual([]);
  });

  it('deleting a contact removes it from everyone who referenced it', async () => {
    const a = await save(c('Alice'));
    const b = await save(c('Bob'));
    const d = await save(c('Dana'));
    await save({ ...a, commonContacts: [b.id, d.id] });

    await remove(a.id);

    // A dangling id would render as a blank row in someone else's connections list.
    expect((await read(b.id))!.commonContacts).toEqual([]);
    expect((await read(d.id))!.commonContacts).toEqual([]);
  });

  it('an edit that does not mention commonContacts leaves the links alone', async () => {
    const a = await save(c('Alice'));
    const b = await save(c('Bob'));
    await save({ ...a, commonContacts: [b.id] });

    await save({ id: a.id, name: 'Alice Renamed' });

    expect((await read(a.id))!.commonContacts, 'omitting a field must not silently unlink').toEqual([b.id]);
    expect((await read(b.id))!.commonContacts).toEqual([a.id]);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await save(c('Ada Lovelace', {
      alias: 'Enchantress', emails: ['ada@analytical.test'], occupation: 'Mathematician',
      skills: 'analytical engines', notes: 'met at the symposium', thoughts: 'sharp',
    }));
    await save(c('Bob Stone', { occupation: 'Locksmith', skills: 'physical entry' }));
  });

  it('matches across every text field, case-insensitively', async () => {
    for (const q of ['ada', 'ENCHANTRESS', 'analytical.test', 'mathematician', 'symposium', 'sharp']) {
      expect((await search(q)).map((r) => r.name), `query: ${q}`).toEqual(['Ada Lovelace']);
    }
  });

  it('returns everything for an empty query, still alphabetised', async () => {
    expect((await search('   ')).map((r) => r.name)).toEqual(['Ada Lovelace', 'Bob Stone']);
  });

  it('returns nothing rather than guessing when there is no match', async () => {
    expect(await search('locksmithery-that-nobody-typed')).toEqual([]);
  });
});

describe('the record itself', () => {
  it('mints an id and timestamps on first save, and keeps createdAt on edit', async () => {
    const first = await save(c('Ada'));
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.createdAt).toBe(first.updatedAt);

    const edited = await save({ id: first.id, name: 'Ada Lovelace' });
    expect(edited.id).toBe(first.id);
    expect(edited.createdAt).toBe(first.createdAt);
    expect(new Date(edited.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
  });

  it('carries the bio picture and the album, in order', async () => {
    const saved = await save(c('Ada', {
      bioPicRef: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png',
      photoRefs: ['1111.jpg', '2222.jpg', '3333.jpg'],
    }));
    expect(saved.bioPicRef).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png');
    expect(saved.photoRefs).toEqual(['1111.jpg', '2222.jpg', '3333.jpg']);
  });

  it('refuses a nameless contact rather than storing an unfindable row', async () => {
    await expect(save(c('   '))).rejects.toThrow(/name/i);
  });
});
