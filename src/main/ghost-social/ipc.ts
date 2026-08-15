/**
 * Ghost Social Media Manager (hardened GI98 port) — IPC registration (Phase 1 skeleton).
 *
 * Wires the password-vault lifecycle, the encrypted state store, and the per-platform defaults.
 * Every handler:
 *   - validates the SENDER FRAME first (`assertTrustedSender`) — this module later hosts remote
 *     social pages in embedded views, so an IPC message from a non-app frame is never honoured
 *     (his handlers had NO sender check — Global Constraint #7);
 *   - validates its argument SHAPE before touching any store (the renderer is hostile);
 *   - is registered through the injected event-preserving `handle` (register.ts supplies
 *     `safeHandleWithEvent`: vault gate + error sanitisation + the raw event forwarded first).
 *
 * The recovery-key export (hardening #2) is routed to a NATIVE save dialog with a symlink
 * refusal — never his Desktop auto-write. Later phases (view manager, publishing, scheduler,
 * profile-stats) extend this file; Phase 1 registers only the vault/state/defaults surface.
 */

import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../capture/capture-window';
import { prodGhostSocialVault } from './vault';
import type { RecoveryExportIo } from './vault';
import { getGhostState, saveGhostState, prodStoreDeps } from './store';
import { getPlatformDefault } from './adapters';

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

/**
 * Production recovery-export IO: a parentless native save dialog (matching the app's other
 * save-dialog exports) + a symlink-refusing write. Resolved lazily so this module stays
 * electron-free at import.
 */
function prodRecoveryExportIo(): RecoveryExportIo {
  return {
    showSaveDialog: async (defaultName) => {
      const { dialog } = await import('electron');
      const res = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      return { canceled: res.canceled, filePath: res.filePath };
    },
    assertNotSymlink: async (filePath) => {
      const { lstat } = await import('node:fs/promises');
      try {
        const st = await lstat(filePath);
        if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.');
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
      }
    },
    writeFile: async (filePath, contents) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, contents, 'utf8');
    },
  };
}

/**
 * Register every Phase-1 Ghost Social channel. `deps.handle` MUST be the event-preserving
 * wrapper (`safeHandleWithEvent`) — the plain form discards the event, which would leave
 * `assertTrustedSender` reading a spoofable/undefined value.
 */
export function registerGhostSocialIpc(deps: { handle: HandleWithEvent }): void {
  // ---- vault lifecycle ----------------------------------------------------
  deps.handle(channels.ghostSocial.vaultIsConfigured, async (e) => {
    assertTrustedSender(e);
    return (await prodGhostSocialVault()).isConfigured();
  });

  deps.handle(channels.ghostSocial.vaultSetup, async (e, passwordArg) => {
    assertTrustedSender(e);
    if (typeof passwordArg !== 'string') {
      throw new Error('Vault setup requires a password.');
    }
    // The ≥6-char minimum is enforced inside `setup` (MAIN-side, not just the UI).
    return (await prodGhostSocialVault()).setup(passwordArg);
  });

  deps.handle(channels.ghostSocial.vaultUnlock, async (e, valueArg) => {
    assertTrustedSender(e);
    if (typeof valueArg !== 'string' || !valueArg) {
      throw new Error('Unlocking requires a password or recovery key.');
    }
    return (await prodGhostSocialVault()).unlock(valueArg);
  });

  deps.handle(channels.ghostSocial.vaultLock, async (e) => {
    assertTrustedSender(e);
    (await prodGhostSocialVault()).lock();
    return true;
  });

  deps.handle(channels.ghostSocial.vaultSaveRecoveryKey, async (e, keyArg) => {
    assertTrustedSender(e);
    if (typeof keyArg !== 'string' || !keyArg) {
      throw new Error('Exporting a recovery key requires the key.');
    }
    // Hardening #2: the key goes ONLY where the native save dialog points — never Desktop.
    return (await prodGhostSocialVault()).exportRecoveryKey(keyArg, prodRecoveryExportIo());
  });

  // ---- encrypted state store ----------------------------------------------
  deps.handle(channels.ghostSocial.stateGet, async (e) => {
    assertTrustedSender(e);
    return getGhostState(await prodStoreDeps());
  });

  deps.handle(channels.ghostSocial.stateSave, async (e, stateArg) => {
    assertTrustedSender(e);
    if (!stateArg || typeof stateArg !== 'object') {
      throw new Error('Saving state requires a state object.');
    }
    // `saveGhostState` normalizes the whole record MAIN-side (heals arrays; the ARM flag can
    // only be the literal `true`), so a hostile renderer can neither corrupt the shape nor
    // smuggle in a truthy-but-not-true "armed" value.
    return saveGhostState(await prodStoreDeps(), stateArg);
  });

  // ---- platform defaults --------------------------------------------------
  deps.handle(channels.ghostSocial.platformDefaults, (e, keyArg) => {
    assertTrustedSender(e);
    if (typeof keyArg !== 'string') {
      throw new Error('Platform defaults require a platform key.');
    }
    return getPlatformDefault(keyArg);
  });
}
