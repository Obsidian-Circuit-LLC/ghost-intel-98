/**
 * Case-manager copy formatting.
 *
 * REQUEST (GhostExodus, 2026-08-24): "In the case manager, can you create a right click option that
 * allows me to copy the information contained in Web Links and Entities?"
 *
 * Entities already had per-item Copy value / Copy summary; Web links had no right-click at all, and
 * neither section could copy the WHOLE list — which is what "the information contained in" means when
 * you are lifting a case's links or entities into a report.
 *
 * These are the formatters behind those menu items: plain text, no egress, stable ordering.
 */
import { describe, it, expect } from 'vitest';
import { formatLink, formatLinks, formatEntity, formatEntities } from '../src/renderer/modules/cases/copy-text';

const link = (over: Partial<{ id: string; url: string; title: string; addedAt: string }> = {}) => ({
  id: 'l1', url: 'https://example.org/a', title: 'Example A', addedAt: '2026-08-01T00:00:00.000Z', ...over,
});
const ent = (value: string, type = 'person', aliases: string[] = [], notes = '') => ({
  entity: { id: value, type, value, aliases, notes },
});

describe('formatLink', () => {
  it('pairs a title with its url', () => {
    expect(formatLink(link())).toBe('Example A — https://example.org/a');
  });

  it('falls back to the url alone when the title merely repeats it', () => {
    expect(formatLink(link({ title: 'https://example.org/a' }))).toBe('https://example.org/a');
  });

  it('falls back to the url alone when there is no title', () => {
    expect(formatLink(link({ title: '   ' }))).toBe('https://example.org/a');
  });
});

describe('formatLinks', () => {
  it('lists every link, one per line, in the order shown', () => {
    expect(formatLinks([link(), link({ id: 'l2', url: 'https://example.org/b', title: 'B' })]))
      .toBe('Example A — https://example.org/a\nB — https://example.org/b');
  });

  it('returns empty string for no links rather than a stray newline', () => {
    expect(formatLinks([])).toBe('');
  });
});

describe('formatEntity', () => {
  it('renders type, value, aliases and notes', () => {
    const out = formatEntity(ent('Jane Doe', 'person', ['JD'], 'seen in Riga') as never);
    expect(out).toContain('person: Jane Doe');
    expect(out).toContain('aliases: JD');
    expect(out).toContain('notes: seen in Riga');
  });

  it('omits aliases and notes when absent — never prints empty labels', () => {
    const out = formatEntity(ent('acme.example') as never);
    expect(out).not.toMatch(/aliases:/);
    expect(out).not.toMatch(/notes:/);
  });
});

describe('formatEntities', () => {
  it('separates entities with a blank line so a paste stays readable', () => {
    const out = formatEntities([ent('A'), ent('B')] as never);
    expect(out.split('\n\n')).toHaveLength(2);
  });

  it('returns empty string for none', () => {
    expect(formatEntities([])).toBe('');
  });
});
