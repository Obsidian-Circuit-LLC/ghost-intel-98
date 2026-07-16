// @vitest-environment jsdom
/**
 * Task 5: Templates nav branch + sandboxed Template Preview panel.
 *
 *   - <TemplatePreview> given `html` renders a titled Win98 panel whose body is an
 *     `<iframe sandbox="" srcdoc={html}>` (no scripts run — sandbox is empty) plus a
 *     "Select Template" button that calls `onSelect` when clicked.
 *   - <ReportsNavTree> grows a "Templates" branch with a "My Templates" leaf; selecting it
 *     routes through the templates-view callback (`onSelect('templates')`).
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-navtree.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TemplatePreview } from '../src/renderer/modules/reports/TemplatePreview';
import { ReportsNavTree } from '../src/renderer/modules/reports/ReportsNavTree';

let container: HTMLDivElement;
let root: Root;

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

describe('TemplatePreview', () => {
  it('renders a sandboxed srcdoc iframe of the built HTML', async () => {
    const html = '<h1>Chain of Custody</h1>';
    await act(async () => {
      root.render(<TemplatePreview html={html} templateName="Chain of Custody" onSelect={vi.fn()} />);
    });
    const frame = container.querySelector('iframe.ga98-report-tpl-preview-frame') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    // sandbox="" — empty token list disables scripts, forms, same-origin, everything.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(html);
  });

  it('"Select Template" calls onSelect', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(<TemplatePreview html="<p>x</p>" onSelect={onSelect} />);
    });
    const btn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Select Template')) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => { btn.click(); });
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('ReportsNavTree — Templates branch', () => {
  it('renders a Templates branch with a "My Templates" leaf', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    expect(container.querySelector('[data-nav-toggle="templates"]')).toBeTruthy();
    expect(container.querySelector('[data-nav="templates"]')).toBeTruthy();
    expect(container.textContent).toContain('My Templates');
  });

  it('selecting "My Templates" calls the templates-view callback', async () => {
    const onViewTemplates = vi.fn();
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} onViewTemplates={onViewTemplates} />
      );
    });
    await act(async () => { (container.querySelector('[data-nav="templates"]') as HTMLElement).click(); });
    expect(onViewTemplates).toHaveBeenCalled();
  });

  it('marks the Templates leaf active when the Templates view is active', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} templatesActive />
      );
    });
    expect((container.querySelector('[data-nav="templates"]') as HTMLElement).className).toContain('ga98-report-nav-active');
  });
});
