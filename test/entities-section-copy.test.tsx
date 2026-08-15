// @vitest-environment jsdom
/**
 * Right-click "copy" on the case entity list (GhostExodus request, v3.72.0). Right-clicking an
 * entity row opens a Win98 `.ga98-menu` (the CasesModule pattern) with "Copy value" (the raw
 * email/phone/name — the common grab) and "Copy summary" (type + aliases + notes). Both write to
 * the clipboard locally (no egress) and confirm via a toast.
 *
 * createRoot + act, no @testing-library (Global Constraint: no new dependency).
 */
import { vi } from 'vitest';

const { writeText, toastInfo } = vi.hoisted(() => ({ writeText: vi.fn(async () => undefined), toastInfo: vi.fn() }));
vi.mock('../src/renderer/state/toasts', () => ({
  toast: { info: toastInfo, error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../src/renderer/state/dialogs', () => ({ confirmDialog: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EntitiesSection } from '../src/renderer/modules/cases/EntitiesSection';
import type { ResolvedEntity } from '@shared/types';

const ENTITY: ResolvedEntity = {
  entity: { id: 'e1', type: 'email', value: 'target@proton.me', aliases: ['alt@x.com'], notes: 'primary contact' },
  relationship: 'associate',
  attachmentFileNames: [],
} as unknown as ResolvedEntity;

describe('EntitiesSection — right-click copy', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).window.api = { entities: { listAll: vi.fn(async () => []) } };
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writeText.mockClear();
    toastInfo.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
  });

  async function mount() {
    await act(async () => {
      root.render(<EntitiesSection caseId="c1" entities={[ENTITY]} attachments={[]} onRefresh={() => undefined} />);
    });
    await act(async () => { await Promise.resolve(); });
  }
  function rightClickRow() {
    const li = Array.from(container.querySelectorAll('li')).find((n) => n.textContent?.includes('target@proton.me'));
    if (!li) throw new Error('entity row not found');
    act(() => { li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 })); });
  }
  function menuItem(label: RegExp): HTMLElement {
    const hit = Array.from(container.querySelectorAll('.ga98-menu > *')).find((n) => label.test(n.textContent || ''));
    if (!hit) throw new Error(`menu item not found: ${label}`);
    return hit as HTMLElement;
  }

  it('right-click opens a menu; "Copy value" writes the raw value + toasts', async () => {
    await mount();
    rightClickRow();
    expect(container.querySelector('.ga98-menu')).not.toBeNull();
    await act(async () => { menuItem(/copy value/i).click(); });
    expect(writeText).toHaveBeenCalledWith('target@proton.me');
    expect(toastInfo).toHaveBeenCalled();
    // menu closes after choosing
    expect(container.querySelector('.ga98-menu')).toBeNull();
  });

  it('"Copy summary" writes type + aliases + notes', async () => {
    await mount();
    rightClickRow();
    await act(async () => { menuItem(/copy summary/i).click(); });
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('email: target@proton.me');
    expect(text).toContain('alt@x.com');
    expect(text).toContain('primary contact');
  });
});
