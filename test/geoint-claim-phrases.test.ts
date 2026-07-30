import { describe, it, expect } from 'vitest';
import { extractClaimPhrases } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('extractClaimPhrases', () => {
  it('extracts only sentences with casualty/verification vocabulary, verbatim', () => {
    const item = mk({ id: 'T', title: 'x', detail: 'A missile hit the depot. At least five people were killed. Casualties remain unconfirmed. The weather was clear.' });
    const out = extractClaimPhrases(item).map((c) => c.text);
    expect(out).toEqual(['At least five people were killed.', 'Casualties remain unconfirmed.']);
  });

  it('returns [] when there is no body or no claim vocabulary', () => {
    expect(extractClaimPhrases(mk({ id: 'T', title: 'x' }))).toEqual([]);
    expect(extractClaimPhrases(mk({ id: 'T', title: 'x', detail: 'A convoy moved north at dawn.' }))).toEqual([]);
  });

  it('dedupes and caps at 6', () => {
    const s = 'Many were injured.';
    const item = mk({ id: 'T', title: 'x', detail: Array.from({ length: 9 }, (_, n) => `Report ${n}: ${n} were killed.`).join(' ') + ` ${s} ${s}` });
    const out = extractClaimPhrases(item);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.filter((c) => c.text === s).length).toBeLessThanOrEqual(1);
  });
});
