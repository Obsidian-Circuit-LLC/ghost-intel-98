// @vitest-environment jsdom
/**
 * Task 6: TextBlock render smoke — pins the security-spine pipeline: every edit to a text block's
 * contentEditable body runs through `sanitizeReportHtml` BEFORE the html reaches the caller (the
 * value the editor/module would autosave). Feeds an unsafe fragment straight into the DOM the way a
 * paste/keystroke would and asserts the surviving output keeps the safe markup and drops the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextBlock } from '../src/renderer/modules/reports/blocks/TextBlock';
import type { ReportBlock } from '../src/shared/reports-types';

type TextBlockData = Extract<ReportBlock, { kind: 'text' }>;

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

describe('TextBlock', () => {
  it('sanitizes on input before the html reaches onChange (the save path)', async () => {
    const block: TextBlockData = { id: 'b1', kind: 'text', html: '' };
    const onChange = vi.fn();

    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    expect(body).toBeTruthy();

    await act(async () => {
      body.innerHTML = '<b>hi</b><script>bad()</script><span onclick="x()">t</span>';
      body.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('<b>hi</b>');
    expect(saved).not.toContain('script');
    expect(saved).not.toContain('onclick');
  });

  it('also sanitizes on blur', async () => {
    const block: TextBlockData = { id: 'b2', kind: 'text', html: '' };
    const onChange = vi.fn();
    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.innerHTML = '<u>ok</u><img src=x onerror=y>';
      // React's onBlur listens for the bubbling native `focusout` event (plain `blur` doesn't
      // bubble, so React wouldn't observe it via its root delegate listener).
      body.dispatchEvent(new Event('focusout', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('<u>ok</u>');
    expect(saved).not.toContain('<img');
    expect(saved).not.toContain('onerror');
  });

  it('renders the B/I/U toolbar + a font-size select', async () => {
    const block: TextBlockData = { id: 'b3', kind: 'text', html: '<p>x</p>' };
    await act(async () => { root.render(<TextBlock block={block} onChange={vi.fn()} />); });

    expect(container.querySelector('button[aria-label="Bold"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Italic"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Underline"]')).toBeTruthy();
    const select = container.querySelector('select[aria-label="Font size"]');
    expect(select).toBeTruthy();
    expect(select?.querySelectorAll('option').length).toBeGreaterThanOrEqual(4);
  });
});
