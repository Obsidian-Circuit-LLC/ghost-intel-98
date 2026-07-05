// @vitest-environment jsdom
/**
 * Task 5: MarkdownView renders `link` AST nodes as safeHref-guarded external-open anchors.
 *
 * SECURITY: safeHref is the SINGLE render-time choke-point. A non-http/https (or userinfo)
 * href renders as INERT TEXT — never an <a>. A safe http/https link renders an <a href=safe>
 * with a ↗ cue whose click preventDefaults (no in-app renderer navigation) and calls the
 * injected onLinkClick(safe). onLinkClick threads through renderInline's recursion, so a link
 * nested inside a bullet/bold still fires it.
 *
 * No @testing-library — drive React 18's createRoot inside act() against a jsdom container,
 * mirroring x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownView } from '../src/renderer/modules/ai-assistant/MarkdownView';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function anchors(): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}

describe('MarkdownView link rendering (Task 5)', () => {
  it('renders an http markdown link as <a href=safe> with a ↗ cue', async () => {
    await act(async () => { root.render(<MarkdownView text="see [go](http://example.com/path)" />); });

    const a = anchors();
    expect(a).toHaveLength(1);
    expect(a[0].getAttribute('href')).toBe('http://example.com/path');
    expect(a[0].textContent).toContain('go');
    expect(a[0].textContent).toContain('↗');
  });

  it('click calls onLinkClick(safe) and prevents default (no in-app navigation)', async () => {
    const onLinkClick = vi.fn();
    await act(async () => {
      root.render(<MarkdownView text="[go](http://example.com/path)" onLinkClick={onLinkClick} />);
    });

    const a = anchors()[0];
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { a.dispatchEvent(evt); });

    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).toHaveBeenCalledWith('http://example.com/path');
    expect(evt.defaultPrevented).toBe(true);
  });

  it('renders a javascript: link as inert text, never an <a>', async () => {
    const onLinkClick = vi.fn();
    await act(async () => {
      root.render(<MarkdownView text="[x](javascript:alert(1))" onLinkClick={onLinkClick} />);
    });

    expect(anchors()).toHaveLength(0);
    expect(container.textContent).toContain('x');
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it('renders a mailto: link as inert text, never an <a>', async () => {
    await act(async () => { root.render(<MarkdownView text="[mail](mailto:a@b.com)" />); });

    expect(anchors()).toHaveLength(0);
    expect(container.textContent).toContain('mail');
  });

  it('threads onLinkClick through a link nested inside a bullet list item', async () => {
    const onLinkClick = vi.fn();
    await act(async () => {
      root.render(<MarkdownView text={'- see [go](http://example.com/a)'} onLinkClick={onLinkClick} />);
    });

    const li = container.querySelector('li');
    expect(li).not.toBeNull();
    const a = li!.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('http://example.com/a');

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { a!.dispatchEvent(evt); });

    expect(onLinkClick).toHaveBeenCalledWith('http://example.com/a');
    expect(evt.defaultPrevented).toBe(true);
  });
});
