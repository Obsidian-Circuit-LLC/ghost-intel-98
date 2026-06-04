import { describe, it, expect } from 'vitest';
import { ensureAiConversation } from '../src/main/security/validate';

describe('ensureAiConversation', () => {
  it('keeps a valid conversation', () => {
    const c = ensureAiConversation({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'My chat',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]
    });
    expect(c.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(c.title).toBe('My chat');
    expect(c.messages).toHaveLength(2);
    expect(c.messages[1]).toEqual({ role: 'assistant', content: 'hello' });
  });

  it('coerces unknown roles to user and defaults a blank title', () => {
    const c = ensureAiConversation({ id: 'x', title: '   ', messages: [{ role: 'root', content: 'x' }] });
    expect(c.messages[0].role).toBe('user');
    expect(c.title).toBe('Conversation');
    expect(c.id.length).toBeGreaterThan(0); // invalid id → fresh uuid
  });

  it('bounds message count and content length', () => {
    const many = Array.from({ length: 5000 }, () => ({ role: 'user', content: 'x'.repeat(200000) }));
    const c = ensureAiConversation({ id: 'i', title: 't', messages: many });
    expect(c.messages.length).toBeLessThanOrEqual(2000);
    expect(c.messages[0].content.length).toBeLessThanOrEqual(100000);
  });

  it('tolerates garbage', () => {
    const c = ensureAiConversation(null);
    expect(c.messages).toEqual([]);
    expect(c.title).toBe('Conversation');
  });
});
