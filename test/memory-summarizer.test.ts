import { describe, it, expect } from 'vitest';
import { capSummary, summarizeTurns, type SummarizerClient } from '../src/main/services/memory/profile/summarizer';

describe('capSummary', () => {
  it('returns the trimmed full summary unchanged when within maxChars', () => {
    const out = capSummary('  Prefers Tor-only egress. Uses a hardware wallet.  ', 1000);
    expect(out.text).toBe('Prefers Tor-only egress. Uses a hardware wallet.');
    expect(out.updatedAt).toBe(1000);
  });

  it('never exceeds maxChars', () => {
    const out = capSummary('a '.repeat(2000), 1, 1200);
    expect(out.text.length).toBeLessThanOrEqual(1200);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const out1 = capSummary('Prefers Tor-only egress.', 42);
    const out2 = capSummary('Prefers Tor-only egress.', 42);
    expect(out1).toEqual(out2);
  });

  it('drops the OLDEST content when capping — the newest tail survives', () => {
    const out = capSummary('x '.repeat(700) + 'FRESH-AND-DISTINCTIVE-MARKER', 1, 1200);
    expect(out.text).toContain('FRESH-AND-DISTINCTIVE-MARKER');
    expect(out.text.length).toBeLessThanOrEqual(1200);
  });

  it('snaps the cut to a whitespace boundary — never starts mid-word (fails if snapping reverted)', () => {
    // Raw slice at maxChars=18 of the 25-char string starts inside "bravo" ("ravo charlie delta");
    // boundary-snapping must advance past that fragment to the next whole word "charlie".
    const out = capSummary('alpha bravo charlie delta', 1, 18);
    expect(out.text).toBe('charlie delta');
  });

  it('handles empty / whitespace-only text', () => {
    expect(capSummary('', 5).text).toBe('');
    expect(capSummary('   ', 5).text).toBe('');
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
