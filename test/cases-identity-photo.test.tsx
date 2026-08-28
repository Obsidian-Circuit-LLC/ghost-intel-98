// @vitest-environment jsdom
/**
 * The case's bio photo appears beside Identity, not only down in Bio images.
 *
 * FIELD REQUEST (GhostExodus): "could you make it so the first photo I upload for the bio pic can
 * simultaneously also appear here?… Obviously without the image stretching."
 *
 * Two things matter and both are asserted here:
 *
 *  1. WHICH image. There is already a primary-image rule in `bio-images.ts:81` — the explicitly
 *     marked primary, else the first one added — and it is what the case list row already shows.
 *     The panel must use the SAME rule rather than inventing a second one, or the list row and the
 *     case header would disagree about which photo represents the case.
 *
 *  2. NOT STRETCHED. The photo is evidence. It is rendered `object-fit: contain`, which preserves
 *     aspect ratio and shows the WHOLE frame — `cover` would fill the box more attractively but
 *     silently crops, and cropping evidence imagery in a forensic tool is not a cosmetic choice.
 *
 * The full-size original is used rather than the 96px list thumbnail, which would be visibly soft
 * at portrait size.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BioImage } from '@shared/types';
import { IdentityPhoto, pickIdentityPhoto } from '../src/renderer/modules/cases/IdentityPhoto';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function img(over: Partial<BioImage> = {}): BioImage {
  return {
    id: 'b1', fileName: 'f.png', thumbName: 't.png', originalName: 'orig.png',
    mime: 'image/png', width: 800, height: 1000, size: 1234,
    importedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as BioImage;
}

describe('pickIdentityPhoto — the same rule the case list uses', () => {
  it('prefers the explicitly marked primary', () => {
    const chosen = pickIdentityPhoto([
      img({ id: 'a' }),
      img({ id: 'b', isPrimary: true }),
      img({ id: 'c' }),
    ]);
    expect(chosen?.id).toBe('b');
  });

  it('falls back to the first uploaded when none is marked', () => {
    expect(pickIdentityPhoto([img({ id: 'a' }), img({ id: 'b' })])?.id).toBe('a');
  });

  it('is null when the case has no bio images', () => {
    expect(pickIdentityPhoto([])).toBeNull();
    expect(pickIdentityPhoto(undefined)).toBeNull();
  });
});

describe('IdentityPhoto', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as any).window.api = {
      bioImages: { readOriginal: vi.fn(async () => 'data:image/png;base64,AAAA') },
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    vi.restoreAllMocks();
  });

  async function mount(images: BioImage[]) {
    await act(async () => { root.render(<IdentityPhoto caseId="case-1" images={images} />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }

  it('renders the primary photo at full size, never stretched', async () => {
    await mount([img({ id: 'a' }), img({ id: 'b', isPrimary: true })]);
    const el = container.querySelector('img.ga98-case-identity-photo') as HTMLImageElement | null;
    expect(el, 'the identity photo rendered').not.toBeNull();
    expect(el!.style.objectFit).toBe('contain');
    expect(el!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    // It read the ORIGINAL for the chosen image, not the list thumbnail.
    expect((window as any).api.bioImages.readOriginal).toHaveBeenCalledWith('case-1', 'b');
  });

  it('renders nothing at all when the case has no bio images', async () => {
    await mount([]);
    expect(container.querySelector('.ga98-case-identity-photo')).toBeNull();
    expect((window as any).api.bioImages.readOriginal).not.toHaveBeenCalled();
  });

  it('degrades to no photo rather than throwing when the image cannot be read', async () => {
    // A locked vault or a missing file must not take the whole Identity panel down with it.
    (globalThis as any).window.api.bioImages.readOriginal = vi.fn(async () => { throw new Error('EVAULTLOCKED'); });
    await mount([img({ id: 'a' })]);
    expect(container.querySelector('.ga98-case-identity-photo')).toBeNull();
  });

  it('survives an older preload with no bioImages bridge', async () => {
    (globalThis as any).window.api = {};
    await mount([img({ id: 'a' })]);
    expect(container.querySelector('.ga98-case-identity-photo')).toBeNull();
  });
});
