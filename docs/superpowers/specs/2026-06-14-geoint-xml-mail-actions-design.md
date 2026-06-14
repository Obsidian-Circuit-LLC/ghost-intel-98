# GeoINT geo-XML formats + Mail actions — Design

**Date:** 2026-06-14
**Target release:** v3.14.0-beta.9
**Origin:** GhostExodus field-test feedback (dogfooding DCS98 against live OSINT casework).

## Summary

Two independent workstreams bundled into one release:

- **A — GeoINT:** add three feed formats — KML, GPX, and a generic dot-path XML mapper —
  alongside the existing RSS / Atom / GeoJSON.
- **B — Mail:** add Delete (→ Trash), Forward, and Star (★) actions, plus document the
  new-mail sound asset swap.

They touch disjoint subsystems (`src/main/geoint/*` vs `src/main/services/mail.ts` +
`src/renderer/modules/mail/*`) and could be split into two plans; one spec covers the
release, mirroring how v3.14.0-beta.8 bundled three fixes.

## Charter constraints honored

- No new network egress. GeoINT fetch stays behind the existing `settings.geoint.networkEnabled`
  gate and the SSRF-revalidating `safeFetch`. Mail keeps its short-lived IMAP/SMTP connections.
- No telemetry.
- Determinism preserved: parsers are pure; coordinate validation is exact-range, not heuristic.
- No new XXE / entity-expansion surface: KML/GPX/generic-XML reuse the **existing** `XMLParser`
  instance in `feeds.ts` (same config that already parses untrusted RSS/Atom; fast-xml-parser
  does not resolve external entities).

---

## Workstream A — GeoINT: KML, GPX, generic XML

### Type changes

`src/shared/post-mvp-types.ts`:

```ts
export type GeoSourceType = 'rss' | 'atom' | 'geojson' | 'kml' | 'gpx' | 'xml';

/** Dot-path field map for the generic 'xml' source type. Each value is a dot path into the
 *  fast-xml-parser object tree; attributes are addressed with the '@_' prefix (e.g. 'point.@_lat').
 *  itemsPath resolves to the repeated element (array, or single object treated as a 1-element array). */
export interface GeoXmlMap {
  itemsPath: string;   // e.g. 'rss.channel.item' or 'root.records.record'
  lat: string;         // dot path within an item, e.g. 'geo.lat' or '@_lat'
  lon: string;         // dot path within an item
  title?: string;
  summary?: string;
  link?: string;
  date?: string;
}

export interface GeoSource {
  id: string;
  label: string;
  url: string;
  type: GeoSourceType;
  enabled: boolean;
  xmlMap?: GeoXmlMap;   // present only when type === 'xml'
  lastFetched?: string;
  lastError?: string;
}
```

(Existing `GeoSource` fields retained; only `type` widened and `xmlMap?` added.)

### Parsers (`src/main/geoint/feeds.ts`)

All three reuse the module-level `xml` (`XMLParser`), `arr()`, `clip()`, `txt()`,
`MAX_FEED_ITEMS`, `locate()`, and `classify()` helpers already present.

**`parseKml(body, sourceId, geocode)`**
- Navigate `kml.Document` / `kml.Folder` / `kml` for `Placemark` (recurse one level into
  `Folder.Placemark`; flatten with `arr()`).
- For each Placemark: `Point.coordinates` is a `"lon,lat[,alt]"` string. Split on `,`, take
  first two as `lon`, `lat`.
- Title = `name`; summary = `description`.
- Coordinate guard identical to `parseGeoJson`: both finite, `lat ∈ [-90,90]`, `lon ∈ [-180,180]`,
  else the placemark is dropped (a NaN/off-globe pin stamped `located:'geo'` is a silent
  mislocation). Placemarks with no `Point` (LineString/Polygon) are dropped in v1.
- Located placemarks → `located:'geo'`. (KML carries explicit coords, so no gazetteer fallback.)

**`parseGpx(body, sourceId, geocode)`**
- `gpx.wpt` waypoints only (`arr()`-flattened). Tracks (`trk`/`trkseg/trkpt`) and routes
  (`rte/rtept`) are deliberately **not** parsed in v1 — they are paths, not pins. Documented limit.
- `@_lat` / `@_lon` attributes → `Number()`; same finite + in-range guard as KML.
- Title = `name` (fallback `'Waypoint'`); summary = `desc`.
- Located → `located:'geo'`.

**`parseXmlMapped(body, sourceId, map, geocode)`**
- Parse body, resolve `map.itemsPath` via `getPath()` → wrap single object in array, `arr()`.
- For each item: `lat`/`lon` via `getPath(item, map.lat|lon)` → `Number()`. If both finite and
  in range → `{lat, lon, located:'geo'}`. Otherwise call `locate()` so the gazetteer fallback
  runs on title+summary (same as RSS).
