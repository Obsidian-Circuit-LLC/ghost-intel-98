/**
 * Weather tool — renderer module (OURS, Phase 2; design spec 2026-08-15).
 *
 * A native Win98-retro utility over Phase 1's IPC (`window.api.weather`): saved locations
 * (add-by-geocode / switch / remove / reorder), a current-conditions card, today's hourly strip and
 * a 7-day daily row from Open-Meteo, a persisted metric↔imperial units toggle, a live TOR/CLEARNET
 * egress marker with the one-time clearnet acknowledgement, and a stale-cache / fail-closed surface.
 *
 * Egress posture is resolved MAIN-side (`weather.egressState`) and only surfaced here; the clearnet
 * flip is a settings patch (`{ weather: { clearnet, clearnetAck } }` — a full nested block, never a
 * bare `{ clearnet }`, so a sibling field can't be dropped) gated behind the themed confirm dialog on
 * the first false→true flip while unacknowledged (mirrors x-listening / host-info / ai-assistant).
 *
 * Theme: `--ga98-*` tokens only (weather.css) — renders in classic + QUIET AMETHYST like every
 * built-in. No device geolocation; a saved location contributes only a name + numeric lat/lon.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ForecastBundle,
  GeocodeMatch,
  SavedLocation,
  Units,
  WeatherEgressState,
} from '@shared/weather/types';
import { lookupWeatherCode } from '@shared/weather/types';
import { useSettings } from '../../state/store';
import { confirmDialog } from '../../state/dialogs';
import './weather.css';

const CLEARNET_WARNING =
  'Routing weather over CLEARNET fetches Open-Meteo directly over your real IP instead of Tor. ' +
  'This is remembered — you will not be asked again unless you clear it in Settings. Enable clearnet?';

/** Unit labels derived from the FETCHED bundle's `units`, so the labels always match the numbers. */
function unitLabels(units: Units): { temp: string; wind: string; precip: string } {
  return units === 'imperial'
    ? { temp: '°F', wind: 'mph', precip: 'in' }
    : { temp: '°C', wind: 'km/h', precip: 'mm' };
}

/** Round a temperature to a whole degree for display (Open-Meteo returns one decimal). */
function temp(n: number): string {
  return `${Math.round(n)}`;
}

/** Slice the local hour "HH:MM" out of an Open-Meteo ISO local time (timezone=auto) — deterministic,
 *  no Date/timezone math (the response is already local to the location). */
function hourLabel(iso: string): string {
  const t = iso.slice(11, 16);
  return t || iso;
}

/** Weekday for a YYYY-MM-DD date. Parsed at UTC noon so the label never slips a day across zones. */
function weekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

