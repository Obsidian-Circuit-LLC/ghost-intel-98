/**
 * WebSDR Viewer — the 851 public KiwiSDR receivers, imported from the verified-pure JSON snapshot
 * (`kiwi-directory.json`). The JSON is DATA ONLY — his `electron/kiwiDirectory.ts` was stripped of
 * its `export const … as const` wrapper so nothing executable rides along. Typed here to the
 * shared `WebSdrReceiver` shape and re-exported for the store's first-run seed.
 */
import type { WebSdrReceiver } from '@shared/websdr/types';
import data from './kiwi-directory.json';

/** The bundled public-KiwiSDR seed set (851 receivers, snapshot 11 Aug 2026). */
export const KIWI_PUBLIC_RECEIVERS: readonly WebSdrReceiver[] = data as readonly WebSdrReceiver[];

export default KIWI_PUBLIC_RECEIVERS;
