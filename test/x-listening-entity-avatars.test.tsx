// @vitest-environment jsdom
/**
 * X Listening Station — entity display pics (ENTITY INDEX rendering).
 *
 * GhostExodus: "its not pulling display pics from entities". His Enterprise ENTITY INDEX renders an
 * avatar on every MENTION entity's card + a small avatar chip for each finding's source. This ports
 * that look onto the hardened core: the card resolves each handle through `avatarFor` — a LOCAL
 * `data:` URI from the cache-only `avatars` channel (`buildAvatarLookup`), never a remote URL — and
 * falls back to a monogram/initial when no avatar is cached (no broken image, no renderer fetch).
 *
 * Hardening: the entity-avatar path is EGRESS-FREE. Displaying the index (any entity, synthetic or
 * not) resolves avatars only from the local cache — it never touches a capture/session/network
 * channel, so it can never trigger a remote fetch.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

const CAMP = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

const DATA_URI = 'data:image/png;base64,aGVsbG8=';

/** A MENTION entity rollup row (as the `entities` channel returns it — synthetic posts already
 *  excluded upstream by `aggregateEntities`). */
function mentionEntity(handle: string, sources: string[] = []) {
  return {
    id: `mention:${handle}`,
    type: 'mention',
    value: `@${handle}`,
    normalizedValue: handle,
    postIds: ['post-a'],
    sourceUsernames: sources,
    firstObservedAt: '2026-08-01T00:00:00.000Z',
    lastObservedAt: '2026-08-01T00:00:00.000Z',
    count: 1,
  };
}

function makeApi(over: {
  entities?: unknown[];
  avatars?: Record<string, string>;
  fetchResult?: unknown;
} = {}) {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP]),
      campaignsCreate: vi.fn(),
      campaignsSwitch: vi.fn(async () => CAMP),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => []),
      analysis: vi.fn(async () => ({})),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => over.entities ?? [mentionEntity('danielhill')]),
      avatars: vi.fn(async () => over.avatars ?? {}),
      captureTimeline: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] })),
      captureNetwork: vi.fn(async () => ({ blocked: false })),
      verifyPost: vi.fn(async () => ({ availability: 'available', changed: false })),
      openInX: vi.fn(async () => ({ opened: true })),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => null),
      presetsRead: vi.fn(async () => ({ presets: [] })),
      collectionStatus: vi.fn(async () => null),
      fetchDisplayPictures: vi.fn(async () => over.fetchResult ?? {
        ok: true, message: 'Fetched 3 display pictures.', needsClearnetAck: false,
        outcome: { scanned: 5, skipped: 2, visited: 3, cached: 3, blocked: false },
      }),
    },
  };
}

