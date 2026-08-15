/**
 * WebSDR Viewer — shared record shapes (hardened port of GhostExodus's "SDR Eaves-Dropper").
 *
 * These mirror his `electron/main.ts` DB shapes (`Receiver`/`Preset`/`Note`/`Recording`) but
 * are hardened for the Ghost Intel 98 port: every persisted record routes through secure-fs
 * (AES-GCM at rest), never his plaintext `sdr-eaves-dropper.json` + `.webm` beside the exe. A
 * recording therefore carries NO absolute `filePath` to a plaintext file — its bytes live in the
 * encrypted recordings store, keyed by `id` (see `WebSdrRecordingMeta`).
 *
 * Shared (not main-only) so the renderer, preload allow-list, and `api.d.ts` all type against one
 * source of truth. Pure data + a URL validator — no electron/node import lives here.
 */

/** Receiver kind. Matches his four categories; `Generic` covers any other public SDR website. */
export type WebSdrReceiverType = 'WebSDR' | 'KiwiSDR' | 'OpenWebRX' | 'Generic';

/** One public SDR receiver website in the directory (his `Receiver`). `url` is always an
 *  http/https URL that has passed `normalizeWebSdrUrl` at the trust boundary. */
export interface WebSdrReceiver {
  id: string;
  name: string;
  url: string;
  type: WebSdrReceiverType;
  location: string;
  notes: string;
  favorite: boolean;
}

/** A saved frequency preset (his `Preset`): a frequency + demod mode, optionally bound to a
 *  receiver. `frequencyHz` is the tuned frequency in hertz. */
export interface WebSdrPreset {
  id: string;
  name: string;
  frequencyHz: number;
  mode: string;
  receiverId?: string;
  notes: string;
}

/** A listening note (his `Note`): a free-text observation with the receiver/frequency/mode
 *  context it was taken in. `createdAt`/`updatedAt` are ISO strings stamped MAIN-side from the
 *  injected clock (determinism — never accepted verbatim from the renderer). */
export interface WebSdrNote {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  receiverId?: string;
  frequencyHz?: number;
  mode?: string;
}

/**
 * Metadata for one archived recording (his `Recording`, hardened). The captured `.webm` bytes
 * are stored ENCRYPTED in the recordings store keyed by `id` — there is deliberately NO plaintext
 * `filePath` field (his `filePath` pointed at an unencrypted file beside the exe). Export to a
 * user-chosen plaintext path is an explicit, save-dialog-gated action handled in Phase 3.
 */
export interface WebSdrRecordingMeta {
  id: string;
  receiverId?: string;
  receiverName: string;
  sourceUrl: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  frequencyHz?: number;
  mode?: string;
  notes: string;
  sizeBytes: number;
}

/** The stable keys of the built-in Station Menu sections (his left sidebar). */
export type WebSdrMenuBuiltinKey =
  | 'all-feeds'
  | 'favorites'
  | 'presets'
  | 'add-feed'
  | 'customize';

/** One Station Menu item — a built-in section or a custom shortcut to a saved receiver.
 *  Built-ins are `builtin:true` and identified by a `WebSdrMenuBuiltinKey`; custom shortcuts
 *  are `builtin:false` and carry a `receiverId`. Any item can be renamed, hidden, or reordered
 *  (order = array position). */
export interface WebSdrMenuItem {
  key: string;
  label: string;
  hidden: boolean;
  builtin: boolean;
  receiverId?: string;
}

/** The persisted Station Menu configuration (his customizable sidebar). */
export interface WebSdrStationMenu {
  items: WebSdrMenuItem[];
}

/**
 * The receiver session's egress path. `clearnet` (DEFAULT) connects directly; `tor` routes the
 * dedicated `persist:websdr` session through the app's background Tor SOCKS endpoint. This is the
 * app's ONE narrow clearnet-default exception (operator decision 2026-08-14) — it never changes
 * global app egress. A visible marker always reflects the current value.
 */
export type WebSdrEgressMode = 'clearnet' | 'tor';

/** The persisted egress-toggle state for the receiver session. */
export interface WebSdrEgressState {
  mode: WebSdrEgressMode;
}

/** The default egress mode: clearnet (works out of the box; Tor is a warned opt-in). */
export const DEFAULT_WEBSDR_EGRESS: WebSdrEgressState = { mode: 'clearnet' };

/** The default Station Menu — the five built-in sections in his order, all visible. */
export function defaultWebSdrMenu(): WebSdrStationMenu {
  return {
    items: [
      { key: 'all-feeds', label: 'All Feeds', hidden: false, builtin: true },
      { key: 'favorites', label: 'Favorites', hidden: false, builtin: true },
      { key: 'presets', label: 'Presets', hidden: false, builtin: true },
      { key: 'add-feed', label: 'Add Feed', hidden: false, builtin: true },
      { key: 'customize', label: 'Customize', hidden: false, builtin: true },
    ],
  };
}
