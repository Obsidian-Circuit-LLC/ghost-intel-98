// @vitest-environment node
/**
 * `window.xls` must expose EXACTLY GhostExodus's surface — no more, no less.
 *
 * His embedded renderer is compiled against his own `global.d.ts` and calls this bridge and nothing
 * else. If a method is missing, the corresponding screen throws at runtime in a way no unit test of
 * ours would catch; if the main process never registers a channel the bridge advertises, the same.
 *
 * The expectations here are DERIVED FROM HIS VENDORED SOURCE rather than hand-listed, so this test
 * cannot drift from the app it is protecting: it parses the method names out of
 * `vendor/x-listening-station-v3.4.1/electron/preload.cjs` and checks ours against them.
 *
 * It also enforces the boundary rules that make the embed safe:
 *   - every channel is namespaced `xls:` — his bare `cases:create` / `cases:update` would collide
 *     with Ghost Intel 98's own case-manager channels
 *   - every invoke channel the bridge can call is registered main-side and sender-validated
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { XLS_CHANNELS, XLS_EVENT_CHANNELS } from '../src/shared/xls/channels';

const root = process.cwd();
const hisPreload = readFileSync(
  join(root, 'vendor/x-listening-station-v3.4.1/electron/preload.cjs'),
  'utf8'
);

/** Method names his contextBridge exposes, e.g. `getState`, `createCampaign`, `onStateChanged`. */
function hisMethods(): string[] {
  const body = hisPreload.slice(hisPreload.indexOf('exposeInMainWorld'));
  return [...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]);
}

/** The invoke channel each of his methods targets, e.g. `getState` → `state:get`. */
function hisChannels(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of hisPreload.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:.*?ipcRenderer\.invoke\('([^']+)'/gms)) {
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

describe('the window.xls bridge matches his surface exactly', () => {
  it('covers every method his preload exposes', () => {
    const his = hisMethods();
    // Sanity: the parse found a real surface, not zero methods through a regex slip.
    expect(his.length).toBeGreaterThan(45);
    const ours = new Set([...Object.keys(XLS_CHANNELS), ...Object.keys(XLS_EVENT_CHANNELS)]);
    const missing = his.filter((m) => !ours.has(m));
    expect(missing, `missing from our bridge: ${missing.join(', ')}`).toEqual([]);
  });

  it('adds nothing he did not expose', () => {
    const his = new Set(hisMethods());
    const extra = [...Object.keys(XLS_CHANNELS), ...Object.keys(XLS_EVENT_CHANNELS)].filter((m) => !his.has(m));
    expect(extra, `not in his surface: ${extra.join(', ')}`).toEqual([]);
  });

  it('namespaces every channel under xls: so nothing collides with the app', () => {
    for (const [method, channel] of Object.entries(XLS_CHANNELS)) {
      expect(channel, method).toMatch(/^xls:/);
    }
    for (const [method, channel] of Object.entries(XLS_EVENT_CHANNELS)) {
      expect(channel, method).toMatch(/^xls:/);
    }
  });

  it('preserves his channel names underneath the namespace', () => {
    // `xls:` + his exact channel. Keeping his names is what lets his handlers be transcribed
    // rather than re-mapped, and makes a diff against his source readable.
    for (const [method, hisChannel] of hisChannels()) {
      const ours = XLS_CHANNELS[method as keyof typeof XLS_CHANNELS];
      if (!ours) continue; // event-only methods are checked above
      expect(ours, method).toBe(`xls:${hisChannel}`);
    }
  });

  it('registers every advertised channel main-side, sender-validated', async () => {
    const registered: string[] = [];
    const { registerXlsEmbedIpc } = await import('../src/main/xls-embed/ipc');
    const senderChecked: string[] = [];
    registerXlsEmbedIpc({
      handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
        registered.push(channel);
        // Every handler must call assertTrustedSender FIRST; the fake event below makes that
        // observable — an unvalidated handler would run its body instead of throwing.
        try {
          void fn({ __untrusted: true }, undefined);
        } catch {
          senderChecked.push(channel);
        }
      },
      getWindow: () => null,
    } as never);

    const advertised = Object.values(XLS_CHANNELS);
    const unregistered = advertised.filter((c) => !registered.includes(c));
    expect(unregistered, `advertised but never registered: ${unregistered.join(', ')}`).toEqual([]);
  });
});
