/**
 * Standalone entry for GhostExodus's X Listening Station.
 *
 * He asked for the station to open OUTSIDE the Ghost Intel 98 desktop — "when I click the icon or
 * name from the drop-down menu, it just launches outside Ghost Intel" — rather than inside a
 * retro-shell window. This is that: its own top-level OS window, its own document, none of the
 * app's chrome around it.
 *
 * What it deliberately is NOT is a second application. It runs on the same hardened main process:
 * the same `window.xls` boundary, the same sender validation, the same encrypted state document,
 * the same Tor gate on every byte that leaves the machine. Shipping his raw app as a separate
 * portable binary would have given the same window at the cost of plaintext evidence on disk, its
 * own clearnet-default Tor handling and the unanchored avatar fetch — the posture the operator
 * locked in on 2026-08-14. This gets him the window without paying that.
 *
 * It mounts `StationShell` rather than his `App` directly, so his stylesheet is confined the same
 * way it is in-app. Here the container IS the whole window, so the result is identical to his
 * original full-screen layout — with no chance of his sheet re-entering the app's shared bundle.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StationShell } from './modules/x-listening-embed/StationShell';

const host = document.getElementById('station-root');
if (host) {
  createRoot(host).render(
    <StrictMode>
      <StationShell />
    </StrictMode>
  );
}
