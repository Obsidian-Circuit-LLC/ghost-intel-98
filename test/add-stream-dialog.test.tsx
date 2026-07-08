// @vitest-environment jsdom
/**
 * Task 1: News — Add-stream modal.
 *
 * AddStreamDialog collects a draft ({ label, url, kind }) and hands it to the caller on OK; it does
 * not validate or write settings itself (NewsFeedControls.addStream keeps that job via
 * validateStreamUrl). No @testing-library/react in this repo's deps — driven via React 18's
 * createRoot inside act(), mirroring test/news-feed-shared.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddStreamDialog } from '../src/renderer/modules/geoint/AddStreamDialog';

let container: HTMLDivElement;
let root: Root;

/** Set a React-controlled <input>'s value the way a real keystroke would (native setter + input event). */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButtonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
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

describe('AddStreamDialog', () => {
  it('submits the trimmed label, kind and url on OK', async () => {
    const onSubmit = vi.fn();
    await act(async () => { root.render(<AddStreamDialog onSubmit={onSubmit} onCancel={() => {}} />); });

    const labelInput = container.querySelector('input[placeholder="Label"]') as HTMLInputElement;
    const urlInput = container.querySelector('input[aria-label="Stream URL"]') as HTMLInputElement;

    await act(async () => {
      typeInto(labelInput, '  GB News ');
      typeInto(urlInput, 'https://x/stream.m3u8');
    });
    await act(async () => { findButtonByText('OK').click(); });

    expect(onSubmit).toHaveBeenCalledWith({ label: 'GB News', url: 'https://x/stream.m3u8', kind: 'hls' });
  });

  it('Cancel calls onCancel and never onSubmit', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    await act(async () => { root.render(<AddStreamDialog onSubmit={onSubmit} onCancel={onCancel} />); });

    await act(async () => { findButtonByText('Cancel').click(); });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