- `title`/`summary`/`link`/`date` via their dot paths (each optional; `txt()`-clipped).
- `classify(title, summary)` applied.

**`getPath(obj, path)` helper (new, pure, exported for tests)**
- Split `path` on `.`. **Reject** any segment equal to `__proto__`, `constructor`, or
  `prototype` (prototype-pollution / prototype-traversal guard) → return `undefined`.
- Walk: at each step, if the current node is an array, index into `[0]` before applying the key
  (fast-xml-parser repeats become arrays; a path addresses the scalar). Return `undefined` on
  any missing link. Reading `@_`-prefixed keys is ordinary property access.

**`detectType(url, body)`** — add: `.kml` → `'kml'`, `.gpx` → `'gpx'` (before the existing
checks). Generic `'xml'` is never auto-detected; it is user-selected because it requires a map.

### Fetch dispatch (`src/main/geoint/sources.ts`)

`fetchSource` parser switch extends to:

```ts
const items =
  type === 'geojson' ? parseGeoJson(body, id)
  : type === 'kml'   ? parseKml(body, id, geo)
  : type === 'gpx'   ? parseGpx(body, id, geo)
  : type === 'xml'   ? (s.xmlMap ? parseXmlMapped(body, id, s.xmlMap, geo) : [])
  : type === 'atom'  ? parseAtom(body, id, geo)
  : detectType(s.url, body) === 'atom' ? parseAtom(body, id, geo)
  : parseRss(body, id, geo);
```

An `'xml'` source with no `xmlMap` yields `[]` (it cannot parse without a map; the UI requires
the fields before add, so this is a defensive no-op, not a normal path).

`addSource` / `importSources` already spread `input`; they thread `xmlMap` through when present.
(`addSource` signature widens to accept the optional `xmlMap`.)

### Validation (`src/main/security/validate.ts`)

`ensureGeoSource` widens its return type and:
- Accepts `type ∈ {rss, atom, geojson, kml, gpx, xml}`.
- When `type === 'xml'`: require `xmlMap` object with `itemsPath`, `lat`, `lon` as non-empty
  strings ≤ 200 chars; `title`/`summary`/`link`/`date` optional strings ≤ 200 chars. Reject
  otherwise. Strip unknown keys. (Path-segment prototype rejection happens at parse time in
  `getPath`; validation here bounds size and shape of persisted config.)

### Renderer (`src/renderer/modules/geoint/GeoIntModule.tsx`)

- `draft` state gains optional `xmlMap`.
- Dropdown adds `<option value="kml">KML</option>`, `<option value="gpx">GPX</option>`,
  `<option value="xml">XML (custom)</option>`.
- When `draft.type === 'xml'`, render 7 labelled `ga98-text` inputs (itemsPath, lat, lon, title,
  summary, link, date) bound into `draft.xmlMap`. Add button disabled until itemsPath+lat+lon
  are non-empty.
- `addSource(draft)` sends `xmlMap` only when type==='xml'.

### Tests (`test/geoint-feeds-xml.test.ts`, node, pure)

- KML: a Document with two Placemarks → two located items; an off-globe / NaN coord placemark
  is dropped; a non-Point placemark is dropped.
- GPX: two `wpt` → two located items with correct lat/lon from attributes.
- XML mapper: dot-path resolves nested element + attribute; item with no coords falls back to
  gazetteer (mock geocoder); a path containing `__proto__` resolves to `undefined` (guard).
- `getPath`: array-indexing-into-[0] behaviour; missing link → `undefined`.

---

## Workstream B — Mail actions

### IPC surface

`src/shared/ipc-contracts.ts` — add channels:
```ts
deleteMessage: 'mail:deleteMessage',
setFlag: 'mail:setFlag',
```
`src/preload/index.ts` + `api.d.ts` — add bindings:
```ts
deleteMessage: (id: string, uid: number) => ipcRenderer.invoke(channels.mail.deleteMessage, id, uid),
setFlag: (id: string, uid: number, flag: string, value: boolean) =>
  ipcRenderer.invoke(channels.mail.setFlag, id, uid, flag, value),
```

### Service (`src/main/services/mail.ts`)

**`setFlag(id, uid, flag, value)`** — open INBOX; `value ? messageFlagsAdd : messageFlagsRemove`
with `{ uid: true }`; `safeLogout` in `finally`. The renderer only ever passes `'\\Flagged'`,
but the service accepts the flag string and validates it against an allowlist
(`['\\Flagged', '\\Seen']`) at the IPC boundary.

