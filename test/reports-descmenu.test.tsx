// @vitest-environment jsdom
/**
 * Task 1: descriptor/introduction popup — kill the double menu + fix off-screen placement.
 *
 * Bug 1 (double menu): `TextBlock`'s contentEditable body opens its own descriptor popover on
 * `contextMenu` via `openDescriptorMenu`, which only called `e.preventDefault()`. The native event
 * still BUBBLES, so `ReportEditor`'s block-level `.ga98-report-page` `onContextMenu={openContextMenu}`
 * also fires and opens ITS OWN block-level menu — two menus stacked on one right-click. The fix adds
 * `e.stopPropagation()` alongside the existing `preventDefault()` so the bubbling parent handler never
 * sees the event.
 *
 * Bug 2 (off-screen placement): the descriptor menu is rendered as a direct child with
 * `position:fixed; left:clientX; top:clientY`. `.ga98-report-page` (the ancestor) carries
 * `transform: scale(var(--ga98-report-zoom))` — a CSS transform on an ancestor makes it the
 * containing block for `position:fixed` descendants, so the menu's "fixed" coordinates resolve
 * against the SCALED page, not the true viewport, landing off-screen/mis-scaled at any zoom other
 * than 100%. The fix portals the menu to `document.body` via `ReactDOM.createPortal`, escaping the
 * transformed ancestor so `clientX`/`clientY` resolve against the real viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextBlock } from '../src/renderer/modules/reports/blocks/TextBlock';
import type { ReportBlock, Descriptor } from '../src/shared/reports-types';

type TextBlockData = Extract<ReportBlock, { kind: 'text' }>;

let container: HTMLDivElement;
let root: Root;

const descriptors: Descriptor[] = [
  { id: 'd1', name: 'OSINT.Industries', body: 'A tool that finds public links across many platforms.' },
];

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

/** Render TextBlock nested inside a stand-in for `ReportEditor`'s scaled, block-level-context-menu
 *  page — the same shape the real editor puts it in (`.ga98-report-page` with `onContextMenu`
 *  wrapping `.ga98-report-block` wrapping `TextBlock`). Returns a spy for the outer handler. */
function renderNested(block: TextBlockData, onChange = vi.fn()) {
  const outerMenuOpened = vi.fn();
  function Harness(): JSX.Element {
    return (
      <div className="ga98-report-page" onContextMenu={outerMenuOpened}>
        <div className="ga98-report-block">
          <TextBlock block={block} onChange={onChange} descriptors={descriptors} />
        </div>
      </div>
    );
  }
  return { outerMenuOpened, Harness };
}

describe('TextBlock descriptor menu — no double menu, portaled out of the scaled page', () => {
  it('does not bubble the contextmenu to a block-level handler (exactly one menu opens)', async () => {
    const block: TextBlockData = { id: 'b1', kind: 'text', html: '' };
    const { outerMenuOpened, Harness } = renderNested(block);
    await act(async () => { root.render(<Harness />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });

    // The descriptor popover opened...
    expect(document.querySelectorAll('.ga98-report-descmenu').length).toBe(1);
    // ...but the ancestor's block-level context-menu handler never saw the event.
    expect(outerMenuOpened).not.toHaveBeenCalled();
  });

  it('portals the menu to document.body, not inside .ga98-report-page', async () => {
    const block: TextBlockData = { id: 'b2', kind: 'text', html: '' };
    const { Harness } = renderNested(block);
    await act(async () => { root.render(<Harness />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });

    const menu = document.querySelector('.ga98-report-descmenu');
    expect(menu).toBeTruthy();
    // Not nested under the (transform-scaled) page — it's a direct-ish child of body via the portal.
    expect(menu?.closest('.ga98-report-page')).toBeNull();
    // It IS somewhere under document.body (trivially true, but pins the portal target).
    expect(document.body.contains(menu)).toBe(true);
  });

  it('an outside click still dismisses the portaled menu', async () => {
    const block: TextBlockData = { id: 'b3', kind: 'text', html: '' };
    const { Harness } = renderNested(block);
    await act(async () => { root.render(<Harness />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    expect(document.querySelector('.ga98-report-descmenu')).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.ga98-report-descmenu')).toBeNull();
  });

  it('descriptorMenu={false} (e.g. Journal Jots, which has no descriptor library) suppresses the right-click menu', async () => {
    // GhostExodus feedback: right-clicking a Journal Jots text block surfaced an always-empty
    // "No descriptors or introductions yet." popover (the Reports-only descriptor menu leaking into
    // a consumer that reuses TextBlock). With descriptorMenu={false}, contextmenu is not wired, so
    // no descriptor popover opens and right-click falls back to the native browser menu.
    const block: TextBlockData = { id: 'b4', kind: 'text', html: '' };
    await act(async () => {
      root.render(<TextBlock block={block} onChange={vi.fn()} descriptorMenu={false} />);
    });
    const body = container.querySelector('.ga98-report-textblock-body') as HTMLDivElement;
    await act(async () => {
      body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    expect(document.querySelector('.ga98-report-descmenu')).toBeNull();
  });
});
