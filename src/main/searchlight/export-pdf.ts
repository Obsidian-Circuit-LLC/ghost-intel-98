/**
 * Dep-free PDF export for Searchlight sweep reports.
 *
 * Uses Electron's BrowserWindow.webContents.printToPDF — no jsPDF, no external libs.
 * The hidden window loads the HTML via a data: URL, renders it, and streams the PDF
 * back to the main process which then writes it to the user-chosen path.
 *
 * sanitizePdfFilename is exported for unit tests (pure, no Electron dep).
 */

import { BrowserWindow, dialog } from 'electron';
import * as fs from 'node:fs/promises';

/**
 * Strip path separators, illegal filename chars, and control characters from a
 * suggested PDF filename. Always returns a non-empty string ending in `.pdf`.
 */
export function sanitizePdfFilename(name: string): string {
  // Remove illegal filename characters (Windows + POSIX superset)
  let base = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip any trailing .pdf suffix (we'll re-add exactly one)
  if (base.toLowerCase().endsWith('.pdf')) {
    base = base.slice(0, -4).trim();
  }

  // Fall back to a safe default if the input was empty or purely illegal chars
  if (!base) base = 'searchlight-report';

  return `${base}.pdf`;
}

/**
 * Render `html` to PDF via a hidden, sandboxed BrowserWindow and show a native
 * save dialog so the user can choose the destination.
 *
 * Returns `{ ok: true }` on successful save, `{ ok: false }` if the user cancels.
 * The hidden window is always destroyed (via finally), even on error.
 */
export async function exportSweepPdf(
  html: string,
  suggestedName: string
): Promise<{ ok: boolean }> {
  const defaultPath = sanitizePdfFilename(suggestedName);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: false,
    },
  });

  let buf: Buffer;
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    buf = await win.webContents.printToPDF({ printBackground: true });
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* already gone */
    }
  }

  const result = await dialog.showSaveDialog({ defaultPath });
  if (result.canceled || !result.filePath) return { ok: false };

  await fs.writeFile(result.filePath, buf);
  return { ok: true };
}
