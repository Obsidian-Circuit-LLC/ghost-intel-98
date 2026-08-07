// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MailModule } from '../src/renderer/modules/mail/MailModule';

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).window.api = {
    mail: { listAccounts: () => Promise.resolve([]), listMessages: () => Promise.resolve([]) }
  };
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Mail banner', () => {
  it('renders the mail banner image as the first header element', async () => {
    await act(async () => { root.render(<MailModule />); });
    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/mail-banner/);
    expect(img!.getAttribute('alt')).toBe('Mail');
  });
});
