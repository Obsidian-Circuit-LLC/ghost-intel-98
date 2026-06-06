/**
 * Case export: a retro-styled, self-contained HTML summary (also the source for PDF), produced
 * fully offline. PDF uses webContents.printToPDF of the HTML loaded into a short-lived offscreen
 * window via a temp file + loadFile (the production load path) — chosen over a data: URL to stay
 * clear of the app's will-navigate scheme lockdown.
 *
 * The pure HTML builder lives in report-html.ts (no Electron — unit-testable); this file owns only
 * the Electron-dependent PDF render. buildSummaryHtml is re-exported so existing importers are
 * unaffected.
 */
import { BrowserWindow, app } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaseRecord } from '@shared/types';
import { buildSummaryHtml, type ReportImages } from './report-html';

export { buildSummaryHtml };
export type { ReportImage, ReportImages } from './report-html';

export async function renderCasePdf(c: CaseRecord, images?: ReportImages): Promise<Buffer> {
  const html = buildSummaryHtml(c, images);
  // The offscreen window must loadFile() PLAINTEXT html (it can't decrypt), so this temp can't
  // be encrypted. Therefore it must NOT live in dataRoot — a crash before the finally-rm would
  // strand a full plaintext case inside the encrypted vault. Put it in the OS temp dir, off the
  // vault's protected surface, where transient render artifacts belong.
  const tmp = join(app.getPath('temp'), `ga98-export-${randomUUID().slice(0, 8)}.html`);
  await writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  });
  const timeout = setTimeout(() => { try { win.destroy(); } catch { /* gone */ } }, 30_000);
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    return pdf;
  } finally {
    clearTimeout(timeout);
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* gone */ }
    await rm(tmp, { force: true });
  }
}
