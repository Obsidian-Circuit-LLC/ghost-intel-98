/**
 * Task TF1 — Tor-fail-closed Telegram capture window.
 *
 * Plan B captures an authenticated Telegram Web session inside the shared Plan-A
 * hardened capture window (`createCaptureWindow`), but — unlike the X caller,
 * which is clearnet on the operator's own IP — the Telegram surface is pinned to
 * Tor and FAILS CLOSED:
 *
 *   - The capture window is NOT created unless background Tor reports
 *     `isBootstrapped()`. When Tor is not ready we return a clear blocked result;
 *     there is NO clearnet fallback path.
 *   - The partition's SOCKS proxy is `socks5://127.0.0.1:<torSocksPort>`, applied
 *     and awaited BEFORE the guest loads (that ordering is owned by
 *     `createCaptureWindow`; `capture-window.test.ts` proves it). `createCaptureWindow`
 *     prepends the `socks5://` scheme, so we hand it the bare `host:port`.
 *   - A dead / zero SOCKS port still routes only to the SOCKS rule (empty
 *     bypass): the guest gets connection-refused, never a direct clearnet request.
 *   - WebRTC is locked to `disable_non_proxied_udp` on the captured webContents so
 *     a STUN/TURN path cannot leak the real IP around the SOCKS proxy.
 *
 * URL/hosts ported from quarantine `telegram-hunter/src/renderer.js` (the guest
 * loads `https://web.telegram.org/k/`; t.me profile deep-links stay in-family).
 */

import { createCaptureWindow } from '../../capture/capture-window';
import { getBgTor } from '../../bgconn/tor-singleton';

/** Telegram Web (the "K" client) — the guest surface the analyst logs into. */
const TELEGRAM_URL = 'https://web.telegram.org/k/';

/** The only hosts the Telegram capture window may navigate to. */
const TELEGRAM_HOSTS = ['web.telegram.org', 't.me'];

/** Blocked when Tor is not ready; otherwise the live capture window. */
export type TelegramCaptureResult =
  | { blocked: true; reason: string }
  | { win: Electron.BrowserWindow };

/**
 * Open the Tor-proxied, WebRTC-locked Telegram capture window on `partition`.
 * Returns `{ blocked: true }` (creating no window) if background Tor is not
 * bootstrapped — never a clearnet fallback.
 */
export async function openTelegramCapture(partition: string): Promise<TelegramCaptureResult> {
  const tor = getBgTor();
  if (!tor?.isBootstrapped()) {
    return {
      blocked: true,
      reason: 'Tor is not ready — Telegram capture is blocked (no clearnet fallback).'
    };
  }

  // Bare host:port; createCaptureWindow builds `socks5://<socks>`. A dead/zero
  // port still yields a SOCKS rule with an empty bypass — connection-refused,
  // never a direct clearnet request.
  const socks = `127.0.0.1:${tor.socksPort()}`;

  const win = await createCaptureWindow({
    partition,
    url: TELEGRAM_URL,
    allowHosts: TELEGRAM_HOSTS,
    proxy: { socks }
  });

  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  return { win };
}
