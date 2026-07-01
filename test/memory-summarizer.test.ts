import { describe, it, expect } from 'vitest';
import { mergeSummary, summarizeTurns, type SummarizerClient } from '../src/main/services/memory/profile/summarizer';

describe('mergeSummary', () => {
  it('appends the addition to a prior summary', () => {
    const out = mergeSummary('Prefers Tor-only egress.', 'Uses a hardware wallet.', 1000);
    expect(out.text).toContain('Prefers Tor-only egress.');
    expect(out.text).toContain('Uses a hardware wallet.');
    expect(out.updatedAt).toBe(1000);
  });

  it('never exceeds maxChars', () => {
    const prev = 'a'.repeat(1000);
    const addition = 'b'.repeat(1000);
    const out = mergeSummary(prev, addition, 1, 1200);
    expect(out.text.length).toBeLessThanOrEqual(1200);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const out1 = mergeSummary('Prefers Tor-only egress.', 'Uses a hardware wallet.', 42);
    const out2 = mergeSummary('Prefers Tor-only egress.', 'Uses a hardware wallet.', 42);
    expect(out1).toEqual(out2);
  });

  it('keeps the newest content when capping — the tail (addition) survives, not the head', () => {
    const prev = 'x'.repeat(1190);
    const addition = 'FRESH-AND-DISTINCTIVE-MARKER';
    const out = mergeSummary(prev, addition, 1, 1200);
    expect(out.text).toContain('FRESH-AND-DISTINCTIVE-MARKER');
    expect(out.text.length).toBeLessThanOrEqual(1200);
  });

  it('trims mid-sentence/mid-word safely: the capped text never starts with a dangling word fragment', () => {
    const prev = 'word'.repeat(400); // no spaces at all near the cut boundary except our own
    const addition = ' the rest of the newest sentence goes here and should be kept intact';
    const out = mergeSummary(prev, addition, 1, 50);
    // Should not start mid-token of the repeated "word" filler; either starts at a space-trimmed
    // boundary or is entirely within the addition's own words.
    expect(out.text.length).toBeLessThanOrEqual(50);
    expect(out.text.startsWith('word')).toBe(false);
  });

  it('handles an empty prior summary (first-ever addition)', () => {
    const out = mergeSummary('', 'First fact learned.', 5);
    expect(out.text).toBe('First fact learned.');
  });

  it('handles an empty addition (no-op merge keeps prior summary)', () => {
    const out = mergeSummary('Existing summary.', '', 5);
    expect(out.text).toBe('Existing summary.');
  });
});

describe('summarizeTurns', () => {
  it('returns the client completion text on success', async () => {
    const client: SummarizerClient = { complete: async () => 'A distilled summary.' };
    const out = await summarizeTurns(client, 'prior summary', 'user: hi\nassistant: hello');
    expect(out).toBe('A distilled summary.');
  });

  it('is best-effort: a throwing client returns the previous summary unchanged', async () => {
    const client: SummarizerClient = {
      complete: async () => {
        throw new Error('ollama unreachable');
      }
    };
    const out = await summarizeTurns(client, 'prior summary', 'user: hi\nassistant: hello');
    expect(out).toBe('prior summary');
  });
});
