/**
 * The container GhostExodus's embedded station lives in.
 *
 * WHY THIS EXISTS (the v3.73.0 regression). His stylesheet was written for a standalone app, so it
 * styles global element selectors — `*`, `html, body, #root`, `button`, `input, select, textarea`,
 * `nav`, `main`, `h1`–`h3`, `label`, `::-webkit-scrollbar`. v3.73.0 imported it directly into the
 * app's renderer, which applied every one of those to the WHOLE of Ghost Intel 98: gold gradient
 * buttons in every module, dark text fields with pale text on light surfaces, and a Case Manager
 * whose layout collapsed into itself.
 *
 * His file is not edited to fix that — it stays byte-identical to his original, which is the whole
 * point of the embed. It is read as TEXT and confined to this container by `scopeCss`, then
 * injected once. His `:root`/`html`/`body`/`#root` rules land on this element, so the dark console
 * surface he designed paints his panel and stops at its edge.
 *
 * The style element is shared across mounts (keyed by scope) rather than injected per instance, so
 * opening the station twice does not duplicate a ~30 KB sheet.
 */
import { useEffect, type JSX } from 'react';
import { scopeCss } from '@shared/xls/scope-css';
import { App } from './StationApp';
// His stylesheet as TEXT, not as a stylesheet — importing it normally is what leaked it app-wide.
import stationCss from './station.css?raw';

export const STATION_SCOPE = 'xls-embed-root';
const STYLE_ID = 'ga98-xls-embed-style';

/** Inject his scoped sheet once per document. */
function ensureStationStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = scopeCss(stationCss, `.${STATION_SCOPE}`);
  document.head.appendChild(el);
}

export function StationShell(): JSX.Element {
  // Injected in an effect rather than at module load so importing this file (in a test, or through
  // the module registry before the window opens) never mutates the document as a side effect.
  useEffect(() => { ensureStationStyles(); }, []);
  // Synchronous first paint: without this the first frame renders his markup unstyled.
  ensureStationStyles();

  return (
    <div className={STATION_SCOPE} style={{ height: '100%', overflow: 'hidden' }}>
      <App />
    </div>
  );
}
