// @vitest-environment jsdom
/**
 * Address Book UI — the behaviours GhostExodus asked for by name.
 *
 * The two rules worth pinning here are the ones the screen must NOT re-decide:
 *   - the list renders the store's order (alphabetical by NAME, never alias); sorting again in the
 *     component would be a second opinion that could drift from the first.
 *   - a common contact is symmetric IN THE STORE. This screen sends the links for the contact being
 *     edited and re-reads. It must never offer a self-link, and it must not silently drop links it
 *     was not asked to change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddressBookModule } from '../src/renderer/modules/address-book/AddressBookModule';
import type { Contact, ContactSummary } from '@shared/address-book';

let container: HTMLDivElement;
let root: Root;

const summary = (id: string, name: string, alias = ''): ContactSummary => ({
  id, name, alias, occupation: '', bioPicRef: null, commonContactCount: 0, updatedAt: 'T',
});

const contact = (id: string, name: string, extra: Partial<Contact> = {}): Contact => ({
  id, name, alias: '', emails: [], phones: [], urls: [], socials: [],
  occupation: '', skills: '', notes: '', thoughts: '',
  bioPicRef: null, photoRefs: [], commonContacts: [],
  createdAt: 'T', updatedAt: 'T', ...extra,
});

const saved: unknown[] = [];

function installApi(rows: ContactSummary[], contacts: Record<string, Contact>): void {
  (window as unknown as { api: unknown }).api = {
    addressBook: {
      search: vi.fn(async () => rows),
      list: vi.fn(async () => rows),
      read: vi.fn(async (id: string) => contacts[id] ?? null),
      save: vi.fn(async (input: unknown) => { saved.push(input); return { ...contacts[(input as Contact).id] ?? contact('new-1', 'New'), ...(input as object) } as Contact; }),
      delete: vi.fn(async () => undefined),
      putAsset: vi.fn(async () => 'asset-1.png'),
      getAsset: vi.fn(async () => null),
    },
  };
}

beforeEach(() => {
  saved.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => { root.render(<AddressBookModule />); });
}

function click(el: Element | null | undefined): void {
  act(() => { (el as HTMLElement).click(); });
}

describe('the contact list', () => {
  it('renders the store order and never re-sorts by alias', async () => {
    // The store returns name order; a contact whose ALIAS sorts first must not jump the queue.
    installApi([summary('1', 'Adam Fell', 'Zulu'), summary('2', 'Zara Quinn', 'Aardvark')], {});
    await render();
    const names = Array.from(container.querySelectorAll('.ga98-list strong')).map((n) => n.textContent);
    expect(names).toEqual(['Adam Fell', 'Zara Quinn']);
  });

  it('asks the store to search rather than filtering in the browser', async () => {
    installApi([summary('1', 'Ada')], {});
    await render();
    const search = container.querySelector('input[aria-label="Search contacts"]') as HTMLInputElement;
    await act(async () => {
      // React tracks the last value it set on the node, so assigning `.value` directly is a no-op
      // for onChange. Go through the native setter the way React's own test utils do.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'loves');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const api = (window as unknown as { api: { addressBook: { search: ReturnType<typeof vi.fn> } } }).api;
    expect(api.addressBook.search).toHaveBeenCalledWith('loves');
  });
});

describe('the repeatable fields', () => {
  it('adds another row when the plus button is used', async () => {
    installApi([summary('1', 'Ada')], { 1: contact('1', 'Ada', { emails: ['a@x.test'] }) });
    await render();
    click(container.querySelector('.ga98-list li'));
    await act(async () => {});

    const emailRows = () => container.querySelectorAll('input[aria-label^="Email "]');
    expect(emailRows()).toHaveLength(1);

    const emailFieldset = Array.from(container.querySelectorAll('fieldset'))
      .find((f) => f.querySelector('legend')?.textContent === 'Email')!;
    click(Array.from(emailFieldset.querySelectorAll('button')).at(-1));
    await act(async () => {});
    expect(emailRows(), 'the plus button is how he adds a second address').toHaveLength(2);
  });

  it('shows one empty row for a contact with none, so the first entry needs no plus', async () => {
    installApi([summary('1', 'Ada')], { 1: contact('1', 'Ada') });
    await render();
    click(container.querySelector('.ga98-list li'));
    await act(async () => {});
    expect(container.querySelectorAll('input[aria-label^="Phone "]')).toHaveLength(1);
  });
});

describe('common contacts', () => {
  it('never offers the contact itself, nor anyone already linked', async () => {
    const rows = [summary('1', 'Ada'), summary('2', 'Bob'), summary('3', 'Cleo')];
    installApi(rows, { 1: contact('1', 'Ada', { commonContacts: ['2'] }) });
    await render();
    click(container.querySelector('.ga98-list li'));
    await act(async () => {});

    const options = Array.from(container.querySelectorAll('select option')).map((o) => o.textContent);
    expect(options).toContain('Cleo');
    expect(options, 'a contact cannot know themselves').not.toContain('Ada');
    expect(options, 'already linked — offering it again invites a duplicate').not.toContain('Bob');
  });

  it('sends the links with the save so the store can mirror them', async () => {
    installApi([summary('1', 'Ada'), summary('2', 'Bob')], { 1: contact('1', 'Ada', { commonContacts: ['2'] }) });
    await render();
    click(container.querySelector('.ga98-list li'));
    await act(async () => {});

    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save');
    click(save);
    await act(async () => {});

    expect(saved).toHaveLength(1);
    // The screen states the links for THIS contact; the back-references are the store's job.
    expect((saved[0] as Contact).commonContacts).toEqual(['2']);
  });

  it('cannot link until the contact exists, and says why', async () => {
    installApi([summary('1', 'Ada')], {});
    await render();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'New'));
    await act(async () => {});

    const select = container.querySelector('select') as HTMLSelectElement;
    // A link needs two ids. Offering the dropdown before the first save would produce a link the
    // store must then refuse — better to say so than to fail silently after the fact.
    expect(select.disabled).toBe(true);
    expect(select.textContent).toMatch(/save first/i);
  });
});

describe('the album', () => {
  it('invites a drop when the contact has no photos yet', async () => {
    installApi([summary('1', 'Ada')], { 1: contact('1', 'Ada') });
    await render();
    click(container.querySelector('.ga98-list li'));
    await act(async () => {});
    expect(container.textContent).toMatch(/drag photos here/i);
  });
});
