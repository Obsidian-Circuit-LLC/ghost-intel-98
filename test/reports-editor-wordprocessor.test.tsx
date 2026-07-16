// @vitest-environment jsdom
/**
 * Task 4: word-processor-feel editor — an always-present, always-focused text body plus the four
 * metadata header fields (Case #, Reference #, Classification, Signature).
 *
 * Mounting <ReportEditor> with a report whose blocks are empty must:
 *   - seed one empty `kind:'text'` block (so the operator can type immediately), rendering a
 *     `.ga98-report-textblock-body` contentEditable, which becomes the active element after mount;
 *   - render four compact labelled inputs — "Case #", "Reference #", "Classification", "Signature";
 *   - lift a Case # edit up through onChange with `caseNumber` set.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-shell.test.tsx. The editor is controlled, so a
 * stateful <Harness> wrapper applies onChange back into the report prop (the seed round-trips
 * through it, the way ReportsModule's setReport does).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Report } from '../src/shared/reports-types';
import { ReportEditor } from '../src/renderer/modules/reports/ReportEditor';

let container: HTMLDivElement;
let root: Root;

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1', title: 'Untitled report', createdAt: 't', updatedAt: 't', to: '',
    status: 'draft', author: 'Investigator', blocks: [], ...overrides,
  };
}

function Harness(props: {
  initial: Report;
  onReportChange?: (r: Report) => void;
  onReady?: (setReport: (r: Report) => void) => void;
}): JSX.Element {
  const [r, setR] = useState<Report>(props.initial);
  // Expose the setter so a test can imitate ReportsModule's newReport(): a direct setReport(saved)
  // that swaps the open report while this same <ReportEditor> instance stays mounted (no key).
  props.onReady?.(setR);
  return (
    <ReportEditor
      report={r}
      assets={{}}
      contacts={[]}
      descriptors={[]}
      introductions={[]}
      onChange={(next) => { setR(next); props.onReportChange?.(next); }}
      onAutosave={() => {}}
      onUploadBanner={() => {}}
      onRemoveBanner={() => {}}
      onManageContacts={() => {}}
      onManageDescriptors={() => {}}
      onManageIntroductions={() => {}}
      onAddPhoto={() => {}}
      onAddTable={() => {}}
      onImportFromCase={() => {}}
      zoom={1}
      onZoom={() => {}}
    />
  );
}

/** Set a React-controlled text input's value (native setter + input event). */
function inputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('ReportEditor word-processor body + metadata (Task 4)', () => {
  it('seeds a focused text body when the report has no text block', async () => {
    await act(async () => { root.render(<Harness initial={baseReport({ blocks: [] })} />); });

    const body = container.querySelector('.ga98-report-textblock-body') as HTMLElement | null;
    expect(body).toBeTruthy();
    // Type-immediately: the seeded body is focused after mount.
    expect(document.activeElement).toBe(body);
  });

  it('re-focuses the new text body when the open report is swapped in place (File▸New while editing)', async () => {
    // Report A opens with an existing text body and is auto-focused.
    let swap: ((r: Report) => void) | undefined;
    await act(async () => {
      root.render(
        <Harness
          initial={baseReport({ id: 'A', blocks: [{ id: 'a-text', kind: 'text', html: '<p>alpha</p>' }] })}
          onReady={(s) => { swap = s; }}
        />,
      );
    });
    const bodyA = container.querySelector('.ga98-report-textblock-body') as HTMLElement | null;
    expect(bodyA).toBeTruthy();
    expect(document.activeElement).toBe(bodyA);

    // Imitate newReport(): swap report A → a fresh report B (new id, new text block) without
    // remounting the editor. The center-view renders <ReportEditor> with no key, so React preserves
    // this instance; a one-shot focus guard would leave B's body unfocused.
    await act(async () => {
      swap!(baseReport({ id: 'B', blocks: [{ id: 'b-text', kind: 'text', html: '' }] }));
    });

    const bodyB = container.querySelector('.ga98-report-textblock-body') as HTMLElement | null;
    expect(bodyB).toBeTruthy();
    expect(bodyB).not.toBe(bodyA); // a genuinely new contentEditable (fresh block id)
    expect(document.activeElement).toBe(bodyB);
  });

  it('renders the four metadata header inputs', async () => {
    await act(async () => { root.render(<Harness initial={baseReport()} />); });
    expect(container.querySelector('input[aria-label="Case #"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Reference #"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Classification"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Signature"]')).toBeTruthy();
  });

  it('lifts a Case # edit up through onChange with caseNumber set', async () => {
    const onReportChange = vi.fn();
    await act(async () => { root.render(<Harness initial={baseReport()} onReportChange={onReportChange} />); });

    const caseInput = container.querySelector('input[aria-label="Case #"]') as HTMLInputElement;
    expect(caseInput).toBeTruthy();
    await act(async () => { inputValue(caseInput, 'CASE-42'); });

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.caseNumber).toBe('CASE-42');
  });
});
