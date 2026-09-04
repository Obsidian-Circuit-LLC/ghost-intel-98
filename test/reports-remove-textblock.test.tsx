// @vitest-environment jsdom
/**
 * Removing a text box that was added by mistake.
 *
 * FIELD REPORT (GhostExodus): "Could you also add the option to remove a text box that was
 * erroneously added? … It would be added in this toolbar thing here. With a confirmation making
 * sure you want to delete it or not."
 *
 * Image blocks and table blocks have had a remove affordance since they were written; TEXT blocks
 * were the one kind with no way out — `removeBlock` existed in the editor and was simply never wired
 * to them. An accidental "+ Text" was therefore permanent for the life of the report.
 *
 * The control is deliberately destructive-with-a-gate: it deletes writing, which is the one thing in
 * a report that cannot be re-derived from anywhere else, so it goes through the themed confirm rather
 * than firing on a single click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Report } from '../src/shared/reports-types';

const confirmDialog = vi.fn<(msg: string, title?: string) => Promise<boolean>>();
vi.mock('../src/renderer/state/dialogs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  confirmDialog: (msg: string, title?: string) => confirmDialog(msg, title),
}));

const { ReportEditor } = await import('../src/renderer/modules/reports/ReportEditor');

let container: HTMLDivElement;
let root: Root;

function reportWithTwoTextBlocks(): Report {
  return {
    id: 'r1', title: 'T', createdAt: 't', updatedAt: 't', to: '', status: 'draft', author: 'A',
    blocks: [
      { id: 'keep', kind: 'text', html: '<p>Real content.</p>' },
      { id: 'oops', kind: 'text', html: '<p>Added by mistake.</p>' },
    ],
  };
}

let latest: Report;
function Harness({ initial }: { initial: Report }): JSX.Element {
  const [r, setR] = useState<Report>(initial);
  latest = r;
  return (
    <ReportEditor
      report={r} assets={{}} contacts={[]} descriptors={[]} introductions={[]}
      onChange={(next) => { setR(next); }}
      onAutosave={() => {}} onUploadBanner={() => {}} onRemoveBanner={() => {}}
      onManageContacts={() => {}} onManageDescriptors={() => {}} onManageIntroductions={() => {}}
      onAddPhoto={() => {}} onAddTable={() => {}} onImportFromCase={() => {}}
      zoom={1} onZoom={() => {}}
    />
  );
}

const removeBtn = (): HTMLButtonElement =>
  Array.from(container.querySelectorAll('.ga98-report-toolbar button'))
    .find((b) => /remove text/i.test(b.textContent ?? '')) as HTMLButtonElement;

const bodies = (): HTMLElement[] =>
  Array.from(container.querySelectorAll('.ga98-report-textblock-body'));

async function mount(): Promise<void> {
  await act(async () => { root.render(<Harness initial={reportWithTwoTextBlocks()} />); });
}

beforeEach(() => {
  confirmDialog.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('remove a text box from the toolbar', () => {
  it('offers the control in the same toolbar as + Text', async () => {
    await mount();
    expect(removeBtn(), 'a Remove text control sits in the block toolbar').toBeTruthy();
  });

  it('targets the box the editor already put the caret in', async () => {
    await mount();
    // The editor focuses a text body on mount (the word-processor behaviour), so the caret really
    // IS in a box and the control is live — it is not guessing.
    expect(removeBtn().disabled).toBe(false);
    expect(removeBtn().title.toLowerCase()).toContain('delete the text box');
  });

  it('deletes the text box the caret is in, once confirmed', async () => {
    await mount();
    confirmDialog.mockResolvedValue(true);

    await act(async () => { bodies()[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    expect(removeBtn().disabled).toBe(false);

    await act(async () => { removeBtn().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialog, 'it asks first').toHaveBeenCalled();
    expect(latest.blocks.map((b) => b.id)).toEqual(['keep']);
  });

  it('keeps the text box when the confirmation is declined', async () => {
    await mount();
    confirmDialog.mockResolvedValue(false);

    await act(async () => { bodies()[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    await act(async () => { removeBtn().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmDialog).toHaveBeenCalled();
    expect(latest.blocks.map((b) => b.id), 'Cancel means nothing is deleted').toEqual(['keep', 'oops']);
  });

  it('goes back to disabled once the deleted box is gone', async () => {
    await mount();
    confirmDialog.mockResolvedValue(true);
    await act(async () => { bodies()[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    await act(async () => { removeBtn().click(); });
    await act(async () => { await Promise.resolve(); });
    // The pointer must not survive the block it pointed at, or the next click deletes something else.
    expect(removeBtn().disabled).toBe(true);
    // …and the disabled state explains itself rather than looking broken.
    expect(removeBtn().title.toLowerCase()).toContain('click inside a text box');
  });
});