describe('X Listening ENTITY INDEX — display pics', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  function install(over: Parameters<typeof makeApi>[0] = {}) {
    api = makeApi(over);
    (globalThis as any).window.api = api;
  }

  beforeEach(() => {
    useSettings.setState({ settings: { ...defaultSettings } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    useSettings.setState({ settings: null });
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => {
      root.render(<XListeningModule />);
    });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  }
  async function clickTab(matcher: RegExp) {
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) =>
      matcher.test(b.getAttribute('data-tab') || b.textContent || ''),
    ) as HTMLButtonElement | undefined;
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    await act(async () => { hit.click(); });
    await act(async () => { await Promise.resolve(); });
  }

  it('a MENTION entity with a cached avatar renders the LOCAL image (data: URI, never a remote URL)', async () => {
    install({ entities: [mentionEntity('danielhill')], avatars: { danielhill: DATA_URI } });
    await mount();
    await clickTab(/^entities$/i);

    const img = container.querySelector('.xls-entity-heading img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(DATA_URI);
    expect(img!.getAttribute('src')!.startsWith('data:')).toBe(true);
    // No remote URL anywhere in the rendered index.
    expect(container.innerHTML).not.toMatch(/https?:\/\/pbs\.twimg\.com/);
  });

  it('a MENTION entity with NO cached avatar renders the monogram fallback (no broken image)', async () => {
    install({ entities: [mentionEntity('nobody')], avatars: {} });
    await mount();
    await clickTab(/^entities$/i);

    const heading = container.querySelector('.xls-entity-heading') as HTMLElement | null;
    expect(heading).not.toBeNull();
    expect(heading!.querySelector('img')).toBeNull();
    // Monogram = first letter of the handle, uppercased.
    expect(heading!.querySelector('.xls-ident-avatar')?.textContent).toBe('N');
  });

  it('renders a source-avatar chip per finding source (cached → image, uncached → monogram)', async () => {
    install({
      entities: [mentionEntity('danielhill', ['alice', 'bob'])],
      avatars: { danielhill: DATA_URI, alice: DATA_URI },
    });
    await mount();
    await clickTab(/^entities$/i);

    const chips = container.querySelectorAll('.xls-entity-source');
    expect(chips.length).toBe(2);
    // alice is cached → its chip has an image; bob is not → monogram 'B'.
    const chipText = Array.from(chips).map((c) => c.textContent);
    expect(chipText.some((t) => /@alice/.test(t || ''))).toBe(true);
    expect(chipText.some((t) => /@bob/.test(t || ''))).toBe(true);
    const bobChip = Array.from(chips).find((c) => /@bob/.test(c.textContent || ''))!;
    expect(bobChip.querySelector('img')).toBeNull();
    expect(bobChip.querySelector('.xls-ident-avatar')?.textContent).toBe('B');
  });

  it('displaying the index triggers NO fetch — avatars come from the cache-only channel, never egress', async () => {
    // A synthetic-sourced row would never reach the client (aggregateEntities excludes synthetic),
    // but the guarantee is structural: rendering the index touches no capture/session/network path.
    install({ entities: [mentionEntity('danielhill', ['alice'])], avatars: { danielhill: DATA_URI } });
    await mount();
    await clickTab(/^entities$/i);

    // The cache-only avatar lookup is the ONLY avatar resolution — no remote fetch of any kind.
    expect(api.xListening.avatars).toHaveBeenCalledWith('camp-a');
    expect(api.xListening.captureTimeline).not.toHaveBeenCalled();
    expect(api.xListening.captureNetwork).not.toHaveBeenCalled();
    expect(api.xListening.verifyPost).not.toHaveBeenCalled();
    expect(api.xListening.openInX).not.toHaveBeenCalled();
    expect(api.xListening.openSession).not.toHaveBeenCalled();
  });

  /**
   * The pass used to run fire-and-forget and discard its result, so "no pictures" was indistinguishable
   * from "blocked", "nothing to fetch" and "fetch failed" — three releases of invisible failure
   * (GhostExodus: "It's still not extracting the display photos… it was a back and forth pain").
   */
  it('FETCH DISPLAY PICS runs the pass and reports what happened', async () => {
    install();
    await mount();
    await clickTab(/^entities$/i);
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      /FETCH DISPLAY PICS/i.test(b.textContent || ''),
    ) as HTMLButtonElement;
    expect(btn, 'the Entity Index exposes a display-picture fetch').toBeTruthy();
    await act(async () => { btn.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(api.xListening.fetchDisplayPictures).toHaveBeenCalledWith(CAMP.id);
    expect(container.textContent).toMatch(/Fetched 3 display pictures/);
  });

  it('re-reads the avatar map after fetching, so pictures appear without reopening the module', async () => {
    install();
    await mount();
    await clickTab(/^entities$/i);
    const before = api.xListening.avatars.mock.calls.length;
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      /FETCH DISPLAY PICS/i.test(b.textContent || ''),
    ) as HTMLButtonElement;
    await act(async () => { btn.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(api.xListening.avatars.mock.calls.length).toBeGreaterThan(before);
  });

  it('surfaces a blocked gate AND offers the acknowledgement that unblocks it', async () => {
    install({
      fetchResult: {
        ok: false,
        message: 'Display pictures are blocked: clearnet is switched on for capture, but the real-IP exposure has never been acknowledged.',
        needsClearnetAck: true,
        outcome: { scanned: 22, skipped: 0, visited: 0, cached: 0, blocked: true },
      },
    });
    await mount();
    await clickTab(/^entities$/i);
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      /FETCH DISPLAY PICS/i.test(b.textContent || ''),
    ) as HTMLButtonElement;
    await act(async () => { btn.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/never been acknowledged/);
    const ack = Array.from(container.querySelectorAll('button')).find((b) =>
      /ACKNOWLEDGE CLEARNET/i.test(b.textContent || ''),
    );
    expect(ack, 'a blocked-by-ack result offers the acknowledgement').toBeTruthy();
  });
});
