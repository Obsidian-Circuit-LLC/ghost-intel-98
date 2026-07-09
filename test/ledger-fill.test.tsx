// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LedgerFill } from '../src/renderer/modules/invoices/LedgerFill';

let container: HTMLDivElement; let root: Root;
const fakeCtx = () => ({ fillRect: vi.fn(), fillText: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), fill: vi.fn(), set font(v){}, set fillStyle(v){}, set textAlign(v){} });

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => fakeCtx());
  (globalThis as any).ResizeObserver = class { observe(){} disconnect(){} };
  (globalThis as any).IntersectionObserver = class { constructor(cb){} observe(){} disconnect(){} };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('LedgerFill', () => {
  it('renders an aria-hidden canvas', async () => {
    await act(async () => { root.render(<LedgerFill />); });
    const c = container.querySelector('canvas');
    expect(c).toBeTruthy(); expect(c!.getAttribute('aria-hidden')).toBe('true');
  });
  it('starts NO animation loop under prefers-reduced-motion (draws once)', async () => {
    (globalThis as any).matchMedia = vi.fn(() => ({ matches: true }));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    await act(async () => { root.render(<LedgerFill />); });
    expect(raf).not.toHaveBeenCalled();
  });
  it('runs the loop when motion is allowed', async () => {
    (globalThis as any).matchMedia = vi.fn(() => ({ matches: false }));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1 as any);
    await act(async () => { root.render(<LedgerFill />); });
    expect(raf).toHaveBeenCalled();
  });
});
