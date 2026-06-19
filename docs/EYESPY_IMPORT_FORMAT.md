# EyeSpy — camera-feed import format

EyeSpy's **Import…** button bulk-loads *your own* camera-feed list from a file you choose. It parses
the file; it never probes, scans, or enumerates any network. Supported file types: **JSON**, **CSV**,
or a **plain one-URL-per-line** text file. Entries without a recognizable URL are dropped, and the
list is de-duplicated by URL.

The goal of a good import file is **full categorization**: each feed lands under the right
**Country ▸ State/Region ▸ City** in the finder, with a readable name. That only happens when the
file carries that information — the app never invents a location.

---

## Recommended: flat JSON array of objects

One object per camera. This is the most explicit format and gives you real names, full
categorization, and (optionally) map pins:

```json
[
  {
    "label": "Horse Guards Avenue",
    "url": "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07489.mp4",
    "kind": "mp4",
    "country": "United Kingdom",
    "region": "England",
    "city": "London",
    "lat": 51.5061,
    "lon": -0.1247
  }
]
```

Only `url` is required. Omit any field you don't have.

### Field reference

Field names are matched case-insensitively; any listed alias works.

| Field          | Accepted keys                                   | Notes |
|----------------|-------------------------------------------------|-------|
| URL (required) | `url` / `src` / `stream` / `stream_url` / `link` / `address` | Must be a real `scheme://…` URL. |
| Name           | `label` / `name` / `title`                      | Display name. **If omitted, the feed is labelled with the URL host** — which is why a name-less S3/IP list shows every camera identically. |
| Kind           | `kind` / `type` / `protocol`                    | One of `hls` `mjpeg` `rtsp` `http` `mp4`. If omitted, inferred from the URL (`.mp4`→mp4, `.m3u8`→hls, `.jpg/.png/…`→http, `rtsp://`→rtsp, otherwise mjpeg). |
| Country        | `country`                                       | Top-level grouping. |
| Region / State | `region` / `state` / `province`                 | |
| City           | `city` / `town`                                 | |
| Latitude       | `lat` / `latitude`                              | Optional. Also read from a nested `coordinates` block (below). |
| Longitude      | `lon` / `lng` / `long` / `longitude`            | Optional. With lat+lon a camera can also drop a pin on the GeoINT map. |

Coordinates may instead live in a nested `coordinates` object — the common scrape shape
`{ "coordinates": { "latitude": …, "longitude": … } }`. Flat `lat`/`lon` keys win when both are
present; otherwise the nested block is used.
| Source         | `source` / `provider` / `dataset`               | Optional free-text tag. |

---

## Nested geo tree (JSON)

Location encoded in the nesting, leaves are arrays of URL strings. This is the common
"scraped-by-country" dump shape:

```json
{
  "United Kingdom": {
    "England": {
      "London": [
        "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07489.mp4",
        "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03658.mp4"
      ]
    }
  }
}
```

Depth is flexible:

- 3 levels → **Country ▸ Region ▸ City** (as above).
- 2 levels (`Country ▸ City`) → country + city, no region.
- 1 level (`Country ▸ [urls]`) → country only.
- 4+ levels → first key is the country, the last is the city, the middle keys join into the region.

A leaf may also be an array of `{ "url": …, "name": …, … }` objects — an object's own `name`/geo
overrides the path. Bare-URL leaves are labelled `"{City} · {host}"`, so prefer the flat-object
format above if you want to carry real per-camera names.

The leaf objects may use the `stream_url` key and a nested `coordinates` block, so a
scraped-by-country dump like this imports directly with no reshaping:

```json
{
  "United Kingdom": {
    "Greater London": {
      "A1 Archway Rd/Bakers Ln": [
        {
          "stream_url": "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.09732.mp4",
          "coordinates": { "latitude": 51.5818, "longitude": -0.15644 }
        }
      ]
    }
  }
}
```

---

## CSV

Must have a **header row** that names the columns (same names/aliases as the JSON fields), and must
be **comma-delimited**:

```csv
label,url,kind,country,region,city,lat,lon
"Horse Guards Avenue",https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07489.mp4,mp4,United Kingdom,England,London,51.5061,-0.1247
```

Two gotchas:

- **No header row ⇒ geo is ignored.** Without a header the parser falls back to a positional guess
  that only recognizes URL/kind/label; country/region/city columns are silently skipped.
- **Comma delimiter only.** Tab- or semicolon-separated files collapse each row into one field. Quote
  any value that itself contains a comma (`"Lobby, East"`).

---

## Plain URL list

A `.txt` file with one URL per line (`#` lines are treated as comments) is accepted, but carries no
names or locations — every feed is labelled with its host and lands under "Ungeocoded". Use one of
the formats above to categorize.

---

## Tips

- Re-importing **adds** to your library (de-duped by URL); it does not replace it. To start clean,
  use **Purge all…** in EyeSpy first.
- `lat`/`lon` are optional for the finder tree but enable a map pin — include them when you have them.
- Everything here is parsed locally and offline. No part of import contacts the network.
