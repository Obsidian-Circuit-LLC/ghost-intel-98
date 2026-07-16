// @vitest-environment jsdom
/**
 * Task 3: Recipient as a Contact in the editor.
 *
 * The "To" field becomes a contact <select> bound to `report.toContactId`, mirroring the existing
 * From <select> (:282-297). A "Choose…" affordance next to either field opens the shared ContactBook
 * popup, generalized with a 'from' | 'to' target so the same popup can fill the recipient as well as
 * the sender — previously "Use" always hard-set fromContactId. A report carrying only the legacy
 * `to` string (no toContactId) still shows it as a read-only fallback line so old reports don't lose
 * their recipient in the UI.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-editor-wordprocessor.test.tsx. <ContactBook> talks
 * to window.api.reports.contacts.list(), so it's stubbed the way preload exposes it (see
 * test/reports-module.test.tsx's stubApi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Report, Contact } from '../src/shared/reports-types';
import { ReportEditor } from '../src/renderer/modules/reports/ReportEditor';

let container: HTMLDivElement;
let root: Root;

const contacts: Contact[] = [
  { id: 'c1', name: 'A. Investigator', org: 'Ghost Intel' },
  { id: 'c2', name: 'Det. Vance', org: 'Metro PD' },
];

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1', title: 'Untitled report', createdAt: 't', updatedAt: 't', to: '',
    status: 'draft', author: 'Investigator', blocks: [], ...overrides,
  };
}

function stubApi(): void {
  (globalThis as any).window.api = {
    reports: {
      contacts: {
        list: vi.fn(async () => contacts),
        save: vi.fn(async (c: any) => c),
        remove: vi.fn(async () => undefined),
      },
    },
  };
}

function Harness(props: { initial: Report; onReportChange?: (r: Report) => void }): JSX.Element {
  const [r, setR] = useState<Report>(props.initial);
  return (
    <ReportEditor
      report={r}
      assets={{}}
      contacts={contacts}
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

/** Set a React-controlled <select>'s value the way a real pick would (native setter + change event). */
function selectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  stubApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ReportEditor recipient contact (Task 3)', () => {
  it('renders the To field as a contact select bound to toContactId', async () => {
    await act(async () => { root.render(<Harness initial={baseReport({ toContactId: 'c2' })} />); });
    const sel = container.querySelector('select[aria-label="To contact"]') as HTMLSelectElement | null;
    expect(sel).toBeTruthy();
    expect(sel!.value).toBe('c2');
  });

  it('changing the To select patches toContactId (not fromContactId)', async () => {
    const onReportChange = vi.fn();
    await act(async () => { root.render(<Harness initial={baseReport()} onReportChange={onReportChange} />); });

    const sel = container.querySelector('select[aria-label="To contact"]') as HTMLSelectElement;
    await act(async () => { selectValue(sel, 'c1'); });

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.toContactId).toBe('c1');
    expect(last.fromContactId).toBeUndefined();
  });

  it('opening the ContactBook targeted at the recipient and choosing a contact sets toContactId, not fromContactId', async () => {
    const onReportChange = vi.fn();
    await act(async () => { root.render(<Harness initial={baseReport()} onReportChange={onReportChange} />); });

    const openBtn = container.querySelector('button[aria-label="Choose To contact"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn!.click(); });

    await vi.waitFor(() => expect(container.querySelector('[role="dialog"][aria-label="Contact book"]')).toBeTruthy());
    const useBtns = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Use');
    expect(useBtns.length).toBeGreaterThan(0);
    await act(async () => { (useBtns[0] as HTMLButtonElement).click(); });

    // the popup closes after Use
    expect(container.querySelector('[role="dialog"][aria-label="Contact book"]')).toBeFalsy();

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.toContactId).toBeTruthy();
    expect(last.fromContactId).toBeFalsy();
  });

  it('opening the ContactBook targeted at the sender still sets fromContactId, not toContactId', async () => {
    const onReportChange = vi.fn();
    await act(async () => { root.render(<Harness initial={baseReport()} onReportChange={onReportChange} />); });

    const openBtn = container.querySelector('button[aria-label="Choose From contact"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn!.click(); });

    await vi.waitFor(() => expect(container.querySelector('[role="dialog"][aria-label="Contact book"]')).toBeTruthy());
    const useBtns = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Use');
    await act(async () => { (useBtns[0] as HTMLButtonElement).click(); });

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.fromContactId).toBeTruthy();
    expect(last.toContactId).toBeFalsy();
  });

  it('shows the legacy report.to string as a read-only fallback when toContactId is unset', async () => {
    await act(async () => { root.render(<Harness initial={baseReport({ to: 'Det. Vance (legacy)' })} />); });
    expect(container.textContent).toContain('Det. Vance (legacy)');
    // no more free-text "To recipient" input — recipient is a Contact now.
    expect(container.querySelector('input[aria-label="To recipient"]')).toBeFalsy();
  });

  it('does not show the legacy fallback once a toContactId is set', async () => {
    await act(async () => {
      root.render(<Harness initial={baseReport({ to: 'stale legacy text', toContactId: 'c1' })} />);
    });
    expect(container.textContent).not.toContain('stale legacy text');
  });
});
