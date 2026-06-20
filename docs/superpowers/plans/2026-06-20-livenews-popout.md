# Live News Pop-Out Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator pop the currently-selected GeoINT Live News feed into its own draggable Win98 window, mirroring the CCTV camera-view pop-out, with no max-window cap.

**Architecture:** A new renderer window module `news-view`. The inline player block is extracted from `LiveNewsPanel` into a shared `NewsStreamView` that reads the GeoINT `networkEnabled` gate itself (preserving the load-on-network-only egress invariant on both surfaces). A pure `newsWindow.ts` provides the deduped window id + the `open()` spec. The pop-out window is `NewsViewModule`, registered via the 5-point pattern.

**Tech Stack:** Electron renderer, React, zustand store (`useSettings`/`useWindows`), vitest (node env, pure-function tests), `hls.js`, `@shared/youtube`.

**Spec:** `docs/superpowers/specs/2026-06-20-livenews-popout-design.md`

## Global Constraints

- **Egress-gate invariant (load-on-network-only):** when `settings.geoint.networkEnabled` is false, `NewsStreamView` MUST render only a placeholder — no `HlsVideo`, no `<iframe>`. The component reads the flag itself; it is NOT a trusting prop. This is the security-load-bearing property.
- **No max-window cap.** Unlike `cameraWindow.ts`, do NOT add a `MAX_*`/action/deny policy. Opens are id-deduped only.
- **Dedup id = `news-view:${kind}:${url}`** (`NewsStream` has no id; array index is unstable).
- Renderer-only: no new IPC channel, no new egress host, no new capability, no telemetry, no CSP change (the pop-out reuses the already-authorized `youtube-nocookie` embed).
- Test style: vitest runs in the `node` env and the project has NO React render harness. Test pure functions only; do NOT add `@testing-library` or render JSX in tests.
- `geoint-livenews.test.ts` must keep passing unchanged: `parseYouTubeId` (re-exported) and `validateStreamUrl` stay exported from `LiveNewsPanel`.
- Module registration values are VERBATIM: key `'news-view'`, title `'News'`, glyph `📺`.

---

## Task 1: Shared player `NewsStreamView` + pure `newsRenderMode`

Extract the playback block and the `HlsVideo` helper out of `LiveNewsPanel` into a reusable component, with the render decision pulled into a pure, testable function. (Task 4 wires `LiveNewsPanel` to use this; this task creates the new file and its test, and does NOT yet modify `LiveNewsPanel`.)

**Files:**
- Create: `src/renderer/modules/geoint/NewsStreamView.tsx`
- Test: `test/newsstreamview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/newsstreamview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newsRenderMode, type NewsStream } from '../src/renderer/modules/geoint/NewsStreamView';

const hls: NewsStream = { label: 'A', url: 'https://cdn.example.com/live.m3u8', kind: 'hls' };
const yt: NewsStream = { label: 'B', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'youtube' };
const ytBad: NewsStream = { label: 'C', url: 'https://www.youtube.com/watch?v=', kind: 'youtube' };

describe('newsRenderMode', () => {
  it('network OFF renders nothing playable, for every kind (egress-gate invariant)', () => {
    expect(newsRenderMode(hls, false)).toBe('offline');
    expect(newsRenderMode(yt, false)).toBe('offline');
    expect(newsRenderMode(ytBad, false)).toBe('offline');
  });
  it('network ON: hls plays', () => {
    expect(newsRenderMode(hls, true)).toBe('hls');
  });
  it('network ON: a parseable YouTube url embeds', () => {
    expect(newsRenderMode(yt, true)).toBe('youtube');
  });
  it('network ON: an unparseable YouTube url is flagged, not embedded', () => {
    expect(newsRenderMode(ytBad, true)).toBe('bad-youtube-id');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/newsstreamview.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/modules/geoint/NewsStreamView`.

- [ ] **Step 3: Create `NewsStreamView.tsx`**

