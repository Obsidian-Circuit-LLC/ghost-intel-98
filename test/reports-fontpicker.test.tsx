// @vitest-environment jsdom
/**
 * Task 1 (font-picker fix): the Font-family and Font-size `<select>`s are native selects with an
 * `onChange` but no selection preservation. Opening a native select blurs the `contentEditable`, so
 * by the time `onChange` fires in a real browser, `applyFont`/`applySize` would read a collapsed
 * `window.getSelection()` and hit their `isCollapsed` guard — a silent no-op. The fix snapshots the
 * selection on `onMouseDown` (before the select steals focus), mirroring the working `linkRange`
 * flow. This test drives the picker as a real interaction would: select text, mousedown the select,
 * THEN change it — and separately proves the guard still no-ops when there was no prior selection to
 * snapshot (e.g. the mousedown never happened, or nothing was selected).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextBlock } from '../src/renderer/modules/reports/blocks/TextBlock';
import type { ReportBlock } from '../src/shared/reports-types';

type TextBlockData = Extract<ReportBlock, { kind: 'text' }>;

let container: HTMLDivElement;
let root: Root;

/** Set a React-controlled/uncontrolled element's value the way a real interaction would (native
 *  prototype setter + change event) so React's value tracker observes the change and fires onChange. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectAllTextIn(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

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

describe('TextBlock font pickers (selection snapshot)', () => {
  it('applies font-family when the select is mousedown-snapshotted before it changes', async () => {
    const block: TextBlockData = { id: 'f1', kind: 'text', html: '<p>hello</p>' };
    const onChange = vi.fn();
    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    selectAllTextIn(body);

    const select = container.querySelector('select[aria-label="Font family"]') as HTMLSelectElement;
    await act(async () => {
      select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await act(async () => { setValue(select, 'Arial'); });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('font-family:Arial');
  });

  it('no-ops font-family when there was no mousedown snapshot (selection reads collapsed)', async () => {
    const block: TextBlockData = { id: 'f2', kind: 'text', html: '<p>hello</p>' };
    const onChange = vi.fn();
    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    selectAllTextIn(body);
    // Simulate the real-browser blur: the selection collapses before onChange fires, and there was
    // no prior mousedown to have snapshotted it.
    window.getSelection()?.removeAllRanges();

    const select = container.querySelector('select[aria-label="Font family"]') as HTMLSelectElement;
    await act(async () => { setValue(select, 'Arial'); });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies font-size when the select is mousedown-snapshotted before it changes', async () => {
    const block: TextBlockData = { id: 'f3', kind: 'text', html: '<p>hello</p>' };
    const onChange = vi.fn();
    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    selectAllTextIn(body);

    const select = container.querySelector('select[aria-label="Font size"]') as HTMLSelectElement;
    await act(async () => {
      select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await act(async () => { setValue(select, 'large'); });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(saved).toContain('font-size:14pt');
  });

  it('no-ops font-size when there was no mousedown snapshot (selection reads collapsed)', async () => {
    const block: TextBlockData = { id: 'f4', kind: 'text', html: '<p>hello</p>' };
    const onChange = vi.fn();
    await act(async () => { root.render(<TextBlock block={block} onChange={onChange} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    selectAllTextIn(body);
    window.getSelection()?.removeAllRanges();

    const select = container.querySelector('select[aria-label="Font size"]') as HTMLSelectElement;
    await act(async () => { setValue(select, 'large'); });

    expect(onChange).not.toHaveBeenCalled();
  });
});
