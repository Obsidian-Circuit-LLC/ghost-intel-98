/** Pure 3-state shade model for the Jukebox window: strip (deck only) → deck (+playlist) → full
 *  (+stations drawer). Replaces jukebox-window.ts's 2-state height map. The `Playlist` button drives
 *  toggleShade (strip<->deck); the drawer down-arrow drives toggleStations (deck<->full). Heights are
 *  logical px (DPI-independent) and tunable; the module fits the WINDOW to shadeHeight(mode). */
import type { JukeboxMode } from '../../../shared/types';

export const SHADE_HEIGHTS: Record<JukeboxMode, number> = { strip: 150, deck: 470, full: 780 };

export function shadeHeight(m: JukeboxMode): number { return SHADE_HEIGHTS[m]; }

/** Playlist button: show/hide the playlist. From full, collapse all the way to strip. */
export function toggleShade(m: JukeboxMode): JukeboxMode { return m === 'strip' ? 'deck' : 'strip'; }

/** Stations down-arrow: open/close the drawer. From strip (arrow hidden but defensive), open to full. */
export function toggleStations(m: JukeboxMode): JukeboxMode { return m === 'full' ? 'deck' : 'full'; }

/** One-time migration from the deprecated jukeboxExpanded boolean. */
export function modeFromLegacy(expanded: boolean | undefined): JukeboxMode { return expanded ? 'full' : 'strip'; }
