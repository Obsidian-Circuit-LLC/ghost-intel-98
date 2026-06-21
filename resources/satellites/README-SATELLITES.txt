Bundled satellite TLE snapshot (offline default)
================================================
active-snapshot.tle is a dated CelesTrak "active" group dump (FORMAT=tle), staged by
`pnpm fetch:tle-snapshot` and shipped via electron-builder extraResources (-> resources/satellites).
It lets the Space Satellites layer show satellites with the GeoINT network OFF. Live refresh from
CelesTrak happens only when GeoINT network is enabled. This file is DATA (not executable) — fail-soft:
if the build-time fetch fails, the last committed snapshot is kept.
