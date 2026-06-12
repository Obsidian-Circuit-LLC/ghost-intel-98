import { describe, it, expect } from 'vitest';
import { classify } from '../src/main/geoint/classify';

describe('geoint classify (literal keyword matching)', () => {
  it('classifies a conflict headline with a HIGH severity term', () => {
    // 'airstrike' → conflict; 'kills' is not a HIGH term but the rules include 'attack'/'killed' etc.
    // Use an explicit HIGH term to assert high severity deterministically.
    const c = classify('Airstrike kills 12 in border town', 'Heavy shelling reported, many dead');
    expect(c.category).toBe('conflict');
    expect(c.severity).toBe('high'); // 'dead' is a HIGH term
  });

  it('classifies a cyber item with MEDIUM severity (breach, no high term)', () => {
    const c = classify('Ransomware breach hits hospital', 'Systems offline');
    expect(c.category).toBe('cyber'); // 'ransomware'/'breach'
    expect(c.severity).toBe('medium'); // 'breach' is a MED term, no HIGH term present
  });

  it('returns {} for a neutral headline (no category, no severity)', () => {
    const c = classify('Local bakery wins award', 'Townsfolk delighted');
    expect(c).toEqual({});
    expect(c.category).toBeUndefined();
    expect(c.severity).toBeUndefined();
  });

  it('assigns severity low when a category hits with no high/med term', () => {
    const c = classify('Election scheduled for next month', 'Officials announce date');
    expect(c.category).toBe('politics'); // 'election'
    expect(c.severity).toBe('low');
  });

  it('is ReDoS-safe: regex-metacharacter inputs do not throw (literal includes, no regex compilation)', () => {
    expect(() => classify('weird title .*?(((', '[a-z]+$')).not.toThrow();
    const c = classify('weird title .*?(((', '[a-z]+$');
    // No keyword matches these literal strings → empty classification.
    expect(c).toEqual({});
  });
});
