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
import type { ReportBlock, Descriptor } from '../src/shared/reports-types';

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

/**
 * Task 7: descriptor library right-click insert. TextBlock's contentEditable body opens a small
 * context menu on right-click listing every descriptor by name with a body preview; "Insert text" /
 * "Insert with title" call `descriptorInsertHtml` and splice the (already-escaped) result into the
 * block at the caret, then re-sanitize on the resulting commit — descriptors are plain-text data,
 * never trusted markup, same spine as every other edit.
 */
describe('TextBlock descriptor context menu', () => {
  const descriptors: Descriptor[] = [
    { id: 'd1', name: 'OSINT.Industries', body: 'A tool that finds public links across many platforms and more than that even.' },
  ];

  it('renders a descriptor name + body preview + both insert actions on right-click', async () => {
    const block: TextBlockData = { id: 'b4', kind: 'text', html: '' };
    await act(async () => {
      root.render(<TextBlock block={block} onChange={vi.fn()} descriptors={descriptors} />);
    });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });

    expect(container.textContent).toContain('OSINT.Industries');
    expect(container.textContent).toContain('A tool that finds public links');
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Insert text');
    expect(buttons).toContain('Insert with title');
  });

  it('clicking "Insert text" splices the descriptor body into the block and sanitizes on commit', async () => {
    const block: TextBlockData = { id: 'b5', kind: 'text', html: '' };
    const onChange = vi.fn();
    await act(async () => {
      root.render(<TextBlock block={block} onChange={onChange} descriptors={descriptors} />);
    });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });

    const insertBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Insert text') as HTMLButtonElement;
    expect(insertBtn).toBeTruthy();
    await act(async () => { insertBtn.click(); });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('A tool that finds public links');
  });

  it('clicking "Insert with title" prefixes a bold escaped name', async () => {
    const block: TextBlockData = { id: 'b6', kind: 'text', html: '' };
    const onChange = vi.fn();
    await act(async () => {
      root.render(<TextBlock block={block} onChange={onChange} descriptors={descriptors} />);
    });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });

    const insertBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Insert with title') as HTMLButtonElement;
    expect(insertBtn).toBeTruthy();
    await act(async () => { insertBtn.click(); });

    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('<b>OSINT.Industries</b>');
    expect(saved).toContain('A tool that finds public links');
  });

  it('closes the menu on an outside mousedown', async () => {
    const block: TextBlockData = { id: 'b7', kind: 'text', html: '' };
    await act(async () => {
      root.render(<TextBlock block={block} onChange={vi.fn()} descriptors={descriptors} />);
    });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    expect(container.querySelector('.ga98-report-descmenu')).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('.ga98-report-descmenu')).toBeNull();
  });
});
