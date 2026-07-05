/**
 * useClearnetLinkOpener — owns the *open policy* for links clicked in Q's replies, keeping
 * MarkdownView a pure renderer.
 *
 * Opening a link launches the OS default browser via window.api.system.openExternal
 * (main-side validateExternalUrl re-checks it). That path is CLEARNET — the destination sees
 * the real IP, not Tor — so the first open is gated behind a one-time acknowledgment
 * (ai.linkClearnetAcknowledged). Mirrors the X-collector / clearnet-web-search deanon consent.
 *
 * Caller contract: the URL passed in has ALREADY been through safeHref at render time
 * (http/https only, no userinfo). This hook does not re-scheme-guard.
 */

import { useCallback } from 'react';
import { useSettings } from '../../state/store';
import { confirmDialog } from '../../state/dialogs';

/** One-time clearnet IP-exposure warning shown before the first link opens. */
export const CLEARNET_LINK_TEXT =
  "Opening a link launches your default browser over the clearnet; the destination sees your real IP, not Tor. Continue? You won't be asked again.";

/**
 * Returns `openLink(safeUrl)`:
 * - acknowledged → opens directly via system.openExternal.
 * - not acknowledged → confirmDialog; on OK, patch the flag true then open; on Cancel, nothing.
 */
export function useClearnetLinkOpener(): (safeUrl: string) => void {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);

  return useCallback(
    (safeUrl: string) => {
      const ai = settings?.ai;
      // Settings not loaded yet — cannot read the ack state nor patch it; do nothing.
      if (!ai) return;
      if (ai.linkClearnetAcknowledged) {
        void window.api.system.openExternal(safeUrl);
        return;
      }
      void confirmDialog(CLEARNET_LINK_TEXT, 'Open link in clearnet browser?').then(async (ok) => {
        if (!ok) return;
        await patch({ ai: { ...ai, linkClearnetAcknowledged: true } });
        void window.api.system.openExternal(safeUrl);
      });
    },
    [settings, patch],
  );
}
