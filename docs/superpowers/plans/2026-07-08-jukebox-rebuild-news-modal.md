# Jukebox Rounded-WMP Rebuild + News Add-Stream Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Jukebox into the rounded WMP shell from GhostExodus's mockup (real 10-band EQ, full station manager, real metadata readout, 3-state shade) and replace the News module's inline add-stream form with an Add-stream modal.

**Architecture:** Bottom-up. Pure units (`eq.ts`, `shade.ts`) and shared types/settings land first, then the main-side media library + IPC, then the Web-Audio graph, then the three renderer sub-components (`EqPanel`, `AddStationDialog`, `StationsDrawer`), and finally the `MediaPlayerModule` integration that wires them into the rounded shell. News is one self-contained task up front.

**Tech Stack:** Electron 33 + React + TypeScript, Web Audio API, `music-metadata` (already a dep), `hls.js` (already a dep), vitest + @testing-library/react.

## Global Constraints

- **No new dependency.** `music-metadata` and `hls.js` are already deps. EQ/shade use Web Audio + local state only.
- **No new network egress / no telemetry.** Streaming stays gated behind `settings.media.streamingEnabled` (off by default); `resolveSource` (`src/renderer/modules/media/resolveSource.ts`) is the single choke point. Station **Test** plays through `resolveSource` — it cannot reach the network while streaming is off.
- **No fabricated data.** Show `bitsPerSample` (bit-depth) **only when `music-metadata` returns it** (WAV/FLAC/AIFF); omit it on MP3. Never print a "16-bit" the file does not declare.
- **Settings safety.** Every new nested `AppSettings.media` field (`eq`, `jukeboxMode`) is added to `mergeSettings` (`src/main/storage/json-fs.ts:922`) — with `eq` deep-merged, since the base `media` spread is shallow — and covered by an upgrade test. (v3.24.0 upgrade-dataloss lesson.)
- **Layering:** `AppSettings.media` cannot import a renderer type, so the `JukeboxMode` union lives in `src/shared/types.ts`; `shade.ts` imports it from there.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path `git add` only; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`).
- **Branch:** `feat/jukebox-rebuild-news-modal`. Implementers commit ONLY on this branch — never checkout/merge/delete branches or touch `main`; the controller merges.
- **Commands:** `pnpm test` (vitest), `pnpm typecheck` (both configs). Component tests mirror the harness in `test/news-feed-shared.test.tsx`.

## File Structure

**New (renderer):** `media/eq.ts` (pure EQ tables/helpers), `media/shade.ts` (pure 3-state model), `media/audio-graph.ts` (Web-Audio graph + EQ chain), `media/EqPanel.tsx`, `media/StationsDrawer.tsx`, `media/AddStationDialog.tsx`, `media/station-test.ts` (reachability + `withTimeout`), `geoint/AddStreamDialog.tsx`.
**New (test):** `test/media-eq.test.ts`, `test/media-shade.test.ts`, `test/media-format-map.test.ts`, `test/media-stations-reorder.test.ts`, `test/media-audio-graph.test.ts`, `test/add-stream-dialog.test.tsx`, `test/add-station-dialog.test.tsx`, `test/stations-drawer.test.tsx`, `test/settings-media-eq-mode.test.ts`, `test/station-test-timeout.test.ts`.
**Modified:** `shared/types.ts` (JukeboxMode + `media.eq`/`media.jukeboxMode` + defaults), `shared/post-mvp-types.ts` (MediaTrack format fields), `shared/ipc-contracts.ts` (2 channels + 2 contracts), `main/storage/json-fs.ts` (mergeSettings), `main/media/library.ts` (pickFormat + reorderStations + exportStations), `main/ipc/register.ts` (2 handlers), `main/security/validate.ts` (id-array validator), `preload/index.ts` + `preload/api.d.ts` (2 media methods), `renderer/modules/geoint/NewsFeedControls.tsx`, `renderer/modules/media/MediaPlayerModule.tsx` (rebuild), `renderer/styles/theme.css`, `test/jukebox-compact.test.ts` (migrated in Task 11). **Removed:** `renderer/modules/media/jukebox-window.ts` (Task 11).

**Sequencing:** 1 News (independent) → 2 eq → 3 shared types/settings → 4 shade → 5 library → 6 IPC/preload → 7 audio-graph → 8 EqPanel → 9 AddStationDialog → 10 StationsDrawer → 11 module integration. Each task leaves the build + full suite green.

---

### Task 1: News — Add-stream modal

**Files:**
- Create: `src/renderer/modules/geoint/AddStreamDialog.tsx`
- Modify: `src/renderer/modules/geoint/NewsFeedControls.tsx`
- Test: `test/add-stream-dialog.test.tsx`

**Interfaces:**
- Consumes: `NewsStreamKind` from `./NewsStreamView`.
- Produces: `AddStreamDialog({ onSubmit, onCancel })` where `onSubmit: (v: { label: string; url: string; kind: NewsStreamKind }) => void`.

- [ ] **Step 1: Write the failing test** `test/add-stream-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddStreamDialog } from '../src/renderer/modules/geoint/AddStreamDialog';

