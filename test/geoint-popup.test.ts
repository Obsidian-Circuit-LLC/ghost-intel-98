// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPopup } from '../src/renderer/modules/geoint/popup';

describe('geoint map popup (XSS-safe)', () => {
  it('renders a malicious title as text, not markup (no injected elements)', () => {
    const el = buildPopup('<img src=x onerror=alert(1)>Quake', undefined);
    // The title becomes the textContent of <b> — no <img> element is created.
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')?.textContent).toBe('<img src=x onerror=alert(1)>Quake');
    expect(el.innerHTML).not.toContain('<img');
  });

  it('renders an http(s) link as a real anchor with safe rel', () => {
    const el = buildPopup('Event', 'https://example.com/a');
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com/a');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.textContent).toBe('open');
  });

  it('drops javascript: / data: / non-http links entirely', () => {
    expect(buildPopup('x', 'javascript:alert(1)').querySelector('a')).toBeNull();
    expect(buildPopup('x', 'data:text/html,<script>1</script>').querySelector('a')).toBeNull();
    expect(buildPopup('x', 'not a url').querySelector('a')).toBeNull();
  });
});
