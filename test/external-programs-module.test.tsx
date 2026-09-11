// @vitest-environment jsdom
/**
 * Program Manager UI — the "Manage Programs" window for External Apps. Lists whatever the last
 * scan found, launches by id, and never hides a diagnostic (a skipped/malformed entry must stay
 * visible so the analyst knows WHY something they dropped in didn't show up as a program).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExternalProgramsModule } from '../src/renderer/modules/external-programs/ExternalProgramsModule';
import type { ExternalProgramsScanResult } from '@shared/external-programs/types';

let container: HTMLDivElement;
let root: Root;

function installApi(scan: ExternalProgramsScanResult): {
  launch: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; openFolder: ReturnType<typeof vi.fn>;
} {
  const launch = vi.fn(async () => ({ ok: true as const }));
  const refresh = vi.fn(async () => scan);
  const openFolder = vi.fn(async () => 'C:\\Users\\ghost\\AppData\\Roaming\\dcs98\\GhostAccess98\\Programs');
  (window as unknown as { api: unknown }).api = {
    externalPrograms: { list: vi.fn(async () => scan), refresh, launch, openFolder },
  };
  return { launch, refresh, openFolder };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => { root.render(<ExternalProgramsModule />); });
}

function click(el: Element | null | undefined): void {
  act(() => { (el as HTMLElement).click(); });
}

describe('Program Manager', () => {
  it('lists every discovered program with its name, description and category', async () => {
    installApi({
      programs: [
        { id: 'file:MyTool.exe', name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false },
        { id: 'dir:Fancy', name: 'Fancy Tool', executableName: 'fancy.exe', category: 'Recon', description: 'Scans things.', hasManifest: true },
      ],
      diagnostics: [],
    });
    await render();
    expect(container.textContent).toContain('MyTool');
    expect(container.textContent).toContain('Fancy Tool');
    expect(container.textContent).toContain('Recon');
    expect(container.textContent).toContain('Scans things.');
  });

  it('shows an empty-state message with no programs yet', async () => {
    installApi({ programs: [], diagnostics: [] });
    await render();
    expect(container.textContent).toMatch(/no programs/i);
  });

  it('surfaces diagnostics so a skipped/malformed drop is never silently invisible', async () => {
    installApi({ programs: [], diagnostics: ['Broken/app.json: app.json is not valid JSON'] });
    await render();
    expect(container.textContent).toContain('Broken/app.json: app.json is not valid JSON');
  });

  it('launches a program by id when its Launch button is clicked', async () => {
    const { launch } = installApi({
      programs: [{ id: 'file:MyTool.exe', name: 'MyTool', executableName: 'MyTool.exe', hasManifest: false }],
      diagnostics: [],
    });
    await render();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Launch'));
    await act(async () => {});
    expect(launch).toHaveBeenCalledWith('file:MyTool.exe');
  });

  it('re-scans when Refresh Programs is clicked', async () => {
    const { refresh } = installApi({ programs: [], diagnostics: [] });
    await render();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh')));
    await act(async () => {});
    expect(refresh).toHaveBeenCalled();
  });

  it('opens the Programs folder when Open Programs Folder is clicked', async () => {
    const { openFolder } = installApi({ programs: [], diagnostics: [] });
    await render();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Open Programs Folder')));
    await act(async () => {});
    expect(openFolder).toHaveBeenCalled();
  });
});