/** Best-effort human time for the "cached <time>" stamp. */
function cachedLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function WeatherModule(): JSX.Element {
  const patchSettings = useSettings((s) => s.patch);

  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [egress, setEgress] = useState<WeatherEgressState | null>(null);

  const [bundle, setBundle] = useState<ForecastBundle | null>(null);
  const [stale, setStale] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | undefined>(undefined);
  const [staleError, setStaleError] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Guards a race: a stale forecast response for a location the user already switched away from must
  // not overwrite the current one. Only the latest requested id may commit.
  const inFlightId = useRef<string | null>(null);

  const refreshEgress = useCallback(async () => {
    try {
      setEgress(await window.api.weather.egressState());
    } catch {
      /* leave the last marker */
    }
  }, []);

  const runForecast = useCallback(async (id: string) => {
    inFlightId.current = id;
    setLoadingForecast(true);
    setBlocked(null);
    try {
      const res = await window.api.weather.forecast(id);
      if (inFlightId.current !== id) return;
      setBundle(res.bundle);
      setStale(res.stale);
      setCachedAt(res.cachedAt);
      setStaleError(res.error);
    } catch (err) {
      if (inFlightId.current !== id) return;
      // Fail-closed / no-cache: surface the reach/blocked message + offer the clearnet toggle.
      setBundle(null);
      setStale(false);
      setBlocked((err as Error)?.message ?? 'Could not reach Open-Meteo.');
    } finally {
      if (inFlightId.current === id) setLoadingForecast(false);
    }
  }, []);

  const selectLocation = useCallback(
    (id: string) => {
      setSelectedId(id);
      void runForecast(id);
    },
    [runForecast],
  );

  // Mount: load units (into the toggle), egress marker, and the saved-locations list; auto-select
  // the first location and fetch it.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [list, storedUnits] = await Promise.all([
        window.api.weather.locationsList().catch(() => [] as SavedLocation[]),
        window.api.weather.unitsGet().catch(() => null),
        refreshEgress(),
      ]);
      if (!alive) return;
      // The store is the read source of truth for the fetched units; heal the settings-backed toggle
      // to it on mount so the two can't disagree (e.g. if weather.json was reset but settings survived).
      const w = useSettings.getState().settings?.weather;
      if (storedUnits && w && w.units !== storedUnits) await patchSettings({ weather: { ...w, units: storedUnits } });
      setLocations(list);
      if (list.length > 0) selectLocation(list[0].id);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The persisted units preference is read from settings so the toggle survives a restart. The
  // FETCHED bundle's `units` is what actually labels the numbers.
  const units: Units = useSettings((s) => s.settings?.weather?.units) ?? 'metric';

  const setUnits = useCallback(
    async (next: Units) => {
      if (next === units) return;
      await window.api.weather.unitsSet(next);
      // mirror into settings so the toggle + a restart agree (store is the read source of truth)
      const w = useSettings.getState().settings?.weather;
      if (w) await patchSettings({ weather: { ...w, units: next } });
      if (selectedId) void runForecast(selectedId);
    },
    [units, selectedId, runForecast, patchSettings],
  );

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setMatches(null);
    try {
      const found = await window.api.weather.geocode(q);
      setMatches(found);
      if (found.length === 0) setSearchError(`No match for “${q}”.`);
    } catch (err) {
      setSearchError((err as Error)?.message ?? 'Search failed.');
    } finally {
      setSearching(false);
    }
  }, [query]);

  const addMatch = useCallback(
    async (m: GeocodeMatch) => {
      const list = await window.api.weather.locationsAdd({
        name: m.name,
        country: m.country,
        admin1: m.admin1,
        latitude: m.latitude,
        longitude: m.longitude,
      });
      setLocations(list);
      setMatches(null);
      setQuery('');
      setSearchError(null);
      // select the newly-added location (matched by coordinates; the store assigns the id)
      const added = list.find((l) => l.latitude === m.latitude && l.longitude === m.longitude) ?? list[list.length - 1];
      if (added) selectLocation(added.id);
    },
    [selectLocation],
  );

  const removeLocation = useCallback(
    async (id: string) => {
      const list = await window.api.weather.locationsRemove(id);
      setLocations(list);
      if (selectedId === id) {
        if (list.length > 0) selectLocation(list[0].id);
        else {
          setSelectedId(null);
          setBundle(null);
          setBlocked(null);
        }
      }
    },
    [selectedId, selectLocation],
  );

  const move = useCallback(
    async (id: string, dir: -1 | 1) => {
      const idx = locations.findIndex((l) => l.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= locations.length) return;
      const order = locations.map((l) => l.id);
      [order[idx], order[to]] = [order[to], order[idx]];
      setLocations(await window.api.weather.locationsReorder(order));
    },
    [locations],
  );

  const toggleClearnet = useCallback(
    async (next: boolean) => {
      const w = useSettings.getState().settings?.weather;
      if (!w) return;
      if (next && !w.clearnetAck) {
        const ok = await confirmDialog(CLEARNET_WARNING, 'Enable clearnet weather');
        if (!ok) return;
        await patchSettings({ weather: { ...w, clearnet: true, clearnetAck: true } });
      } else {
        await patchSettings({ weather: { ...w, clearnet: next } });
      }
      await refreshEgress();
      if (selectedId) void runForecast(selectedId);
    },
    [patchSettings, refreshEgress, selectedId, runForecast],
  );

  // ── egress marker copy ──────────────────────────────────────────────────
  const egressMode = egress?.mode ?? 'tor';
  const egressClass =
    egressMode === 'clearnet' ? 'is-clearnet' : egressMode === 'blocked' ? 'is-blocked' : 'is-tor';
  const egressTitle =
    egressMode === 'clearnet' ? 'CLEARNET — REAL IP' : egressMode === 'blocked' ? 'TOR UNAVAILABLE' : 'TOR MODE';
  const egressSub =
    egressMode === 'clearnet'
      ? 'Open-Meteo is fetched directly over your real IP.'
      : egressMode === 'blocked'
        ? egress?.reason ?? 'Background Tor is not ready — enable clearnet to fetch.'
        : 'Routed over background Tor; fails closed when Tor is down.';

  const lbl = unitLabels(bundle?.units ?? units);
  const selected = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="ga98-weather">
      {/* ── Sidebar: search-to-add + saved locations ─────────────────────── */}
      <div className="ga98-weather-side">
        <div className="ga98-weather-search">
          <div className="ga98-weather-search-row">
            <input
              type="text"
              aria-label="Add a city"
              placeholder="Add a city…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch();
              }}
            />
            <button aria-label="Search for a city" onClick={() => void doSearch()} disabled={searching}>
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {searchError && <div className="ga98-weather-note">{searchError}</div>}
          {matches && matches.length > 0 && (
            <ul className="ga98-weather-matches">
              {matches.map((m) => (
                <li className="ga98-weather-match" key={m.geoId}>
                  <span>
                    <span className="ga98-weather-match-name">{m.name}</span>{' '}
                    <span className="ga98-weather-match-sub">
                      {[m.admin1, m.country].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  <button aria-label={`Add ${m.name}, ${m.country}`} onClick={() => void addMatch(m)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {locations.length === 0 ? (
          <div className="ga98-weather-empty">No saved locations yet. Search for a city above to add one.</div>
        ) : (
          <ul className="ga98-weather-locs">
            {locations.map((l, i) => (
              <li className={`ga98-weather-loc${l.id === selectedId ? ' is-selected' : ''}`} key={l.id}>
                <button
                  className="ga98-weather-loc-pick"
                  aria-label={`Show weather for ${l.name}`}
                  onClick={() => selectLocation(l.id)}
                >
                  {l.name}
                  <span className="ga98-weather-loc-sub"> {[l.admin1, l.country].filter(Boolean).join(', ')}</span>
                </button>
                <span className="ga98-weather-loc-btns">
                  <button aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => void move(l.id, -1)}>
                    ▲
                  </button>
                  <button
                    aria-label={`Move ${l.name} down`}
                    disabled={i === locations.length - 1}
                    onClick={() => void move(l.id, 1)}
                  >
                    ▼
                  </button>
                  <button aria-label={`Remove ${l.name}`} onClick={() => void removeLocation(l.id)}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Main pane ─────────────────────────────────────────────────────── */}
      <div className="ga98-weather-main">
        <div className="ga98-weather-topbar">
          <div className={`ga98-weather-egress ${egressClass}`}>
            <div className="ga98-weather-egress-label">
              <strong>{egressTitle}</strong>
              <small>{egressSub}</small>
            </div>
            <label className="ga98-weather-egress-toggle">
              <input
                type="checkbox"
                aria-label="Route over clearnet (real IP)"
                checked={egress?.clearnet ?? false}
                onChange={(e) => void toggleClearnet(e.target.checked)}
              />
              clearnet
            </label>
          </div>
          <div className="ga98-weather-units" role="group" aria-label="Units">
            <button aria-label="Metric units" aria-pressed={units === 'metric'} onClick={() => void setUnits('metric')}>
              °C
            </button>
            <button aria-label="Imperial units" aria-pressed={units === 'imperial'} onClick={() => void setUnits('imperial')}>
              °F
            </button>
          </div>
        </div>

        {stale && (
          <div className="ga98-weather-stale">
            {staleError ? `${staleError} — ` : ''}Showing the last cached reading · cached {cachedLabel(cachedAt)}.
          </div>
        )}

        {blocked && (
          <div className="ga98-weather-blocked">
            <strong>Couldn’t fetch the forecast.</strong>
            <div>{blocked}</div>
            <div>Enable the clearnet toggle above to fetch over your real IP instead of Tor.</div>
          </div>
        )}

        {!selected && !blocked && (
          <div className="ga98-weather-note">Select or add a location to see its weather.</div>
        )}

        {bundle && selected && (
          <>
            <Current bundle={bundle} lbl={lbl} name={selected.name} loading={loadingForecast} />

            <div>
              <div className="ga98-weather-h">Today · hourly</div>
              <div className="ga98-weather-hourly">
                {bundle.hourlyToday.map((h) => {
                  const info = lookupWeatherCode(h.weatherCode);
                  return (
                    <div className="ga98-weather-hour" key={h.time}>
                      <span className="ga98-weather-hour-time">{hourLabel(h.time)}</span>
                      <span className="ga98-weather-hour-glyph" title={info.label} aria-hidden="true">
                        {info.glyph}
                      </span>
                      <span className="ga98-weather-hour-temp">
                        {temp(h.temperature)}
                        {lbl.temp}
                      </span>
                      <span className="ga98-weather-hour-pop">{h.precipitationProbability}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="ga98-weather-h">7-day</div>
              <div className="ga98-weather-daily">
                {bundle.daily.map((d) => {
                  const info = lookupWeatherCode(d.weatherCode);
                  return (
                    <div className="ga98-weather-day" key={d.date}>
                      <span className="ga98-weather-day-name">{weekday(d.date)}</span>
                      <span className="ga98-weather-day-glyph" title={info.label} aria-hidden="true">
                        {info.glyph}
                      </span>
                      <span className="ga98-weather-day-hilo">
                        {temp(d.temperatureMax)}
                        {lbl.temp} <span className="ga98-weather-day-lo">/ {temp(d.temperatureMin)}{lbl.temp}</span>
                      </span>
                      <span className="ga98-weather-day-pop">{d.precipitationProbabilityMax}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Current({
  bundle,
  lbl,
  name,
  loading,
}: {
  bundle: ForecastBundle;
  lbl: { temp: string; wind: string; precip: string };
  name: string;
  loading: boolean;
}): JSX.Element {
  const c = bundle.current;
  const info = lookupWeatherCode(c.weatherCode);
  return (
    <div className="ga98-weather-current" aria-busy={loading}>
      <span className="ga98-weather-current-glyph" aria-hidden="true">
        {info.glyph}
      </span>
      <div className="ga98-weather-current-main">
        <span className="ga98-weather-current-temp">
          {temp(c.temperature)}
          {lbl.temp}
        </span>
        <span className="ga98-weather-current-cond">{info.label}</span>
        <span className="ga98-weather-current-meta">
          {name} · Feels like {temp(c.apparentTemperature)}
          {lbl.temp}
        </span>
      </div>
      <dl className="ga98-weather-current-stats">
        <dt>Wind</dt>
        <dd>
          {Math.round(c.windSpeed)} {lbl.wind}
        </dd>
        <dt>Humidity</dt>
        <dd>{c.relativeHumidity}%</dd>
        <dt>Precip</dt>
        <dd>
          {c.precipitation} {lbl.precip}
        </dd>
      </dl>
    </div>
  );
}
