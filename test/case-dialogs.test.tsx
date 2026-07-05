// @vitest-environment jsdom
/**
 * Shared Win98 dialogs that replaced the dead window.prompt flow across the scraping-case sidebars.
 * The sidebar integration tests cover PromptDialog via Add-Case; this pins the pieces they don't —
 * PromptDialog Enter-submit / empty-guard, and ChoiceDialog (the Import-to-case picker).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PromptDialog, ChoiceDialog } from '../src/renderer/components/CaseDialogs';

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(re: RegExp): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button ${re}`);
  return b as HTMLButtonElement;
}

afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('PromptDialog', () => {
  it('Create is disabled until a non-empty name is typed, then submits the trimmed value', () => {
    const onSubmit = vi.fn();
    mount(<PromptDialog title="New case" label="Case name" onSubmit={onSubmit} onClose={() => {}} />);
    expect(button(/create/i).disabled).toBe(true);
    typeInto(container.querySelector('#case-dialog-input') as HTMLInputElement, '  Night Owl  ');
    expect(button(/create/i).disabled).toBe(false);
    act(() => { button(/create/i).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSubmit).toHaveBeenCalledWith('Night Owl');
  });

  it('Enter submits and Escape closes', () => {
    const onSubmit = vi.fn(); const onClose = vi.fn();
    mount(<PromptDialog title="New case" label="Case name" onSubmit={onSubmit} onClose={onClose} />);
    const input = container.querySelector('#case-dialog-input') as HTMLInputElement;
    typeInto(input, 'Foo');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onSubmit).toHaveBeenCalledWith('Foo');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ChoiceDialog', () => {
  it('defaults to the first option and submits the selected id', () => {
    const onSubmit = vi.fn();
    mount(
      <ChoiceDialog
        title="Import into case" label="Case"
        options={[{ id: 'c1', label: 'Alpha' }, { id: 'c2', label: 'Bravo' }]}
        onSubmit={onSubmit} onClose={() => {}}
      />
    );
    const select = container.querySelector('#case-dialog-select') as HTMLSelectElement;
    expect(select.value).toBe('c1');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, 'c2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    act(() => { button(/import/i).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSubmit).toHaveBeenCalledWith('c2');
  });
});