```tsx
/**
 * Shared Live News player — renders ONE NewsStream. Used by both the inline GeoINT LiveNewsPanel
 * and the pop-out news-view window so the two surfaces play identically. It reads the GeoINT
 * networkEnabled flag ITSELF: with the network off it renders ONLY a placeholder (no HLS chunks,
 * no iframe), preserving the load-on-network-only egress invariant on every surface. The render
 * decision is the pure, unit-tested newsRenderMode(); the JSX is a thin switch over it.
 *
 * NewsStream/NewsStreamKind live here (they have no importers outside the geoint news surface);
 * LiveNewsPanel imports them from this module.
 *
 * Callers MUST place <NewsStreamView/> inside a position:relative container — the placeholders and
 * the <iframe> use position:absolute; inset:0.
 */
import Hls from 'hls.js';
import { useEffect, useRef } from 'react';
import { useSettings } from '../../state/store';
import { parseYouTubeId, youtubeEmbedSrc } from '@shared/youtube';

export type NewsStreamKind = 'hls' | 'youtube';
export interface NewsStream {
  label: string;
  url: string;
  kind: NewsStreamKind;
}

export type NewsRenderMode = 'offline' | 'hls' | 'youtube' | 'bad-youtube-id';

/** Pure render decision. Network OFF always yields 'offline' (no player, no iframe) regardless of
 *  kind — the load-on-network-only egress invariant. */
export function newsRenderMode(stream: NewsStream, net: boolean): NewsRenderMode {
  if (!net) return 'offline';
  if (stream.kind === 'hls') return 'hls';
  return parseYouTubeId(stream.url) ? 'youtube' : 'bad-youtube-id';
}

function HlsVideo({ url }: { url: string }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    // Safari / native HLS fallback.
    video.src = url;
    return () => {
      video.src = '';
      video.load();
    };
  }, [url]);
  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      controls
      style={{ width: '100%', height: '100%', background: '#000' }}
    />
  );
}

const placeholderBase: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: 12, textAlign: 'center', padding: 12
};

export function NewsStreamView({ stream }: { stream: NewsStream }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const net = settings?.geoint?.networkEnabled ?? false;
  const mode = newsRenderMode(stream, net);

  if (mode === 'offline') {
    return <div style={{ ...placeholderBase, color: '#9ad' }}>Enable the GeoINT network to play live news.</div>;
  }
  if (mode === 'hls') {
    return <HlsVideo key={stream.url} url={stream.url} />;
  }
  if (mode === 'youtube') {
    const ytId = parseYouTubeId(stream.url)!;
    return (
      <iframe
        key={ytId}
        title={stream.label}
        src={youtubeEmbedSrc(ytId)}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    );
  }
  return <div style={{ ...placeholderBase, color: '#e88' }}>Cannot parse a YouTube video id from this stream URL.</div>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/newsstreamview.test.ts`
Expected: PASS (5 assertions across 4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK (both tsconfig targets).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/geoint/NewsStreamView.tsx test/newsstreamview.test.ts
git commit -m "feat(livenews): shared NewsStreamView player + pure newsRenderMode"
```

---

## Task 2: Pure window helpers `newsWindow.ts`

The deduped window id and the exact `open()` spec the ⧉ button passes — both pure so the pop-out is fully tested without a render harness. No cap/action policy (locked scope).

**Files:**
- Create: `src/renderer/modules/geoint/newsWindow.ts`
- Test: `test/newswindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/newswindow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newsWindowId, newsWindowSpec } from '../src/renderer/modules/geoint/newsWindow';
import type { NewsStream } from '../src/renderer/modules/geoint/NewsStreamView';

const a: NewsStream = { label: 'Bloomberg', url: 'https://x/live.m3u8', kind: 'hls' };
const aSameId: NewsStream = { label: 'Renamed', url: 'https://x/live.m3u8', kind: 'hls' };
const bUrl: NewsStream = { label: 'Bloomberg', url: 'https://y/live.m3u8', kind: 'hls' };
const bKind: NewsStream = { label: 'Bloomberg', url: 'https://x/live.m3u8', kind: 'youtube' };

describe('newsWindowId', () => {
  it('is stable across label changes (identity is kind+url)', () => {
    expect(newsWindowId(a)).toBe(newsWindowId(aSameId));
  });
  it('differs when the url differs', () => {
    expect(newsWindowId(a)).not.toBe(newsWindowId(bUrl));
  });
  it('differs when the kind differs', () => {
    expect(newsWindowId(a)).not.toBe(newsWindowId(bKind));
  });
  it('is namespaced to the module', () => {
    expect(newsWindowId(a)).toBe('news-view:hls:https://x/live.m3u8');
  });
});

