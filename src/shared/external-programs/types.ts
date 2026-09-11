/**
 * External Apps — "connect ANY app to Ghost Intel 98" by dropping it into the Programs folder
 * (GhostExodus's spec, modelled after Firefox Portable's drop-in-and-run pattern). Types shared
 * main↔renderer.
 *
 * A program is discovered, never registered: dropping a file into the folder is the only
 * "installation" step there is, and nothing here executes anything just because it was found —
 * discovery only ever produces this descriptor, launching is a separate, explicit action.
 */

/** One discovered program, ready to show in a list or launch by id. `id` is stable for one scan
 *  and opaque to the renderer — the renderer never sees or sends a filesystem path; launching goes
 *  through this id so the main process is always the one resolving where it points. */
export interface ExternalProgram {
  id: string;
  name: string;
  /** The executable's filename, for display only (e.g. "MyTool.exe") — never a full path. */
  executableName: string;
  category?: string;
  description?: string;
  /** True when an `app.json` manifest supplied these fields; false for a bare .exe/.bat/.cmd
   *  discovered with no manifest (name is then just the filename, nothing else is set). */
  hasManifest: boolean;
}

/** What dropping an `app.json` next to (or naming) an executable may specify. Every field but
 *  `executable` is optional — a name-only manifest still beats no manifest, since it wins over the
 *  bare filename as the display name. */
export interface ExternalProgramManifest {
  name?: string;
  executable: string;
  icon?: string;
  category?: string;
  description?: string;
  arguments?: string[];
  workingDirectory?: string;
}

export interface ExternalProgramsScanResult {
  programs: ExternalProgram[];
  /** Human-readable notes about entries that were skipped (malformed manifest, traversal attempt,
   *  ambiguous folder, duplicate) — surfaced in Program Manager, never thrown; one bad drop must
   *  not hide every good one. */
  diagnostics: string[];
}