describe('AddStreamDialog', () => {
  it('submits the trimmed label, kind and url on OK', () => {
    const onSubmit = vi.fn();
    render(<AddStreamDialog onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: '  GB News ' } });
    fireEvent.change(screen.getByLabelText('Stream URL'), { target: { value: 'https://x/stream.m3u8' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onSubmit).toHaveBeenCalledWith({ label: 'GB News', url: 'https://x/stream.m3u8', kind: 'hls' });
  });
  it('Cancel calls onCancel and never onSubmit', () => {
    const onSubmit = vi.fn(); const onCancel = vi.fn();
    render(<AddStreamDialog onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test add-stream-dialog` → FAIL ("Cannot find module .../AddStreamDialog").

- [ ] **Step 3: Implement** `src/renderer/modules/geoint/AddStreamDialog.tsx`:

```tsx
/**
 * Modal for adding a custom news stream — Label + kind + URL, OK/Cancel. Replaces the always-visible
 * inline add-form in NewsFeedControls (GhostExodus: reduce what's in the visual path). Reuses the
 * .ga98-dialog-veil / .ga98-dialog-window chrome from DialogHost. Validation stays in NewsFeedControls
 * (validateStreamUrl) — this component only collects and returns the draft.
 */
import { useState } from 'react';
import type { NewsStreamKind } from './NewsStreamView';

export function AddStreamDialog(
  { onSubmit, onCancel }: { onSubmit: (v: { label: string; url: string; kind: NewsStreamKind }) => void; onCancel: () => void }
): JSX.Element {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<NewsStreamKind>('hls');
  function submit(): void { onSubmit({ label: label.trim(), url: url.trim(), kind }); }
  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" aria-label="Add stream">
        <div className="title-bar"><div className="title-bar-text">Add stream</div></div>
        <div className="window-body" style={{ padding: 12, display: 'grid', gap: 6 }}>
          <input className="ga98-text" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} autoFocus />
          <select className="ga98-select" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as NewsStreamKind)}>
            <option value="hls">HLS</option>
            <option value="youtube">YouTube</option>
          </select>
          <input className="ga98-text" aria-label="Stream URL"
            placeholder={kind === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://…/stream.m3u8'}
            value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={submit}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm test add-stream-dialog` → PASS.

- [ ] **Step 5: Wire into `NewsFeedControls.tsx`.** Add `import { AddStreamDialog } from './AddStreamDialog';` and an `adding` state; **remove** the `⧉` pop-out button (the line `<button title="Pop out to its own window" …>⧉</button>`) — keep the `✕` remove; **remove** the entire `<div className="ga98-livenews-add">…</div>` inline add-form block; add an **Add stream** button + the modal. The `active`-guarded fragment becomes just the `✕`, and a new button row follows the dropdown:

```tsx
  const [adding, setAdding] = useState(false);
  // …inside the return, the Stream dropdown row keeps ✕ only:
  //   {active && <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>}
  // Replace the old <div className="ga98-livenews-add"> block with:
  //   <div className="field-row" style={{ marginTop: 6 }}>
  //     <button onClick={() => setAdding(true)}>Add stream</button>
  //   </div>
  //   {adding && (
  //     <AddStreamDialog
  //       onCancel={() => setAdding(false)}
  //       onSubmit={({ label, url, kind }) => {
  //         setForm({ label, url, kind });   // feed the existing addStream() path
  //         setAdding(false);
  //         // addStream reads `form`; call on next tick so state is applied:
  //         queueMicrotask(addStream);
  //       }}
  //     />
  //   )}
```

  Note: `addStream()` reads the `form` state; keep `form`/`setForm` for that. Because React state updates are async, the `queueMicrotask(addStream)` defers until `setForm` is applied. (Alternatively refactor `addStream` to take an explicit arg — implementer's choice, but the deferred call keeps the validated write path untouched.)

- [ ] **Step 6: Run existing News tests + typecheck** — `pnpm test news-feed-shared && pnpm typecheck` → PASS/clean. Update any assertion in `test/news-feed-shared.test.tsx` that referenced the removed `⧉` button or inline form (the dropdown + `✕` + `validateStreamUrl` paths are unchanged).

- [ ] **Step 7: Commit** — `feat(news): Add-stream modal; drop per-row pop-out + inline add-form`.

---

### Task 2: EQ pure tables & helpers

**Files:**
- Create: `src/renderer/modules/media/eq.ts`
- Test: `test/media-eq.test.ts`

**Interfaces:**
- Produces: `EQ_BANDS: number[]` (10); `EQ_GAIN_MIN = -12`, `EQ_GAIN_MAX = 12`; `EQ_FLAT_GAINS: number[]` (10 zeros); `clampGain(db: number): number`; `EQ_PRESETS: Record<string, number[]>`; `presetGains(name: string): number[]`.

- [ ] **Step 1: Write the failing test** `test/media-eq.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EQ_BANDS, EQ_FLAT_GAINS, clampGain, EQ_PRESETS, presetGains } from '../src/renderer/modules/media/eq';

describe('eq tables', () => {
  it('has 10 ISO octave bands', () => {
    expect(EQ_BANDS).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });
  it('flat gains are ten zeros', () => { expect(EQ_FLAT_GAINS).toEqual(new Array(10).fill(0)); });
  it('clampGain bounds to [-12, 12]', () => {
    expect(clampGain(-99)).toBe(-12); expect(clampGain(99)).toBe(12); expect(clampGain(3)).toBe(3);
  });
  it('every preset has one gain per band', () => {
    for (const g of Object.values(EQ_PRESETS)) expect(g).toHaveLength(EQ_BANDS.length);
  });
  it('presetGains falls back to Flat on an unknown name', () => {
    expect(presetGains('nope')).toEqual(EQ_FLAT_GAINS);
    expect(presetGains('Flat')).toEqual(EQ_FLAT_GAINS);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test media-eq` → module not found.

- [ ] **Step 3: Implement** `src/renderer/modules/media/eq.ts`:

```ts
/** Pure EQ tables + helpers for the Jukebox 10-band graphic equalizer. No Web-Audio here — audio-graph.ts
 *  consumes these to build BiquadFilter peaking nodes. Kept pure so the band/preset math is unit-tested. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz, ISO octave centres
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_FLAT_GAINS: number[] = new Array(EQ_BANDS.length).fill(0);

export function clampGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, db));
}

export const EQ_PRESETS: Record<string, number[]> = {
  Flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock:      [5, 4, 3, 1, -1, -1, 2, 3, 4, 5],
  Pop:       [-1, 1, 3, 4, 4, 2, 0, -1, -1, -2],
  Bass:      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  Vocal:     [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
};

export function presetGains(name: string): number[] {
  return (EQ_PRESETS[name] ?? EQ_PRESETS.Flat).map(clampGain);
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test media-eq && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): pure EQ band/preset tables + clamp helpers`.

---

### Task 3: Shared types + settings + mergeSettings

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/post-mvp-types.ts`, `src/main/storage/json-fs.ts`
- Test: `test/settings-media-eq-mode.test.ts`

**Interfaces:**
- Produces: `type JukeboxMode = 'strip' | 'deck' | 'full'` (exported from `shared/types.ts`); `AppSettings.media.eq: { enabled: boolean; gains: number[]; preset: string }`; `AppSettings.media.jukeboxMode: JukeboxMode`; `MediaTrack` optional `bitrate? / sampleRate? / channels? / bitsPerSample? / codec?`.
- Consumes: `EQ_FLAT_GAINS` is NOT imported here (shared can't import renderer) — the default gains are inlined as ten zeros.

- [ ] **Step 1: Write the failing test** `test/settings-media-eq-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
import { mergeSettings } from '../src/main/storage/json-fs';

describe('media.eq + media.jukeboxMode settings', () => {
  it('defaults: EQ off/flat, jukeboxMode strip', () => {
    expect(defaultSettings.media.jukeboxMode).toBe('strip');
    expect(defaultSettings.media.eq).toEqual({ enabled: false, gains: new Array(10).fill(0), preset: 'Flat' });
  });
  it('a legacy settings blob without eq/jukeboxMode upgrades with defaults, keeping siblings', () => {
    const legacy = { ...defaultSettings, media: { streamingEnabled: true, visualizer: false, jukeboxExpanded: true } } as any;
    const m = mergeSettings(defaultSettings, legacy);
    expect(m.media.streamingEnabled).toBe(true);         // sibling preserved
    expect(m.media.jukeboxMode).toBe('strip');           // default filled
    expect(m.media.eq.preset).toBe('Flat');              // default filled
  });
  it('a partial eq patch deep-merges (does not drop gains/preset)', () => {
    const m = mergeSettings(defaultSettings, { media: { eq: { enabled: true } } } as any);
    expect(m.media.eq.enabled).toBe(true);
    expect(m.media.eq.gains).toHaveLength(10);
    expect(m.media.eq.preset).toBe('Flat');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test settings-media-eq-mode`.

- [ ] **Step 3: Implement.**
  - `src/shared/types.ts`: add `export type JukeboxMode = 'strip' | 'deck' | 'full';` near the media types. In the `media` block of `AppSettings`, add:
    ```ts
    /** Jukebox shade state: strip (deck only) → deck (+playlist) → full (+stations drawer). */
    jukeboxMode: JukeboxMode;
    /** 10-band graphic EQ. enabled=false ⇒ flat/transparent. gains are dB per EQ_BANDS index. */
    eq: { enabled: boolean; gains: number[]; preset: string };
    ```
    Keep the existing `jukeboxExpanded` field (deprecated, read by `modeFromLegacy`). Update `defaultSettings.media` (line ~697):
    ```ts
    media: { streamingEnabled: false, visualizer: true, jukeboxExpanded: false,
             jukeboxMode: 'strip', eq: { enabled: false, gains: [0,0,0,0,0,0,0,0,0,0], preset: 'Flat' } },
    ```
  - `src/shared/post-mvp-types.ts`: extend `MediaTrack` with:
    ```ts
    /** Container/codec + stream format, read from music-metadata at index time (best-effort). */
    bitrate?: number;       // bits/sec
    sampleRate?: number;    // Hz
    channels?: number;      // 1 = mono, 2 = stereo
    bitsPerSample?: number; // present only for lossless containers (WAV/FLAC/AIFF); absent for MP3
    codec?: string;         // e.g. 'MPEG 1 Layer 3', 'FLAC'
    ```
  - `src/main/storage/json-fs.ts` `mergeSettings` (line ~934): replace the `media:` line with a deep-merge of `eq`:
    ```ts
    media: {
      ...base.media,
      ...(patch.media ?? {}),
      eq: { ...base.media.eq, ...(patch.media?.eq ?? {}) },
    },
    ```

- [ ] **Step 4: Run → PASS** — `pnpm test settings-media-eq-mode && pnpm typecheck`. (typecheck flags every place that constructs a full `AppSettings.media` literal — fix each by adding the two fields; the test factories are the usual offenders.)
- [ ] **Step 5: Commit** — `feat(media): JukeboxMode + media.eq/jukeboxMode settings + MediaTrack format fields`.

---

### Task 4: Shade 3-state model

**Files:**
- Create: `src/renderer/modules/media/shade.ts`
- Test: `test/media-shade.test.ts`

**Interfaces:**
- Consumes: `JukeboxMode` from `../../../shared/types`.
- Produces: `SHADE_HEIGHTS: Record<JukeboxMode, number>`; `shadeHeight(m): number`; `toggleShade(m): JukeboxMode`; `toggleStations(m): JukeboxMode`; `modeFromLegacy(expanded: boolean | undefined): JukeboxMode`.

- [ ] **Step 1: Write the failing test** `test/media-shade.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SHADE_HEIGHTS, shadeHeight, toggleShade, toggleStations, modeFromLegacy } from '../src/renderer/modules/media/shade';

describe('jukebox shade model', () => {
  it('heights increase strip < deck < full', () => {
    expect(SHADE_HEIGHTS.strip).toBeLessThan(SHADE_HEIGHTS.deck);
    expect(SHADE_HEIGHTS.deck).toBeLessThan(SHADE_HEIGHTS.full);
    expect(shadeHeight('deck')).toBe(SHADE_HEIGHTS.deck);
  });
  it('toggleShade: strip<->deck, and full collapses to strip', () => {
    expect(toggleShade('strip')).toBe('deck');
    expect(toggleShade('deck')).toBe('strip');
    expect(toggleShade('full')).toBe('strip');
  });
  it('toggleStations: deck<->full (strip opens to full via deck-normalised)', () => {
    expect(toggleStations('deck')).toBe('full');
    expect(toggleStations('full')).toBe('deck');
    expect(toggleStations('strip')).toBe('full'); // opening stations from strip expands past deck
  });
  it('modeFromLegacy maps the old boolean', () => {
    expect(modeFromLegacy(true)).toBe('full');
    expect(modeFromLegacy(false)).toBe('strip');
    expect(modeFromLegacy(undefined)).toBe('strip');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test media-shade`.

- [ ] **Step 3: Implement** `src/renderer/modules/media/shade.ts`:

```ts
/** Pure 3-state shade model for the Jukebox window: strip (deck only) → deck (+playlist) → full
 *  (+stations drawer). Replaces jukebox-window.ts's 2-state height map. The `Playlist` button drives
 *  toggleShade (strip<->deck); the drawer down-arrow drives toggleStations (deck<->full). Heights are
 *  logical px (DPI-independent) and tunable; the module fits the WINDOW to shadeHeight(mode). */
import type { JukeboxMode } from '../../../shared/types';

export const SHADE_HEIGHTS: Record<JukeboxMode, number> = { strip: 150, deck: 470, full: 780 };

export function shadeHeight(m: JukeboxMode): number { return SHADE_HEIGHTS[m]; }

/** Playlist button: show/hide the playlist. From full, collapse all the way to strip. */
export function toggleShade(m: JukeboxMode): JukeboxMode { return m === 'strip' ? 'deck' : 'strip'; }

/** Stations down-arrow: open/close the drawer. From strip (arrow hidden but defensive), open to full. */
export function toggleStations(m: JukeboxMode): JukeboxMode { return m === 'full' ? 'deck' : 'full'; }

/** One-time migration from the deprecated jukeboxExpanded boolean. */
export function modeFromLegacy(expanded: boolean | undefined): JukeboxMode { return expanded ? 'full' : 'strip'; }
```

- [ ] **Step 4: Run → PASS** — `pnpm test media-shade && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): pure 3-state jukebox shade model`.

---

### Task 5: Main media library — metadata fields, station reorder & export

**Files:**
- Modify: `src/main/media/library.ts`, `src/main/security/validate.ts`
- Test: `test/media-format-map.test.ts`, `test/media-stations-reorder.test.ts`

**Interfaces:**
- Consumes: `MediaTrack` format fields (Task 3).
- Produces: `pickFormat(format): Pick<MediaTrack,'bitrate'|'sampleRate'|'channels'|'bitsPerSample'|'codec'>` (pure, exported); `reorderStations(orderedIds: string[]): Promise<MediaLibrarySnapshot>`; `exportStations(): Promise<{ label: string; url: string }[]>` (returns the list; the IPC handler in Task 6 writes the file); `ensureIdArray(v: unknown): string[]` in `validate.ts`.

- [ ] **Step 1: Write the failing tests.**

`test/media-format-map.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickFormat } from '../src/main/media/library';

describe('pickFormat', () => {
  it('maps mp3 format (no bitsPerSample)', () => {
    const f = pickFormat({ bitrate: 320000, sampleRate: 44100, numberOfChannels: 2, codec: 'MPEG 1 Layer 3' });
    expect(f).toEqual({ bitrate: 320000, sampleRate: 44100, channels: 2, codec: 'MPEG 1 Layer 3' });
    expect('bitsPerSample' in f).toBe(false); // never fabricate a bit-depth
  });
  it('includes bitsPerSample when the container declares it (flac/wav)', () => {
    const f = pickFormat({ bitrate: 900000, sampleRate: 48000, numberOfChannels: 2, bitsPerSample: 16, codec: 'FLAC' });
    expect(f.bitsPerSample).toBe(16);
  });
  it('drops undefined fields entirely', () => {
    expect(pickFormat({})).toEqual({});
  });
});
```

`test/media-stations-reorder.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as lib from '../src/main/media/library';

describe('reorderStations', () => {
  beforeEach(async () => { await lib._resetForTest(); });
  it('reorders to match the given id order; appends any not listed; ignores unknown ids', async () => {
    const a = await lib.upsertStation({ label: 'A', url: 'https://a/' });
    const b = await lib.upsertStation({ label: 'B', url: 'https://b/' });
    const c = await lib.upsertStation({ label: 'C', url: 'https://c/' });
    const snap = await lib.reorderStations([c.id, a.id, 'ghost']); // b omitted, ghost unknown
    expect(snap.stations.map((s) => s.label)).toEqual(['C', 'A', 'B']);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test media-format-map media-stations-reorder`.

- [ ] **Step 3: Implement.**
  - `src/main/media/library.ts`:
    - Widen the `parseFileFn` type to expose format fields:
      ```ts
      let parseFileFn: ((p: string, opts?: { duration?: boolean }) => Promise<{
        common: { title?: string; artist?: string; album?: string; picture?: { data: Uint8Array }[] };
        format: { duration?: number; bitrate?: number; sampleRate?: number; numberOfChannels?: number; bitsPerSample?: number; codec?: string };
      }>) | null = null;
      ```
    - Add the pure mapper (exported) above `refresh`:
      ```ts
      /** Best-effort format fields from a music-metadata `format` object. Omits any field the parser
       *  didn't provide — in particular bitsPerSample is absent for MP3, so we never invent a bit-depth. */
      export function pickFormat(f: { bitrate?: number; sampleRate?: number; numberOfChannels?: number; bitsPerSample?: number; codec?: string }):
        Pick<MediaTrack, 'bitrate' | 'sampleRate' | 'channels' | 'bitsPerSample' | 'codec'> {
        const out: Pick<MediaTrack, 'bitrate' | 'sampleRate' | 'channels' | 'bitsPerSample' | 'codec'> = {};
        if (f.bitrate != null) out.bitrate = Math.round(f.bitrate);
        if (f.sampleRate != null) out.sampleRate = f.sampleRate;
        if (f.numberOfChannels != null) out.channels = f.numberOfChannels;
        if (f.bitsPerSample != null) out.bitsPerSample = f.bitsPerSample;
        if (f.codec) out.codec = f.codec;
        return out;
      }
      ```
    - In `refresh()`, after the `track.durationMs = …` line, add `Object.assign(track, pickFormat(meta.format));`.
    - Add the two store functions (mirror `upsertStation`'s read/mutate/write):
      ```ts
      export async function reorderStations(orderedIds: string[]): Promise<MediaLibrarySnapshot> {
        const s = await read();
        const byId = new Map(s.stations.map((x) => [x.id, x]));
        const seen = new Set<string>();
        const next: MediaStation[] = [];
        for (const id of orderedIds) { const st = byId.get(id); if (st && !seen.has(id)) { next.push(st); seen.add(id); } }
        for (const st of s.stations) if (!seen.has(st.id)) next.push(st); // append any not listed
        s.stations = next;
        await write(s);
        return s;
      }
      export async function exportStations(): Promise<{ label: string; url: string }[]> {
        const s = await read();
        return s.stations.map((x) => ({ label: x.label, url: x.url }));
      }
      ```
  - `src/main/security/validate.ts`: add
    ```ts
    export function ensureIdArray(v: unknown): string[] {
      if (!Array.isArray(v)) throw new ValidationError('expected an array of station ids');
      return v.map((x) => { if (typeof x !== 'string' || x.length > 128) throw new ValidationError('id must be a short string'); return x; });
    }
    ```

- [ ] **Step 4: Run → PASS** — `pnpm test media-format-map media-stations-reorder && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): parse format fields + station reorder/export in the library`.

---

### Task 6: Media IPC + preload — reorderStations & exportStations

**Files:**
- Modify: `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`
- Test: `test/media-ipc-channels.test.ts`

**Interfaces:**
- Consumes: `reorderStations`, `exportStations` (Task 5); `ensureIdArray` (Task 5); `MediaStation`, `MediaLibrarySnapshot`.
- Produces: `channels.media.reorderStations = 'media:reorderStations'`, `channels.media.exportStations = 'media:exportStations'`; preload `window.api.media.reorderStations(ids: string[])`, `window.api.media.exportStations()`.

- [ ] **Step 1: Write the failing test** `test/media-ipc-channels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('media IPC channels', () => {
  it('exposes reorderStations + exportStations', () => {
    expect(channels.media.reorderStations).toBe('media:reorderStations');
    expect(channels.media.exportStations).toBe('media:exportStations');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test media-ipc-channels`.

- [ ] **Step 3: Implement.**
  - `src/shared/ipc-contracts.ts`: in the `media:` channel block (line ~328) add `reorderStations: 'media:reorderStations',` and `exportStations: 'media:exportStations'`. In the `ChannelContract` map (near line ~877) add:
    ```ts
    [channels.media.reorderStations]: { args: [string[]]; returns: MediaLibrarySnapshot };
    [channels.media.exportStations]: { args: []; returns: string | null };
    ```
  - `src/main/ipc/register.ts`: after the `deleteStation` handler (line ~1317) add:
    ```ts
    safeHandle(channels.media.reorderStations, (...args) => mediaLib.reorderStations(ensureIdArray(args[0])));
    safeHandle(channels.media.exportStations, async () => {
      const stations = await mediaLib.exportStations();
      const win = getWindow();
      const r = win ? await dialog.showSaveDialog(win, { defaultPath: 'stations.json' })
                    : await dialog.showSaveDialog({ defaultPath: 'stations.json' });
      if (r.canceled || !r.filePath) return null;
      try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await writeFile(r.filePath, JSON.stringify(stations, null, 2), 'utf8');
      return basename(r.filePath);
    });
    ```
    Add `ensureIdArray` to the existing `../security/validate` import. (`dialog`, `writeFile`, `lstat`, `basename` are already imported for `savePlaylist`.)
  - `src/preload/index.ts` (media block, line ~316) add:
    ```ts
    reorderStations: (ids: string[]) => ipcRenderer.invoke(channels.media.reorderStations, ids),
    exportStations: () => ipcRenderer.invoke(channels.media.exportStations),
    ```
  - `src/preload/api.d.ts`: mirror the two method signatures — `reorderStations(ids: string[]): Promise<MediaLibrarySnapshot>；exportStations(): Promise<string | null>`.

- [ ] **Step 4: Run → PASS** — `pnpm test media-ipc-channels && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): reorderStations + exportStations IPC + preload`.

---

### Task 7: Web-Audio graph + EQ chain

**Files:**
- Create: `src/renderer/modules/media/audio-graph.ts`
- Test: `test/media-audio-graph.test.ts`

**Interfaces:**
- Consumes: `EQ_BANDS`, `clampGain` (Task 2).
- Produces: `class JukeboxGraph { constructor(audio: HTMLAudioElement); readonly analyser: AnalyserNode; resume(): void; applyGains(gains: number[]): void; setBandGain(i: number, db: number): void; close(): void }`.

- [ ] **Step 1: Write the failing test** `test/media-audio-graph.test.ts` (mock Web-Audio):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JukeboxGraph } from '../src/renderer/modules/media/audio-graph';
import { EQ_BANDS } from '../src/renderer/modules/media/eq';

function fakeCtx() {
  const nodes: any[] = [];
  const mk = (extra: any = {}) => { const n = { connect: vi.fn(), ...extra }; nodes.push(n); return n; };
  return {
    _nodes: nodes,
    createMediaElementSource: () => mk(),
    createAnalyser: () => mk({ fftSize: 0 }),
    createBiquadFilter: () => mk({ type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } }),
    resume: vi.fn(), close: vi.fn(), destination: {},
  };
}

describe('JukeboxGraph', () => {
  beforeEach(() => { (globalThis as any).AudioContext = vi.fn(() => fakeCtx()); });
  it('builds one peaking filter per band and exposes an analyser', () => {
    const g = new JukeboxGraph({} as HTMLAudioElement);
    const filters = (g as any).bands as any[];
    expect(filters).toHaveLength(EQ_BANDS.length);
    expect(filters[0].type).toBe('peaking');
    expect(filters[0].frequency.value).toBe(EQ_BANDS[0]);
    expect(g.analyser).toBeTruthy();
  });
  it('applyGains clamps and writes each band gain', () => {
    const g = new JukeboxGraph({} as HTMLAudioElement);
    g.applyGains(new Array(EQ_BANDS.length).fill(99));
    for (const f of (g as any).bands as any[]) expect(f.gain.value).toBe(12);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test media-audio-graph`.

- [ ] **Step 3: Implement** `src/renderer/modules/media/audio-graph.ts`:

```ts
/** The Jukebox Web-Audio graph: MediaElementSource → [10 peaking biquads] → Analyser → destination.
 *  Built lazily on first play (autoplay policy needs a gesture) and reused. The analyser taps AFTER the
 *  EQ, so the visualizer reflects what you hear. Disabled EQ = flat gains (transparent), no reconnect. */
import { EQ_BANDS, clampGain } from './eq';

export class JukeboxGraph {
  private ctx: AudioContext;
  private bands: BiquadFilterNode[] = [];
  readonly analyser: AnalyserNode;

  constructor(audio: HTMLAudioElement) {
    const Ctx = window.AudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaElementSource(audio);
    let node: AudioNode = src;
    for (const hz of EQ_BANDS) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = hz;
      f.Q.value = 1.0;
      f.gain.value = 0;
      node.connect(f);
      node = f;
      this.bands.push(f);
    }
    const an = this.ctx.createAnalyser();
    an.fftSize = 128;
    node.connect(an);
    an.connect(this.ctx.destination);
    this.analyser = an;
  }

  resume(): void { void this.ctx.resume(); }
  setBandGain(i: number, db: number): void { const f = this.bands[i]; if (f) f.gain.value = clampGain(db); }
  applyGains(gains: number[]): void { this.bands.forEach((f, i) => { f.gain.value = clampGain(gains[i] ?? 0); }); }
  close(): void { void this.ctx.close(); }
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test media-audio-graph && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): Web-Audio graph with 10-band EQ chain`.

---

### Task 8: EqPanel component

**Files:**
- Create: `src/renderer/modules/media/EqPanel.tsx`
- Test: `test/eq-panel.test.tsx`

**Interfaces:**
- Consumes: `EQ_BANDS`, `EQ_GAIN_MIN/MAX`, `EQ_PRESETS`, `presetGains` (Task 2).
- Produces: `EqPanel({ eq, onChange })` where `eq: { enabled: boolean; gains: number[]; preset: string }` and `onChange: (next: { enabled: boolean; gains: number[]; preset: string }) => void`.

- [ ] **Step 1: Write the failing test** `test/eq-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EqPanel } from '../src/renderer/modules/media/EqPanel';

const base = { enabled: true, gains: new Array(10).fill(0), preset: 'Flat' };

describe('EqPanel', () => {
  it('choosing a preset emits its gains and preset name', () => {
    const onChange = vi.fn();
    render(<EqPanel eq={base} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('EQ preset'), { target: { value: 'Bass' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: 'Bass' }));
    expect(onChange.mock.calls[0][0].gains[0]).toBeGreaterThan(0);
  });
  it('toggling enabled emits the flag', () => {
    const onChange = vi.fn();
    render(<EqPanel eq={base} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('EQ on'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test eq-panel`.

- [ ] **Step 3: Implement** `src/renderer/modules/media/EqPanel.tsx`:

```tsx
/** The Jukebox equalizer panel — ten vertical band sliders + preset select + on/off. Presentational:
 *  it owns no persistence; the parent maps onChange to settings.media.eq and the live audio graph. */
import { EQ_BANDS, EQ_GAIN_MIN, EQ_GAIN_MAX, EQ_PRESETS, presetGains } from './eq';

export interface EqState { enabled: boolean; gains: number[]; preset: string }

export function EqPanel({ eq, onChange }: { eq: EqState; onChange: (next: EqState) => void }): JSX.Element {
  function setBand(i: number, v: number): void {
    const gains = eq.gains.slice(); gains[i] = v;
    onChange({ ...eq, gains, preset: 'Custom' });
  }
  return (
    <div className="ga98-eq-panel">
      <div className="ga98-eq-head">
        <label><input type="checkbox" aria-label="EQ on" checked={eq.enabled}
          onChange={() => onChange({ ...eq, enabled: !eq.enabled })} /> EQ</label>
        <select className="ga98-select" aria-label="EQ preset" value={eq.preset}
          onChange={(e) => onChange({ ...eq, preset: e.target.value, gains: presetGains(e.target.value) })}>
          {eq.preset === 'Custom' && <option value="Custom">Custom</option>}
          {Object.keys(EQ_PRESETS).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="ga98-eq-bands">
        {EQ_BANDS.map((hz, i) => (
          <div className="ga98-eq-band" key={hz}>
            <input type="range" min={EQ_GAIN_MIN} max={EQ_GAIN_MAX} step={1}
              // vertical slider; orient in CSS (writing-mode / appearance)
              aria-label={`${hz} Hz`} value={eq.gains[i] ?? 0}
              onChange={(e) => setBand(i, Number(e.target.value))} disabled={!eq.enabled} />
            <span className="ga98-eq-label">{hz >= 1000 ? `${hz / 1000}k` : hz}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test eq-panel && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): EqPanel (band sliders + presets + on/off)`.

---

### Task 9: AddStationDialog (Add/Edit) component

**Files:**
- Create: `src/renderer/modules/media/AddStationDialog.tsx`
- Test: `test/add-station-dialog.test.tsx`

**Interfaces:**
- Produces: `AddStationDialog({ initial, onSubmit, onCancel })` — `initial?: { id?: string; label: string; url: string }`; `onSubmit: (v: { id?: string; label: string; url: string }) => void`. Title shows "Edit station" when `initial?.id` is set, else "Add station".

- [ ] **Step 1: Write the failing test** `test/add-station-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddStationDialog } from '../src/renderer/modules/media/AddStationDialog';

describe('AddStationDialog', () => {
  it('add mode: returns trimmed label + url, no id', () => {
    const onSubmit = vi.fn();
    render(<AddStationDialog onSubmit={onSubmit} onCancel={() => {}} />);
    expect(screen.getByText('Add station')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: ' Rekt ' } });
    fireEvent.change(screen.getByPlaceholderText('http(s) stream URL'), { target: { value: 'https://s/' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onSubmit).toHaveBeenCalledWith({ label: 'Rekt', url: 'https://s/' });
  });
  it('edit mode: pre-fills and carries the id', () => {
    const onSubmit = vi.fn();
    render(<AddStationDialog initial={{ id: 'x1', label: 'Old', url: 'https://o/' }} onSubmit={onSubmit} onCancel={() => {}} />);
    expect(screen.getByText('Edit station')).toBeTruthy();
    fireEvent.click(screen.getByText('OK'));
    expect(onSubmit).toHaveBeenCalledWith({ id: 'x1', label: 'Old', url: 'https://o/' });
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test add-station-dialog`.

- [ ] **Step 3: Implement** `src/renderer/modules/media/AddStationDialog.tsx`:

```tsx
/** Add/Edit a streaming station — Label + URL, OK/Cancel. Shared by the drawer's Add and Edit buttons;
 *  Edit passes `initial` (with id) to pre-fill and carry the id back through onSubmit → upsertStation. */
import { useState } from 'react';

export interface StationDraft { id?: string; label: string; url: string }

export function AddStationDialog(
  { initial, onSubmit, onCancel }: { initial?: StationDraft; onSubmit: (v: StationDraft) => void; onCancel: () => void }
): JSX.Element {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  function submit(): void {
    const v: StationDraft = { label: label.trim(), url: url.trim() };
    if (initial?.id) v.id = initial.id;
    onSubmit(v);
  }
  return (
    <div className="ga98-dialog-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div className="window ga98-dialog-window" role="dialog" aria-modal="true" aria-label={initial?.id ? 'Edit station' : 'Add station'}>
        <div className="title-bar"><div className="title-bar-text">{initial?.id ? 'Edit station' : 'Add station'}</div></div>
        <div className="window-body" style={{ padding: 12, display: 'grid', gap: 6 }}>
          <input className="ga98-text" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} autoFocus />
          <input className="ga98-text" placeholder="http(s) stream URL" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={submit} disabled={!label.trim() || !url.trim()}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test add-station-dialog && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): AddStationDialog (shared Add/Edit modal)`.

---

### Task 10: StationsDrawer + station reachability test

**Files:**
- Create: `src/renderer/modules/media/StationsDrawer.tsx`, `src/renderer/modules/media/station-test.ts`
- Test: `test/station-test-timeout.test.ts`, `test/stations-drawer.test.tsx`

**Interfaces:**
- Consumes: `AddStationDialog`/`StationDraft` (Task 9); `resolveSource`, `isHlsUrl` (existing); `MediaStation`; `window.api.media.{upsertStation,deleteStation,reorderStations,exportStations}` (Tasks 5–6).
- Produces: `withTimeout<T>(p: Promise<T>, ms: number): Promise<T>` (rejects `'timeout'`); `testStation(url, streamingEnabled): Promise<'ok'|'off'|'fail'>`; `StationsDrawer({ stations, streamingEnabled, onPlay, onChanged, onEnableStreaming })`.

- [ ] **Step 1: Write the failing tests.**

`test/station-test-timeout.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { withTimeout, testStation } from '../src/renderer/modules/media/station-test';

describe('withTimeout', () => {
  it('rejects with timeout when the promise is slow', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 8000);
    vi.advanceTimersByTime(8000);
    await expect(p).rejects.toBe('timeout');
    vi.useRealTimers();
  });
});
describe('testStation', () => {
  it('short-circuits to "off" when streaming is disabled', async () => {
    expect(await testStation('https://s/x.m3u8', false)).toBe('off');
  });
});
```

`test/stations-drawer.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StationsDrawer } from '../src/renderer/modules/media/StationsDrawer';

const stations = [{ id: 'a', label: 'A', url: 'https://a/' }, { id: 'b', label: 'B', url: 'https://b/' }];

beforeEach(() => {
  (globalThis as any).window.api = { media: {
    upsertStation: vi.fn(async () => ({ id: 'a', label: 'A', url: 'https://a/' })),
    deleteStation: vi.fn(async () => {}),
    reorderStations: vi.fn(async () => ({ roots: [], tracks: [], stations })),
    exportStations: vi.fn(async () => 'stations.json'),
  } };
});

describe('StationsDrawer', () => {
  it('moving A down calls reorderStations with [b, a]', async () => {
    const onChanged = vi.fn();
    render(<StationsDrawer stations={stations} streamingEnabled onPlay={() => {}} onChanged={onChanged} onEnableStreaming={() => {}} />);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]);
    expect((window as any).api.media.reorderStations).toHaveBeenCalledWith(['b', 'a']);
  });
  it('shows the opt-in card when streaming is off', () => {
    render(<StationsDrawer stations={stations} streamingEnabled={false} onPlay={() => {}} onChanged={() => {}} onEnableStreaming={() => {}} />);
    expect(screen.getByText(/internet streaming is off/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test station-test-timeout stations-drawer`.

- [ ] **Step 3: Implement** `src/renderer/modules/media/station-test.ts`:

```ts
/** Best-effort stream reachability for the drawer's Test button. Goes through the SAME egress gate as
 *  playback (resolveSource): when streaming is off it returns 'off' and never touches the network. */
import Hls from 'hls.js';
import { resolveSource, isHlsUrl } from './resolveSource';

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject('timeout'), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function testStation(url: string, streamingEnabled: boolean): Promise<'ok' | 'off' | 'fail'> {
  const resolved = resolveSource({ url }, streamingEnabled);
  if (!resolved) return 'off';
  try {
    if (isHlsUrl(url) && Hls.isSupported()) {
      await withTimeout(new Promise<void>((res, rej) => {
        const hls = new Hls();
        hls.on(Hls.Events.MANIFEST_PARSED, () => { hls.destroy(); res(); });
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) { hls.destroy(); rej('fail'); } });
        hls.loadSource(url);
      }), 8000);
    } else {
      await withTimeout(new Promise<void>((res, rej) => {
        const a = new Audio(); a.src = resolved.src;
        a.addEventListener('loadedmetadata', () => res(), { once: true });
        a.addEventListener('error', () => rej('fail'), { once: true });
      }), 8000);
    }
    return 'ok';
  } catch { return 'fail'; }
}
```

  Then `src/renderer/modules/media/StationsDrawer.tsx` — list + Add/Edit/Remove/Up/Down/Save-List/Test + Now-Playing-Station panel:

```tsx
/** The fold-out STREAM STATIONS drawer (full-shade). Gated behind the streaming opt-in like today; shows
 *  the opt-in card when off. Add/Edit via AddStationDialog → upsertStation; Remove → deleteStation;
 *  Up/Down → reorderStations; Save List… → exportStations; Test → testStation (egress-gated). */
import { useState } from 'react';
import type { MediaStation } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';
import { AddStationDialog, type StationDraft } from './AddStationDialog';
import { testStation } from './station-test';

export function StationsDrawer(
  { stations, streamingEnabled, onPlay, onChanged, onEnableStreaming }:
  { stations: MediaStation[]; streamingEnabled: boolean; onPlay: (s: MediaStation) => void;
    onChanged: () => void; onEnableStreaming: () => void }
): JSX.Element {
  const [editing, setEditing] = useState<StationDraft | null>(null);   // null = closed; {} = add; {id,…} = edit
  const [status, setStatus] = useState<'ok' | 'off' | 'fail' | 'testing' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function save(v: StationDraft): Promise<void> {
    try { await window.api.media.upsertStation(v); setEditing(null); onChanged(); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function remove(id: string): Promise<void> {
    try { await window.api.media.deleteStation(id); onChanged(); } catch (err) { toast.error((err as Error).message); }
  }
  async function move(i: number, dir: -1 | 1): Promise<void> {
    const j = i + dir; if (j < 0 || j >= stations.length) return;
    const ids = stations.map((s) => s.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await window.api.media.reorderStations(ids); onChanged(); } catch (err) { toast.error((err as Error).message); }
  }
  async function saveList(): Promise<void> {
    try { const f = await window.api.media.exportStations(); if (f) toast.success(`Saved ${f}`); }
    catch (err) { toast.error((err as Error).message); }
  }
  async function test(url: string): Promise<void> {
    setStatus('testing'); const r = await testStation(url, streamingEnabled); setStatus(r);
    if (r === 'off') toast.warn('Internet streaming is off — enable it to test a station.');
    else if (r === 'fail') toast.error('Stream did not load.');
    else toast.success('Stream reachable.');
  }

  if (!streamingEnabled) {
    return (
      <div className="ga98-stations-drawer">
        <p style={{ fontSize: 11, color: '#555' }}>Internet streaming is off. Local playback never touches the network; turning this on lets the Jukebox reach the internet for radio.</p>
        <button onClick={onEnableStreaming}>Allow internet streaming</button>
      </div>
    );
  }

  const sel = stations.find((s) => s.id === selected) ?? null;
  return (
    <div className="ga98-stations-drawer">
      <div className="ga98-stations-list">
        <ul className="ga98-list">
          {stations.map((s, i) => (
            <li key={s.id} data-active={s.id === selected} onClick={() => setSelected(s.id)} onDoubleClick={() => onPlay(s)}>
              <span style={{ flex: 1 }}>{s.label}</span>
              <button aria-label="Move up" title="Up" onClick={(e) => { e.stopPropagation(); void move(i, -1); }}>▲</button>
              <button aria-label="Move down" title="Down" onClick={(e) => { e.stopPropagation(); void move(i, 1); }}>▼</button>
              <button aria-label="Edit" title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>✎</button>
              <button aria-label="Remove" title="Remove" onClick={(e) => { e.stopPropagation(); void remove(s.id); }}>✕</button>
            </li>
          ))}
        </ul>
        <div className="field-row" style={{ gap: 4, marginTop: 4 }}>
          <button onClick={() => setEditing({ label: '', url: '' })}>Add stream…</button>
          <button onClick={() => void saveList()} disabled={stations.length === 0}>Save List…</button>
        </div>
      </div>
      <div className="ga98-now-station">
        <div className="ga98-now-station-title">Now Playing Station</div>
        <div className="ga98-now-station-body">{sel ? sel.label : '—'}</div>
        {sel && <button onClick={() => void test(sel.url)}>Test</button>}
        {status && <span className={`ga98-test-dot ga98-test-${status}`} aria-label={`test ${status}`} />}
      </div>
      {editing && <AddStationDialog initial={editing.id ? editing : undefined} onCancel={() => setEditing(null)} onSubmit={(v) => void save(v)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test station-test-timeout stations-drawer && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media): StationsDrawer (add/edit/remove/reorder/save-list/test) + reachability`.

---

### Task 11: MediaPlayerModule rebuild + rounded shell + integration

**Files:**
- Modify: `src/renderer/modules/media/MediaPlayerModule.tsx`, `src/renderer/styles/theme.css`, `src/renderer/modules/register-builtins.tsx`, `test/jukebox-compact.test.ts`
- Remove: `src/renderer/modules/media/jukebox-window.ts`
- Test: `test/jukebox-module.test.tsx` (new smoke), migrate `test/jukebox-compact.test.ts`

**Interfaces:**
- Consumes: `JukeboxGraph` (T7), `EqPanel`/`EqState` (T8), `StationsDrawer` (T10), `shadeHeight`/`toggleShade`/`toggleStations`/`modeFromLegacy` (T4), `presetGains` (T2), `settings.media.{eq,jukeboxMode}` (T3), `MediaTrack` format fields (T3).

This is the integration task — it wires the sub-components into the rounded shell, replaces the 2-state `collapsed` with the 3-state `mode`, feeds the audio graph through `JukeboxGraph`, and renders the metadata readout. Keep every existing playback behavior (queue, drag-drop, playlist save/load, prev/next/shuffle/repeat, volume, seek, streaming gate).

- [ ] **Step 1: Migrate the failing test.** Replace `test/jukebox-compact.test.ts` with `test/jukebox-module.test.tsx` covering the new wiring; delete the `jukebox-window` import block (now covered by `media-shade.test.ts`). New smoke test:

```tsx
import { describe, it, expect } from 'vitest';
import { shadeHeight } from '../src/renderer/modules/media/shade';
import { defaultSettings } from '../src/shared/types';

describe('jukebox integration invariants', () => {
  it('default mode is strip and maps to the shortest height', () => {
    expect(defaultSettings.media.jukeboxMode).toBe('strip');
    expect(shadeHeight('strip')).toBeLessThan(shadeHeight('full'));
  });
});
```

  (Deeper render-smoke of `MediaPlayerModule` requires mocking `window.api.media` + `AudioContext`; add a render test asserting the deck's Now-Playing readout and the Playlist/EQ buttons mount, mirroring the `stations-drawer` harness.)

- [ ] **Step 2: Run → FAIL** (old `jukebox-compact.test.ts` imports removed / new assertions absent) — `pnpm test jukebox`.

- [ ] **Step 3: Implement the rebuild** in `MediaPlayerModule.tsx`:
  - **State swap:** remove `collapsed` + the `jukeboxWindowHeight` import/effect. Add `const [mode, setMode] = useState<JukeboxMode>(settings?.media.jukeboxMode ?? modeFromLegacy(settings?.media.jukeboxExpanded));` and hydrate it from settings on first load (mirror the existing `hydratedRef` pattern). Effect: `useWindows.getState().update(spec.id, { height: shadeHeight(mode) });` on `[mode, spec.id]`. Persist on change: `function setModePersist(next){ setMode(next); void patch({ media: { ...mediaBlock, jukeboxMode: next } }); }` where `mediaBlock` re-sends the full `media` object (streamingEnabled/visualizer/jukeboxExpanded/eq) so the shallow settings write is complete.
  - **Audio graph:** replace `ctxRef`/`analyserRef`/`sourceRef`/`ensureGraph` with a single `graphRef = useRef<JukeboxGraph|null>(null)`. `ensureGraph()` → `if(!graphRef.current) graphRef.current = new JukeboxGraph(audioRef.current!); graphRef.current.resume(); setAnalyser(graphRef.current.analyser); graphRef.current.applyGains(eq.enabled ? eq.gains : EQ_FLAT_GAINS); return graphRef.current.analyser;`. Unmount: `graphRef.current?.close()`.
  - **EQ state:** `const eq = settings?.media.eq ?? { enabled:false, gains:EQ_FLAT_GAINS, preset:'Flat' };` A `showEq` local bool toggled by the `EQ` button. When `EqPanel` emits `onChange(next)`: `void patch({ media:{ ...mediaBlock, eq: next } }); graphRef.current?.applyGains(next.enabled ? next.gains : EQ_FLAT_GAINS);`
  - **Shell layout (rounded):** wrap in `<div className="ga98-jukebox ga98-jukebox-rounded" data-mode={mode}>`. Deck (always): Now-Playing header (note icon, big title, artist, tagline, `Stream`/kbps/kHz badges from the current track's format fields), spectrum (`<Visualizer analyser={analyser} enabled={visualizer} />` top-right), seek + `mm:ss`, control row (`Playlist` button → `setModePersist(toggleShade(mode))`, `EQ` button → `setShowEq(v=>!v)`, Shuffle, Repeat, volume), and the big five-button transport. When `mode!=='strip'`: the playlist list + format panel (or `<EqPanel>` when `showEq`). When `mode==='full'`: `<StationsDrawer stations={snap?.stations ?? []} streamingEnabled={streamingEnabled} onPlay={playStation} onChanged={loadSnapshot} onEnableStreaming={enableStreaming} />`. The stations down-arrow button (`setModePersist(toggleStations(mode))`) sits between the deck and the drawer, hidden when `mode==='strip'`.
  - **Metadata readout:** for `currentItem` with a `path`, look up its `MediaTrack` in `snap.tracks` and render `codec · bitrate/1000 kbps · (channels===1?'Mono':'Stereo') · sampleRate/1000 kHz`, appending ` · ${bitsPerSample}-bit` **only when defined**. For a `url` item show `Stream`.
    - To carry format fields into playback, extend `QueueItem` with the optional format fields and populate them in `loadSnapshot` from `snap.tracks` (they already flow in the snapshot).
  - **Keep** drag-drop, `openFiles`/`addFolder`/`loadPlaylist`/`saveQueue`, `playItem`/`next`/`prev`/`handleEnded`/`seek`/`togglePlay`/`stop`, `addStation`/`deleteStation`/`playStation` (playStation/add/delete now also reachable via the drawer through `onChanged`).
  - **Delete** `src/renderer/modules/media/jukebox-window.ts`.
  - **register-builtins.tsx** (line ~243): set `defaultHeight` to `150` (the `strip` height) so a fresh window opens deck-sized; the module reconciles to the persisted mode on mount.

- [ ] **Step 4: Rounded shell CSS** in `theme.css` under the `ga98-jukebox`/`ga98-wmp-*` namespace: `.ga98-jukebox-rounded` (border-radius, chrome gradient frame, inset LCD panels), `.ga98-eq-panel/.ga98-eq-bands/.ga98-eq-band` (vertical range via `writing-mode: vertical-lr; direction: rtl` or `appearance: slider-vertical`), `.ga98-stations-drawer` (2-col: list + Now-Playing-Station), `.ga98-test-dot` + `.ga98-test-ok{background:#3c3}/.ga98-test-fail{background:#c33}/.ga98-test-testing{background:#cc3}`. Match the blue/chrome palette of the mockup; respect the existing 98.css dark-table cascade caveat (restate bg on a class selector, not the element).

- [ ] **Step 5: Run tests + typecheck** — `pnpm test jukebox media-shade media-eq && pnpm typecheck` → PASS/clean.
- [ ] **Step 6: Commit** — `feat(media): rounded WMP Jukebox — 3-state shade, EQ, stations drawer, metadata readout`.

---

## Post-tasks (controller, after all 11 green + whole-branch review)

- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run).
- [ ] Whole-branch adversarial review (4 dims → refute-by-default verify → auto-fix confirmed critical/important), per the ultracode pattern. Pay attention to: the deferred `queueMicrotask(addStream)` in News (state timing); the full-`media`-object re-send on every settings patch (don't clobber a sibling); the `bitsPerSample`-omitted-on-MP3 invariant; EQ graph re-apply on track change; drawer reorder id math at bounds.
- [ ] Grep the packaged `app.asar` for `jukeboxMode`, `ga98-eq-panel`, `ga98-stations-drawer`, `reorderStations` (bundler strips comments — assert the identifiers ship).
- [ ] Merge `feat/jukebox-rebuild-news-modal` → `main` (`--no-ff`); operator-gated release publish + push follows.

## Self-Review

- **Spec coverage:** News modal (T1) ✓; EQ real (T2/T7/T8) ✓; 3-state shade (T4/T11) ✓; station manager Add/Edit/Remove/reorder/Save-List/Test/Now-Playing (T9/T10) ✓; metadata readout honest bit-depth (T5/T11) ✓; settings + mergeSettings deep-merge (T3) ✓; decomposition into focused files ✓; width preserved / defaultHeight aligned (T11) ✓.
- **Placeholder scan:** none — every code step carries full code; CSS step names exact classes + representative rules.
- **Type consistency:** `JukeboxMode` (shared) used identically in T3/T4/T11; `EqState`/`{enabled,gains,preset}` identical in T3/T8/T11; `StationDraft` in T9/T10; `pickFormat`/`reorderStations`/`exportStations` names stable T5→T6→T10; channels `media.reorderStations`/`media.exportStations` stable T6→T10.
- **Charter:** no new dep; egress gate preserved (Test routes through `resolveSource`); no fabricated bit-depth; mergeSettings deep-merge + upgrade test; persona commit identity; explicit-path adds.