describe('newsWindowSpec', () => {
  it('builds the exact open() argument', () => {
    expect(newsWindowSpec(a)).toEqual({
      module: 'news-view',
      id: 'news-view:hls:https://x/live.m3u8',
      title: 'Bloomberg',
      props: { stream: a },
      width: 640,
      height: 480
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/newswindow.test.ts`
Expected: FAIL — cannot resolve `newsWindow`.

- [ ] **Step 3: Create `newsWindow.ts`**

```ts
/**
 * Policy for the Live News pop-out window. Mirrors cameraview/cameraWindow.ts but WITHOUT a cap:
 * the operator may open unlimited news windows (locked scope), so opens are id-deduped only —
 * re-popping the same feed re-focuses its window. Pure + dependency-free so it's unit-testable
 * without the window store. NewsStream has no id field; identity is its kind+url.
 */
import type { NewsStream } from './NewsStreamView';

/** Deterministic window id for a feed, so re-clicking the same feed re-focuses its window. */
export function newsWindowId(stream: NewsStream): string {
  return `news-view:${stream.kind}:${stream.url}`;
}

/** The exact argument passed to useWindows.open() for a news pop-out. */
export function newsWindowSpec(stream: NewsStream) {
  return {
    module: 'news-view' as const,
    id: newsWindowId(stream),
    title: stream.label,
    props: { stream },
    width: 640,
    height: 480
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/newswindow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/newsWindow.ts test/newswindow.test.ts
git commit -m "feat(livenews): pure newsWindowId + newsWindowSpec helpers"
```

---

## Task 3: Pop-out window `NewsViewModule` + register `news-view` (5-point)

Create the window component and register it. After this task the `news-view` module exists and renders.

**Files:**
- Create: `src/renderer/modules/geoint/NewsViewModule.tsx`
- Modify: `src/renderer/modules/register-builtins.tsx` (add import, adapter, registerModule line)
- Modify: `src/renderer/state/store.ts` (ModuleKey union)
- Test: `test/register-builtins.test.ts` (EXPECTED array)

- [ ] **Step 1: Update the failing registry test**

In `test/register-builtins.test.ts`, add `'news-view'` to the `EXPECTED` array in sorted order (between `'net-explorer'` and `'notepad'`):

```ts
    const EXPECTED = [
      'ai-assistant', 'alarm', 'bookmarks', 'briefcase', 'calendar', 'camera-view', 'cases', 'chat', 'chess',
      'dialterm', 'doc-viewer', 'eyespy', 'geoint', 'help', 'host-info', 'journal', 'mail', 'markets', 'media-player',
      'minesweeper', 'net-explorer', 'news-view', 'notepad', 'pinball', 'reminders', 'search', 'settings',
      'shred', 'solitaire', 'whiteboard'
    ].sort();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/register-builtins.test.ts`
Expected: FAIL — `keys` is missing `'news-view'` (registry doesn't register it yet).

- [ ] **Step 3: Create `NewsViewModule.tsx`**

Mirror `CameraViewModule`'s chrome (one-line header + flex-fill body). The body is `position:relative` so `NewsStreamView`'s absolute placeholders/iframe fill it.

```tsx
/**
 * Live News pop-out window — plays one news feed in its own draggable Win98 window, opened from the
 * GeoINT LiveNewsPanel pop-out (⧉) button. Mirrors CameraViewModule's chrome; the player is the
 * shared NewsStreamView (which enforces the GeoINT network gate).
 */
import { NewsStreamView, type NewsStream } from './NewsStreamView';

export function NewsViewModule({ stream }: { stream: NewsStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        {stream.label} <span style={{ opacity: 0.6 }}>({stream.kind})</span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        <NewsStreamView stream={stream} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the import in `register-builtins.tsx`**

After the existing `import { HostInfoModule } from './hostinfo/HostInfoModule';` line (~line 38):

```tsx
import { NewsViewModule } from './geoint/NewsViewModule';
```

- [ ] **Step 5: Add the adapter in `register-builtins.tsx`**

After the `HostInfoAdapter` function (~line 167):

```tsx
function NewsViewAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <NewsViewModule stream={spec.props?.['stream'] as import('./geoint/NewsStreamView').NewsStream} />;
}
```

- [ ] **Step 6: Add the registerModule line in `register-builtins.tsx`**

After the `host-info` registration line (~line 207), before `help`:

```tsx
  registerModule({ key: 'news-view', title: 'News', glyph: '📺', component: NewsViewAdapter, builtin: true, defaultWidth: 640, defaultHeight: 480 });
```

- [ ] **Step 7: Add `'news-view'` to the `ModuleKey` union in `store.ts`**

In `src/renderer/state/store.ts`, add to the `ModuleKey` union (after `| 'host-info'`):

```ts
  | 'news-view'
```

- [ ] **Step 8: Run the registry test to verify it passes**

Run: `pnpm exec vitest run test/register-builtins.test.ts`
Expected: PASS (keys now include `'news-view'`; second-call-throws test still passes).

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/modules/geoint/NewsViewModule.tsx src/renderer/modules/register-builtins.tsx src/renderer/state/store.ts test/register-builtins.test.ts
git commit -m "feat(livenews): NewsViewModule window + register news-view module"
```

---

## Task 4: Wire `LiveNewsPanel` — use `NewsStreamView` + add ⧉ pop-out button

Refactor the panel to consume the shared player and relocate the types, then add the pop-out button. The existing `geoint-livenews.test.ts` (pure-helper test) must still pass — it imports `parseYouTubeId`/`validateStreamUrl` from this module, so both stay exported.

**Files:**
- Modify: `src/renderer/modules/geoint/LiveNewsPanel.tsx`
- Test: `test/geoint-livenews.test.ts` (must remain green, unchanged)

- [ ] **Step 1: Run the existing panel test to confirm the baseline is green**

Run: `pnpm exec vitest run test/geoint-livenews.test.ts`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Edit imports in `LiveNewsPanel.tsx`**

Replace the top imports block. Changes vs. the original: drop `import Hls from 'hls.js';`; drop `useRef`/`useEffect` from the `react` import (only `useState` is still used here); drop `youtubeEmbedSrc` from the `@shared/youtube` import (it moved to `NewsStreamView`, leaving only `parseYouTubeId`, which the panel test still imports from this module); add `useWindows`, the `NewsStreamView` + types, and `newsWindowSpec`. The exact resulting import block:

```tsx
import { useState } from 'react';
import { useSettings, useWindows } from '../../state/store';
import { toast } from '../../state/toasts';
import { parseYouTubeId } from '@shared/youtube';
import { NewsStreamView, type NewsStream, type NewsStreamKind } from './NewsStreamView';
import { newsWindowSpec } from './newsWindow';

// Re-export so existing callers/tests that import parseYouTubeId from this module still resolve.
export { parseYouTubeId };
```

- [ ] **Step 3: Remove the relocated definitions**

Delete from `LiveNewsPanel.tsx`:
- the `export type NewsStreamKind = ...` and `export interface NewsStream {...}` blocks (now imported from `NewsStreamView`),
- the entire `function HlsVideo({ url }) {...}` definition,
- the `const ytId = active && ...` line (the youtube-id logic now lives in `NewsStreamView`).

`validateStreamUrl` and `isPublicHost` STAY (the panel still validates URLs on add, and the panel test asserts `validateStreamUrl`).

- [ ] **Step 4: Replace the video container body**

Replace the `.ga98-livenews-video` container's children (the `!net ? ... : !active ? ... : <switch>` block, original lines 203-227) with a no-stream placeholder + the shared player. `NewsStreamView` owns the net-off case; the panel keeps only the no-stream case:

```tsx
      <div
        className="ga98-livenews-video"
        style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', marginBottom: 6 }}
      >
        {!active ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 12, textAlign: 'center', padding: 12 }}>
            No stream selected. Add one below.
          </div>
        ) : (
          <NewsStreamView stream={active} />
        )}
      </div>
```

(Intentional minor copy change: with zero streams the panel now always shows "No stream selected. Add one below." even when the network is off — actionable and correct, and it keeps the net-off gate as the single responsibility of `NewsStreamView`.)

- [ ] **Step 5: Add the ⧉ pop-out button beside ✕**

Replace the existing single-button block (original lines 194-196):

```tsx
        {active && (
          <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>
        )}
```

with a pop-out button followed by the remove button:

```tsx
        {active && (
          <>
            <button title="Pop out to its own window" onClick={() => useWindows.getState().open(newsWindowSpec(active))}>⧉</button>
            <button title="Remove this stream" onClick={() => removeStream(index)}>✕</button>
          </>
        )}
```

- [ ] **Step 6: Run the panel test to verify it still passes**

Run: `pnpm exec vitest run test/geoint-livenews.test.ts`
Expected: PASS (unchanged — the pure helpers are intact).

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: OK. (If it flags an unused import — e.g. a stale `useRef`/`Hls`/`youtubeEmbedSrc` — remove it; the file no longer uses them.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/geoint/LiveNewsPanel.tsx
git commit -m "feat(livenews): panel uses shared NewsStreamView + adds pop-out button"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `pnpm typecheck` — both tsconfig targets OK.
- [ ] `pnpm test` — full suite green (new: `newsstreamview`, `newswindow`; updated: `register-builtins`; unchanged-green: `geoint-livenews`).
- [ ] Egress-gate audit: grep the new files — `NewsStreamView`/`NewsViewModule`/`newsWindow` add no `fetch`/`safeFetch`/new host; the only network surfaces are the existing `HlsVideo` (gated behind `newsRenderMode === 'hls'`, i.e. net on) and the existing `youtube-nocookie` iframe (gated behind net on). No CSP change.
- [ ] Manual smoke (operator, on Windows): GeoINT → Live News → select a feed → click ⧉ → a draggable "News" window opens playing that feed; clicking ⧉ again re-focuses the same window (no duplicate); toggling the GeoINT network off blanks both the inline panel and the pop-out window to the placeholder.

## Parked / out of scope

- Manual CCTV coordinate entry (separate queued core item; its own spec/plan).
- Any multi-feed "pop the whole panel" mode (scope locked to single selected feed).
