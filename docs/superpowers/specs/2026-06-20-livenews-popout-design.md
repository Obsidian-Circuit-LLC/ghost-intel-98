# Live News Pop-Out Window — Design

**Date:** 2026-06-20
**Surface:** Ghost Intel 98 core app (`/dcs98`), renderer-only
**Status:** Approved for planning

## Goal

Let the operator pop the currently-selected GeoINT Live News feed out of the inline
`LiveNewsPanel` into its own draggable Win98 window, mirroring the existing CCTV camera-view
pop-out pattern — so a news stream can be watched alongside the map and other windows.

## Scope (locked)

- Pops the **currently-selected** feed (the `active` stream in `LiveNewsPanel`), not the whole
  panel and not a per-row list (the panel selects feeds through a single dropdown).
- **No maximum-window cap.** Unlike `camera-view` (which enforces `MAX_CAMERA_WINDOWS = 8` via a
  `cameraWindowAction` deny gate to bound concurrent players), Live News pop-out is unlimited and
  user-controlled. Opens are **id-deduped only**: re-popping the same feed re-focuses its existing
  window rather than stacking a duplicate.
- Renderer-only change. No new IPC, no new egress host, no new capability, no telemetry.

## Why a new module (not reuse `camera-view`)

A `NewsStream` is a different type from a `CameraStream` and renders through a different player:

| | `NewsStream` | `CameraStream` |
|---|---|---|
| Location | `geoint/LiveNewsPanel.tsx:26` | `shared/post-mvp-types.ts:111` |
| Shape | `{ label, url, kind }` | `{ id, label, url, kind, caseId, addedAt, notes, country?, region?, city?, lat?, lon?, source? }` |
| Stable id | none (selected by array index) | `id: string` |
| Kinds | `'hls' \| 'youtube'` | `'hls' \| 'mjpeg' \| 'rtsp' \| 'http' \| 'mp4' \| 'webpage' \| 'youtube'` |
| Renderer | `HlsVideo` (`hls.js`→`<video>`) or sandboxed `youtube-nocookie` `<iframe>` | EyeSpy `Viewer` |

Reusing `camera-view` would require coercing a `NewsStream` into a `CameraStream` it is not.
A dedicated `news-view` module is the honest seam.

## Architecture

### 1. Shared player — `geoint/NewsStreamView.tsx` (new)

Extract the inline playback block (`LiveNewsPanel.tsx:203-227`) plus the `HlsVideo` helper
(`:73-101`) into one reusable component so the inline panel and the pop-out window render the same
stream identically and the egress gate lives in exactly one place.

```ts
export function NewsStreamView({ stream }: { stream: NewsStream }): JSX.Element
```

- Reads `net = settings?.geoint?.networkEnabled ?? false` from `useSettings` **itself**.
- **Security invariant (load-on-network-only):** when `net` is false it renders ONLY a placeholder
  — no `HlsVideo`, no `<iframe>`, no network fetch. A pop-out window is a second surface playing
  the same stream, so it must honor the same gate or it becomes an egress bypass. The gate must NOT
  be a trusting prop; the component reads settings so neither call site can skip it.
- Renders the existing switch, driven by an exported pure decision function
  `newsRenderMode(stream, net): 'offline' | 'hls' | 'youtube' | 'bad-youtube-id'` (so the
  egress-gate behavior is unit-testable without a render harness): net-off → `'offline'`
  placeholder; `hls` → `HlsVideo`; `youtube` with a parseable id → `<iframe>`; otherwise
  `'bad-youtube-id'` placeholder.
