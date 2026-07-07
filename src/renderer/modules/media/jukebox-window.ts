/**
 * Window heights (CSS px, DPI-independent) for the Jukebox's two modes. The compact deck hides the file
 * toolbar + Library/Stations, so the WINDOW frame must shrink to match or a tall empty slab is left below
 * the controls (the v3.33.0 regression). Compact fits the LCD/transport deck + Artist/Title/Track fields
 * + visualizer + seek + the Vol/Viz/caret status row; expanded adds the toolbar + Library/Stations panes.
 * Fixed values keep the shade behaviour predictable and are logical px, so they hold across display scaling.
 */
export const JUKEBOX_COMPACT_H = 210;
export const JUKEBOX_EXPANDED_H = 840;

export function jukeboxWindowHeight(collapsed: boolean): number {
  return collapsed ? JUKEBOX_COMPACT_H : JUKEBOX_EXPANDED_H;
}
