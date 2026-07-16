// @vitest-environment jsdom
/**
 * Task 2: "To" field — combobox (dropdown + free-type).
 *
 * The To field is no longer a hard <select> bound to a contact id (v3.51.0's "recipient is a
 * Contact" work) — it's an `<input list=...>` backed by a `<datalist>` of saved contacts, so the
 * operator can either pick a saved contact by display name or free-type an arbitrary recipient
 * (a walk-in, a one-off addressee with no saved Contact record). Typing a value that matches a
 * contact's display name exactly resolves to that contact (`toContactId` set, legacy `to` cleared);
 * any other typed value is carried as free text (`to` set, `toContactId` cleared). The "Choose…"
 * ContactBook affordance is untouched — it still hands back a contact id directly.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-recipient-ui.test.tsx.
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

/** Set a React-controlled <input>'s value the way real typing would (native setter + input event). */
function typeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('ReportEditor "To" combobox (Task 2)', () => {
  it('renders the To field as an input bound to a contacts datalist', async () => {
    await act(async () => { root.render(<Harness initial={baseReport()} />); });
    const input = container.querySelector('input[aria-label="To recipient"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.getAttribute('list')).toBe('report-to-contacts');
    const datalist = container.querySelector('datalist#report-to-contacts');
    expect(datalist).toBeTruthy();
    const options = Array.from(datalist!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['A. Investigator (Ghost Intel)', 'Det. Vance (Metro PD)']);
  });

  it('typing a free value patches `to` and clears toContactId', async () => {
    const onReportChange = vi.fn();
    await act(async () => {
      root.render(<Harness initial={baseReport({ toContactId: 'c1' })} onReportChange={onReportChange} />);
    });

    const input = container.querySelector('input[aria-label="To recipient"]') as HTMLInputElement;
    await act(async () => { typeValue(input, 'Some Walk-in Recipient'); });

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.to).toBe('Some Walk-in Recipient');
    expect(last.toContactId).toBeUndefined();
  });

  it('typing a value equal to a saved contact\'s display name resolves toContactId and clears `to`', async () => {
    const onReportChange = vi.fn();
    await act(async () => {
      root.render(<Harness initial={baseReport({ to: 'stale free text' })} onReportChange={onReportChange} />);
    });

    const input = container.querySelector('input[aria-label="To recipient"]') as HTMLInputElement;
    await act(async () => { typeValue(input, 'Det. Vance (Metro PD)'); });

    const last = onReportChange.mock.calls[onReportChange.mock.calls.length - 1][0] as Report;
    expect(last.toContactId).toBe('c2');
    expect(last.to).toBe('');
  });

  it('shows the resolved contact display name as the input value when toContactId is set', async () => {
    await act(async () => { root.render(<Harness initial={baseReport({ toContactId: 'c1' })} />); });
    const input = container.querySelector('input[aria-label="To recipient"]') as HTMLInputElement;
    expect(input.value).toBe('A. Investigator (Ghost Intel)');
  });

  it('shows the legacy free-text `to` value as the input value when no toContactId is set', async () => {
    await act(async () => { root.render(<Harness initial={baseReport({ to: 'Det. Vance (legacy)' })} />); });
    const input = container.querySelector('input[aria-label="To recipient"]') as HTMLInputElement;
    expect(input.value).toBe('Det. Vance (legacy)');
  });

  it('still exposes the "Choose…" ContactBook affordance for the To field', async () => {
    await act(async () => { root.render(<Harness initial={baseReport()} />); });
    expect(container.querySelector('button[aria-label="Choose To contact"]')).toBeTruthy();
  });
});