- Both call sites place `NewsStreamView` inside a `position:relative` container (the panel's
  aspect-ratio box; the window's flex-fill box) because the placeholders and the `<iframe>` use
  `position:absolute; inset:0`.
- The "no stream selected" placeholder stays in `LiveNewsPanel` (a window always has a stream), so
  `NewsStreamView` always receives a defined `stream`.

`HlsVideo` moves into this file (it is an implementation detail of the player). `parseYouTubeId`
and `youtubeEmbedSrc` continue to come from `@shared/youtube`.

**Type location.** `NewsStreamKind` and `NewsStream` are currently defined+exported in
`LiveNewsPanel.tsx` but have **zero importers elsewhere** (verified by grep across `src`/`test`),
and the settings type `geoint.newsStreams` in `shared/types.ts:410` is an independent structural
inline type (`{ label, url, kind }[]`), not this named type. So the types move into
`NewsStreamView.tsx` and are imported from there by `LiveNewsPanel`, `newsWindow.ts`, and
`NewsViewModule` — a single one-directional dependency, no import cycle, no back-compat re-export
needed.

### 2. Window-id helper — `geoint/newsWindow.ts` (new)

Pure, dependency-free, unit-testable. Mirrors `cameraview/cameraWindow.ts` **minus the cap/action
policy** (locked scope: no cap).

```ts
export function newsWindowId(stream: NewsStream): string {
  return `news-view:${stream.kind}:${stream.url}`;
}
```

Identity is `kind:url` because `NewsStream` has no `id` and the array index is unstable
(`removeStream` shifts indices). Two pops of the same feed therefore collapse to one window via the
store's id dedup.

### 3. Pop-out window component — `geoint/NewsViewModule.tsx` (new)

```ts
export function NewsViewModule({ stream }: { stream: NewsStream }): JSX.Element
```

A one-line header (`label` + `(kind)`, mirroring `CameraViewModule`'s header chrome) above a
flex-fill `<NewsStreamView stream={stream} />`.

### 4. Panel wiring — `geoint/LiveNewsPanel.tsx` (modify)

- Replace the inline net-off / no-stream / video switch (`:203-227`) so that `NewsStreamView` owns
  the **net-off** placeholder and the playback switch, while the panel keeps ONLY the **no-stream**
  placeholder (the window always has a stream, so it never needs that case). Net result inside the
  aspect-ratio container: `!active ? <no-stream placeholder> : <NewsStreamView stream={active} />`.
  The net-off placeholder text moves into `NewsStreamView` (single source — no double `net` check).
- Add a "⧉" pop-out button immediately after the existing ✕ button (`:194-196`), enabled only when
  `active` exists, that calls:

```ts
useWindows.getState().open({
  module: 'news-view',
  id: newsWindowId(active),
  title: active.label,
  props: { stream: active },
  width: 640,
  height: 480
});
```

### 5. Module registration (5-point pattern)

- `register-builtins.tsx`: a `NewsViewAdapter` extracting `spec.props?.['stream'] as NewsStream`,
  plus `registerModule({ key: 'news-view', title: 'News', glyph: '📺', component: NewsViewAdapter, builtin: true, defaultWidth: 640, defaultHeight: 480 })`.
- `state/store.ts`: add `| 'news-view'` to the `ModuleKey` union.
- `test/register-builtins.test.ts`: insert `'news-view'` into the `EXPECTED` array in sorted order.

## Data flow

`LiveNewsPanel` (⧉ click on `active`) → `useWindows.getState().open({ module:'news-view', id:newsWindowId(active), props:{ stream } })`
→ store dedups by id (focus existing or create) → `NewsViewAdapter` reads `spec.props.stream`
→ `NewsViewModule` → `NewsStreamView` (reads `net` from settings; plays or placeholder).

## Error / edge handling

- Network off: `NewsStreamView` placeholder only, in both panel and window (the invariant).
- YouTube URL whose id no longer parses: existing "Cannot parse a YouTube video id" placeholder,
  now centralized in `NewsStreamView`.
- Re-pop of an open feed: id dedup re-focuses; no duplicate window.
- A feed removed from the playlist while its window is open: the window keeps its own `stream`
  prop (a value copy at open time) and plays until the user closes it — acceptable; the window is
  an independent view, not bound to the playlist selection.

## Testing

The vitest env is `node` and the project has no React render harness (no `@testing-library`); it
tests **pure functions** (cf. `parseYouTubeId`/`validateStreamUrl`). So the load-bearing logic is
extracted into pure helpers and tested directly; the JSX wrappers are thin and verified by
typecheck + the operator's manual smoke.

- `newsWindow.test.ts`:
  - `newsWindowId(stream)` is stable for the same `{kind,url}` and distinct across a differing kind
    or url.
  - `newsWindowSpec(stream)` returns `{ module:'news-view', id:newsWindowId(stream), title:label,
    props:{stream}, width:640, height:480 }` — the exact `open()` argument the ⧉ button passes.
- `newsstreamview.test.ts` — `newsRenderMode(stream, net)` (the pure decision behind the player):
  - **`net === false` ⇒ `'offline'` for every kind** (the egress-gate invariant: network off
    renders no player and no iframe, on every surface).
  - `net === true` + `kind:'hls'` ⇒ `'hls'`; + `kind:'youtube'` with a parseable url ⇒ `'youtube'`;
    + `kind:'youtube'` with an unparseable url ⇒ `'bad-youtube-id'`.
- `register-builtins.test.ts`: updated `EXPECTED` snapshot includes `'news-view'`.
- `geoint-livenews.test.ts`: unchanged — still imports `parseYouTubeId`/`validateStreamUrl` from
  `LiveNewsPanel` (the re-export and `validateStreamUrl` stay), proving the refactor didn't break
  the panel's pure surface.

## Charter / invariants

- No new egress host, IPC channel, capability, or telemetry.
- The GeoINT `networkEnabled` load-on-network-only invariant is preserved and centralized.
- The renderer `frame-src` CSP invariant is unchanged: the pop-out uses the same already-authorized
  `youtube-nocookie` embed as the inline panel; no CSP broadening.
- Core change → lands on `feat/livenews-popout` for operator merge. No push, no release.
