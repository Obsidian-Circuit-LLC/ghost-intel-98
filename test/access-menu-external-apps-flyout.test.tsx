// @vitest-environment jsdom
/**
 * Access menu — External Apps flyout. Dynamic (never hard-coded): built from whatever
 * `window.api.externalPrograms.list()` returns for THIS launch of the menu, cloned from the same
 * flyout pattern as OSINT Toolkit/Games. Three fixed rows (Open Programs Folder / Refresh Programs
 * / Manage Programs) plus one row per discovered program, which launches it directly — it does not
 * open a module window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessMenu } from '../src/renderer/shell/AccessMenu';
import { useSettings, useWindows } from '../src/renderer/state/store';
import { _resetRegistryForTest, registerModule } from '../src/renderer/state/registry';
import { defaultSettings } from '@shared/types';

const Dummy = (): null => null;

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.fn>;
const onClose = vi.fn();
let launch: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;
let openFolder: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetRegistryForTest();
  registerModule({ key: 'external-programs', title: 'Program Manager', glyph: '🗂', component: Dummy, builtin: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  openSpy = vi.fn();
  useWindows.setState({ open: openSpy });
  useSettings.setState({ settings: { ...defaultSettings, soundEnabled: false } });

  list = vi.fn(async () => ({
    programs: [{ id: 'file:MyTool.exe', name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false }],
    diagnostics: [],
  }));
  refresh = vi.fn(async () => ({ programs: [], diagnostics: [] }));
  launch = vi.fn(async () => ({ ok: true as const }));
  openFolder = vi.fn(async () => '/fake/Programs');
  (window as unknown as { api: unknown }).api = { externalPrograms: { list, refresh, launch, openFolder } };

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  _resetRegistryForTest();
  onClose.mockReset();
  vi.restoreAllMocks();
});

async function render(): Promise<void> {
  await act(async () => { root.render(<AccessMenu onClose={onClose} />); });
}

function findByHaspopup(label: string): HTMLElement {
  const el = [...container.querySelectorAll('[aria-haspopup="true"]')].find((n) => n.textContent?.includes(label));
  if (!el) throw new Error(`no aria-haspopup trigger containing "${label}"`);
  return el as HTMLElement;
}

function click(el: HTMLElement): void {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('Access menu — External Apps flyout', () => {
  it('lists a discovered program by name, from a live scan', async () => {
    await render();
    click(findByHaspopup('External Apps'));
    await act(async () => {});
    expect(container.textContent).toContain('MyTool');
  });

  it('launches the program directly (no module window) when its row is clicked', async () => {
    await render();
    click(findByHaspopup('External Apps'));
    await act(async () => {});
    const row = [...container.querySelectorAll('[data-external-program-id]')][0] as HTMLElement;
    expect(row.getAttribute('data-external-program-id')).toBe('file:MyTool.exe');
    click(row);
    await act(async () => {});
    expect(launch).toHaveBeenCalledWith('file:MyTool.exe');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the Programs folder via IPC, not a module window', async () => {
    await render();
    click(findByHaspopup('External Apps'));
    await act(async () => {});
    click([...container.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent?.includes('Open Programs Folder')) as HTMLElement);
    await act(async () => {});
    expect(openFolder).toHaveBeenCalled();
  });

  it('re-scans when Refresh Programs is clicked, updating the list in place', async () => {
    await render();
    click(findByHaspopup('External Apps'));
    await act(async () => {});
    expect(container.textContent).toContain('MyTool');
    click([...container.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent?.includes('Refresh Programs')) as HTMLElement);
    await act(async () => {});
    expect(refresh).toHaveBeenCalled();
    expect(container.textContent).not.toContain('MyTool');
  });

  it('opens the Program Manager module when Manage Programs is clicked', async () => {
    await render();
    click(findByHaspopup('External Apps'));
    await act(async () => {});
    click([...container.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent?.includes('Manage Programs')) as HTMLElement);
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ module: 'external-programs' }));
    expect(onClose).toHaveBeenCalled();
  });
});
