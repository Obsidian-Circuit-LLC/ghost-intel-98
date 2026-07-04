import { describe, it, expect } from 'vitest';
import { appendRecalled } from '../src/renderer/modules/ai-assistant/recall-inject';

describe('appendRecalled', () => {
  it('returns the recalled text when the draft is empty', () => {
    expect(appendRecalled('', 'hello')).toBe('hello');
  });
  it('appends with a separating newline when the draft is non-empty', () => {
    expect(appendRecalled('draft', 'note')).toBe('draft\nnote');
  });
  it('treats a whitespace-only draft as empty', () => {
    expect(appendRecalled('   ', 'note')).toBe('note');
  });
  it('is a no-op for a blank recall', () => {
    expect(appendRecalled('draft', '   ')).toBe('draft');
  });
});
