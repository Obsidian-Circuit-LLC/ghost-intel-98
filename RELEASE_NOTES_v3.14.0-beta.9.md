# Dead Cyber Society 98 — v3.14.0-beta.9 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.8 carries forward. This build
> adds three new GeoINT feed formats (KML, GPX, generic XML) and four Mail actions (Star, Forward,
> Delete→Trash, Print). The Tor P2P chat handshake is formally verified internally — external audit
> + FIPS build remain the only unmet gates; don't rely on it for real adversarial security.

## What's new

### GeoINT — KML, GPX, and generic XML feed sources

Three new source types are available in the GeoINT **Add source** dropdown alongside the existing
RSS / Atom / GeoJSON options.

**KML** — paste any KML feed URL and `<Placemark>` elements that carry a `<Point>` coordinate pair
become map pins. Coordinate values are range-checked (lat −90…90, lon −180…180) before use; bad
values and non-Point placemarks (LineString, Polygon) are silently skipped rather than crashing. The
title and description are carried through and geocoded/classified the same way as RSS items.

**GPX** — paste any GPX feed URL and `<wpt>` (waypoint) elements become map pins using the `@_lat`
and `@_lon` XML attributes. Out-of-range waypoints are dropped.

**XML (custom)** — the most flexible option: paste any structured XML URL and supply a dot-path
field map telling the parser where to find the repeated item element and the coordinate fields.
Required paths: `itemsPath` (e.g. `root.records.record`), `lat` (e.g. `pos.@_lat`), `lon`
(e.g. `pos.@_lon`). Optional paths: `title`, `summary`, `link`, `date`. Attributes are addressed
with the `@_` prefix. When lat/lon are absent or out of range for a given item, the item falls back
to the offline gazetteer geocoder (the same path RSS/Atom items use), so city-named entries that
lack coordinates can still be pinned.

All three parsers share the existing coordinate-range guard, the `MAX_FEED_ITEMS` cap, and the
dot-path walker, which blocks prototype-polluting path segments (`__proto__`, `constructor`,
`prototype`).

#### v1 limits — GeoINT

- **GPX: waypoints only.** Tracks (`<trk>`) and routes (`<rte>`) are paths, not single-pin points;
  they are ignored in v1. Only `<wpt>` elements are parsed.
- **KML: Point placemarks only.** `<LineString>`, `<Polygon>`, and other geometry types are
  skipped; only `<Placemark>` elements with a `<Point>/<coordinates>` child become pins.

---

### Mail — Star, Forward, Delete, Print

Each open message now shows an action row with four buttons immediately above the message header.

**Star (★ / Unstar)** — toggles the IMAP `\Flagged` flag on the server via `messageFlagsAdd` /
`messageFlagsRemove`. A starred message shows a gold ★ in the inbox list alongside the unread dot.
The star state is optimistically reflected in the UI on success and reverts (with an error toast) if
the IMAP call fails.

**Forward** — opens the Compose window pre-filled with a `Fwd:` subject and a quoted body block
(`---------- Forwarded message ----------` header + the original From, Date, Subject, and body
text). The To field is left blank for you to fill in. If the original message had attachments, a
note is appended explaining how many there were; they are not re-attached.

**Delete** — moves the message to the account's Trash folder, which is recoverable from webmail.
The delete path: (1) lists all mailboxes, (2) finds the trash by IMAP `\Trash` special-use first,
then by a common-name fallback list (`Trash`, `[Gmail]/Trash`, `Deleted Items`, `Deleted Messages`,
`Deleted`), (3) moves via `messageMove` (UID-based, atomic). If no trash folder can be found the
call fails with an explanatory error and nothing is moved. The message is removed from the local
inbox list on success and a confirmation dialog is shown before the delete is sent.

**Print** — fetches the full message from the server, renders it to a clean HTML page (From, To,
Subject, Date header + a `<pre>`-wrapped plaintext body), loads that page in a short-lived offscreen
sandboxed BrowserWindow (JavaScript disabled), and calls `webContents.print()` to open the native
OS print dialog. Cancelling the dialog is not an error. The temp file is deleted from the OS temp
directory in a `finally` block whether printing succeeds or the user cancels.

#### v1 limits — Mail

- **Forward: body text only.** The original message's server-side attachments are not re-fetched
  and re-attached to the forward draft. A note in the forwarded body tells the recipient how many
  attachments the original had; to include them, open the source message and forward the files
  manually.
- **Print: plaintext body only.** The message's HTML body (if any) is deliberately not used. The
  plaintext body is HTML-escaped and rendered in a `<pre>` block. This is an intentional XSS safety
  decision: the HTML body is untrusted email content and rendering it — even in a sandboxed window —
  introduces attack surface the plaintext path does not. Images and rich formatting are not printed.

---

### Mail — custom "You've got mail" chime (manual step)

The new-mail audio notification already fires when Settings → Sound is enabled and newly-arrived
unseen messages are detected during a background refresh. The bundled chime is the existing
synthesized alert.

**To use your own chime:** replace `src/renderer/assets/mail-notify.wav` with your own `.wav` file
before running `pnpm build` / `pnpm package`. The file must be a WAV. No other change is needed —
the renderer loads the asset by path and the notification logic is already wired.

---

## Tests

**879 automated tests** (vitest across 138 test files), all green. New coverage added this release:

- `test/geoint-feeds-xml.test.ts` — `getPath` dot-path helper (including prototype-pollution guard),
  `parseKml` (Point placemarks, coordinate-range guard, out-of-range / non-Point drop), `parseGpx`
  (attribute-based lat/lon, out-of-range drop), `parseXmlMapped` (mapped coordinates + gazetteer
  fallback), `detectType` (`.kml` / `.gpx` extension detection), `ensureGeoSource` (xml type with
  valid xmlMap, missing xmlMap rejection, kml/gpx without xmlMap).
- `test/mail-actions.test.ts` — `fetchInbox` flagged field (`\Flagged` → `flagged: true`), `setFlag`
  add and remove paths, `deleteMessage` (special-use `\Trash` detection, common-name fallback,
  no-trash-folder error), mail IPC validators (`ensureUid` bounds + type checks,
  `ensureMailFlag` allowlist).
- `test/mail-html.test.ts` — `buildMailPrintHtml` (From/Subject/body presence, `<script>` XSS
  escaping, attachment filename listing with not-printed note).

## Verify the download

Compare the installer's SHA-256 against the value below before running it:

```powershell
Get-FileHash .\DCS98-Setup-3.14.0-beta.9.exe -Algorithm SHA256
```

| Artifact | SHA-256 | Size |
|---|---|---|
| `DCS98-Setup-3.14.0-beta.9.exe` | `aa4c0f92b6578368190ce8f4bb752d633f5a10f4bb3abc9238ba41b74a6a009c` | 497.2 MB |
