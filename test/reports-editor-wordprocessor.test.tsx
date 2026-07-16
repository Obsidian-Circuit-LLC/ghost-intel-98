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

function Harness(props: { initial: Report; onReportChange?: (r: Report) => void }): JSX.Element {
  const [r, setR] = useState<Report>(props.initial);
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
