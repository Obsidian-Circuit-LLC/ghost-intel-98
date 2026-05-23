/**
 * Thin wrapper over Electron's Notification. Tolerates platforms where
 * notifications are disabled (returns false instead of throwing).
 */

import { Notification } from 'electron';

export function showNotification(title: string, body?: string): boolean {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, silent: true /* renderer plays the synth tone */ });
  n.show();
  return true;
}
