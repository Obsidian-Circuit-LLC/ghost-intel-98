# Ghost Access 98 — GeoINT ↔ case integration (cycle 2 of 2) design

**Date:** 2026-05-31
**Status:** design approved (operator: GhostExodus), pending implementation plan.
**Builds on:** GeoINT cycle 1 (shipped v3.2.2) and the existing case / entity / timeline systems.

## Purpose

Let the operator capture a GeoINT event into a case — preserving its geography — and tie it
into the cross-case entity registry and case timeline. Turns GeoINT from a standalone monitor
into part of the investigative workflow. Fully local; no new egress (all case data).

## Locked decisions

1. **Save form is user-chosen per save:** a saved event can be created as (a) a per-case
   **saved-event record** (default), (b) a **web-link** (`cases.addLink`), or (c) a **note**
   (`noteStore`). The save dialog offers the choice.
2. **Saved-event records** live in a per-case **`geo-events.json` sidecar** (mirrors
   `entity-links.json` / `bio-images.json`), surfaced in a CaseDetail "GeoINT events" section.
3. **Auto location-entity + manual linking:** if the saved item has a matched place name,
   find-or-create a `location` entity with that value and link it to the case; the user may
   also manually link other entities. No NER / no auto person/org extraction.
4. **New additive `'geo-event'` `TimelineEvent` kind** is emitted on save (not overloading
   `'link'`), so it filters cleanly. Additive to the union — old timelines keep loading.
5. **Cycle-1 tweak:** the geocoder returns the matched place **name**; `GeoItem` gains an
   optional `place?: string` recorded at parse/geocode time.

## Hard invariants (inherited)

- `contextIsolation`/`sandbox`; capability via typed IPC (`ipc-contracts` → `register` +
  validators → preload → `api.d.ts`). Vault-gated (NOT `GATE_EXEMPT`).
- Offline-first, no telemetry, **no new egress** (purely local case/entity/timeline writes).
- Persisted state under the case dir via secure-fs (vault-encrypted at rest). Additive,
  ENOENT-safe (legacy cases without `geo-events.json` load fine).
- No native modules. Retro 98.css UI. Non-reentrant mutex: new writes inside a held case
  lock must use the `*Unlocked` helpers (mirror the existing case mutators).

## Architecture

### Cycle-1 tweak (geocoder returns name)
- `src/main/geoint/geocode.ts`: `Geocoder` returns `{ lat; lon; name } | null` (the matched
  gazetteer entry's `name`). Update `makeGeocoder` + its tests.
- `src/main/geoint/feeds.ts`: `locate()` records `place` from the geocoder result; GeoRSS/
  GeoJSON items (explicit coords, no name) leave `place` undefined. `GeoItem.place?: string`
  added in `post-mvp-types.ts`. Update feed tests to assert `place` on gazetteer-located items.

### Shared types
- `GeoItem.place?: string` (added above).
- `post-mvp-types.ts`: `interface SavedGeoEvent extends GeoItem { savedAt: string }`.
- `types.ts`: add `'geo-event'` to the `TimelineEvent.kind` union + its readonly kinds array.

### Saved-event store (`src/main/geoint/case-events.ts`)
Per-case sidecar `geo-events.json` in the case dir (resolved via the existing case-path
helper). `secureReadText`/`secureWriteFile`, ENOENT-safe.
- `listCaseEvents(caseId): Promise<SavedGeoEvent[]>`
- `addCaseEvent(caseId, item: GeoItem): Promise<SavedGeoEvent>` (assigns `savedAt`)
- `removeCaseEvent(caseId, eventId): Promise<void>`

### Save orchestration (`src/main/geoint/save-to-case.ts`)
`saveToCase(caseId, item: GeoItem, opts: { form: 'record'|'link'|'note'; entityIds?: string[] })`:
1. `record` → `addCaseEvent`; `link` → `caseStore.addLink(caseId, item.link, item.title)`
   (only if `item.link` is a valid http(s) URL — reuse `validateBookmarkUrl`); `note` →
   `noteStore.write` a markdown note (`<title>\n\n<summary>\n\n<link>\n\ncoords: lat,lon`).
2. **Auto location-entity:** if `item.place`, find an existing `location` entity whose value
   equals `item.place` (via `entities.listAll`), else create one; `entities.linkToCase`.
3. **Manual entities:** each `entityIds[]` → `linkToCase` (validated as UUIDs).
4. **Timeline:** emit one `{ kind: 'geo-event', message: 'Saved GeoINT event: <title>' }` via
   the case timeline append (use the `*Unlocked` path if inside a held lock).
Returns `{ savedEventId?: string }`. Never partial-fails silently — any sub-step error
surfaces through `safeHandle`.

### IPC (`geoint.saveToCase`, `geoint.listCaseEvents`, `geoint.removeCaseEvent`)
Added to the existing `channels.geoint` group + `ApiContracts` + preload + `api.d.ts`.
Validators: `ensureSaveToCaseOpts` (form enum, `entityIds` as UUID[]), reuse `ensureUuid`.

### Renderer
- **GeoINT module:** a **"Save to case…"** button on each reading-list item (and the map
  popup action) → a small dialog (`SaveEventDialog.tsx`): case picker (`cases.list`), form
  radio (record/link/note, default record), optional entity multi-select (`entities.listAll`).
  On confirm → `geoint.saveToCase`; toast.
- **CaseDetail:** a **"GeoINT events"** section listing `listCaseEvents` records (title, place,
  date, link, locate badge) with a remove button. ENOENT-safe (empty for legacy cases).

## Error handling
- Invalid/missing `item.link` on `form:'link'` → reject with a clear message (don't save a junk
  bookmark).
- Entity find-or-create race → tolerate (find again before create).
- Save to a since-deleted case → surface the store error via the toast; nothing half-written
  beyond what already succeeded (record/link/note are independent appends).
- Legacy case (no `geo-events.json`) → empty list, not an error.

## Testing
**Vitest (main):** geocoder-returns-name (updated geocode test); `feeds` records `place` on
gazetteer-located items; `case-events` CRUD round-trip (record persists + reloads + removes);
`saveToCase` for each form (record/link/note) including the auto location-entity find-or-create
+ link and the `geo-event` timeline emit (assert one event of the new kind); link-form rejects a
non-http(s) link. **xvfb smoke:** GeoINT "Save to case…" dialog opens; saving a fixture event as
a record makes it appear in that case's GeoINT-events section; no console/main errors.

## Out of scope
- Auto person/org extraction (no offline NER).
- Per-case map rendering of saved events (cycle 1's map is the GeoINT module's; a case-scoped
  map is a later idea).
- Bulk "save all events to case".
- Editing a saved event in place (remove + re-save).

## Open items for implementation
- Confirm the exact case-dir path helper + the `*Unlocked` timeline-append used by existing
  mutators (mirror `addLink`'s timeline emit).
- Confirm `entities.create`/`linkToCase` signatures + whether a find-by-value helper exists
  (else `listAll` + filter).