**`deleteMessage(id, uid)`** — open INBOX, resolve the Trash mailbox:
1. `client.list()` → first mailbox whose `specialUse === '\\Trash'`.
2. Fallback to the first existing name in
   `['Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages', 'Deleted']`.
3. If none exist → `throw new Error('No Trash folder found on this account — delete from webmail.')`
   (no silent expunge; recoverable-by-default is the chosen semantics).
Then `client.messageMove(String(uid), trash, { uid: true })`; `safeLogout` in `finally`.

**`MailMessageSummary`** (`post-mvp-types.ts`) gains `flagged: boolean`. `fetchInbox` sets it
from the existing flags fetch: `flagged: msg.flags?.has('\\Flagged') ?? false`.

### IPC handlers (`src/main/ipc/register.ts`)

```ts
safeHandle(channels.mail.deleteMessage, (...a) =>
  mail.deleteMessage(a[0] as string, ensureUid(a[1])));
safeHandle(channels.mail.setFlag, (...a) =>
  mail.setFlag(a[0] as string, ensureUid(a[1]), ensureMailFlag(a[2]), a[3] === true));
```
Account id is passed as `a[0] as string` to match the eight existing mail handlers (which all use
a bare cast); the service enforces account existence (`loadAccountWithPassword` throws on an
unknown id). Two new validators in `validate.ts` cover the genuinely untrusted args: `ensureUid`
(safe non-negative integer — guards the destructive delete path) and `ensureMailFlag`
(string ∈ `['\\Flagged','\\Seen']`).

### Renderer (`src/renderer/modules/mail/MailModule.tsx`)

- **List:** show `★` (gold) for `m.flagged` next to the unseen dot.
- **Preview header action row** (when a message is selected): `Star`/`Unstar`, `Forward`, `Delete`.
  - Star: `await window.api.mail.setFlag(activeId, selected.uid, '\\Flagged', !flaggedNow)`,
    then optimistically update the summary in `inbox` state and the `selected` view.
  - Delete: `confirmDialog('Move this message to Trash?', 'Delete message')` → `deleteMessage`
    → clear `selected`, refresh inbox, success toast.
  - Forward: `openCompose` seeded with:
    - `subject: selected.subject.startsWith('Fwd:') ? selected.subject : 'Fwd: ' + selected.subject`
    - `to: ''`
    - `body:` `\n\n---------- Forwarded message ----------\nFrom: <from>\nDate: <date>\nSubject: <subject>\n\n<original body>` and, if the original had attachments,
      a trailing `[Note: N original attachment(s) not carried over — open the source message to retrieve them.]` line.
  - Forward carries **body text only** in v1 — server-side attachments are not re-attached
    (would require download→re-upload). The note line keeps this honest rather than silent.

### Sound asset

No code change. `playMailNotify()` already fires on an unseen-count rise, gated on
`settings.soundEnabled`, playing `src/renderer/assets/mail-notify.wav`. The operator will drop
the desired clip at that path. Documented as the single manual step in the plan and release notes.
(The implementer must not fetch or generate third-party audio.)

### Tests (`test/mail-actions.test.ts`, node, imapflow-mocked)

- `setFlag(value:true)` calls `messageFlagsAdd(['\\Flagged'])`; `value:false` calls
  `messageFlagsRemove`.
- `deleteMessage` resolves Trash via `specialUse` and calls `messageMove` to it.
- `deleteMessage` with no Trash mailbox throws the documented error and calls no `messageMove`.
- `fetchInbox` sets `flagged` from the `\\Flagged` flag.
- Validators: `ensureUid` rejects negatives/non-integers; `ensureMailFlag` rejects an
  arbitrary flag string.

---

## Version & docs

- `package.json` → `3.14.0-beta.9`.
- `README.md` → Status line, changelog entry, version strings, test count.
- `RELEASE_NOTES_v3.14.0-beta.9.md` → new GeoINT formats, Mail actions, the manual sound-asset
  swap step, and the v1 limits (GPX waypoints-only, Forward drops attachments).

## Verification

- `pnpm typecheck` + full `pnpm test` green (new suites: `geoint-feeds-xml`, `mail-actions`).
- Manual: add a KML and a GPX source (pins appear); add an XML source with a dot-path map
  (pins appear); star/unstar a message (★ shows, persists across Get-mail); delete moves to
  Trash and the message survives in webmail; Forward opens Compose with `Fwd:` + quoted body.

## Out of scope (deliberate)

- GPX tracks/routes (paths, not pins).
- Generic-XML auto-detection (requires a map; user-selected only).
- Forwarding server-side attachments.
- Sourcing the new-mail audio clip (operator-supplied).
- The parked GeoINT full reimagining (separate workstream, memory `geoint-reimagine`).
