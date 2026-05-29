/**
 * Case export: a retro-styled, self-contained HTML summary (also the source for PDF), produced
 * fully offline. PDF uses webContents.printToPDF of the HTML loaded into a short-lived offscreen
 * window via a temp file + loadFile (the production load path) — chosen over a data: URL to stay
 * clear of the app's will-navigate scheme lockdown.
 */
import { BrowserWindow, app } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaseRecord } from '@shared/types';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c));
}

export function buildSummaryHtml(c: CaseRecord): string {
  const row = (label: string, value: string): string => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
  const list = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p class="muted">— none —</p>');

  const entitiesByBucket = (['family', 'associate', 'other', undefined] as const).map((b) => {
    const items = c.entities.filter((e) => (e.relationship ?? undefined) === b);
    if (!items.length) return '';
    const label = b ? b[0].toUpperCase() + b.slice(1) : 'Untagged';
    return `<h3>${label}</h3>${list(items.map((e) => `<b>${esc(e.entity.value)}</b> <span class="muted">[${esc(e.entity.type)}]</span>${e.entity.notes ? ` — ${esc(e.entity.notes)}` : ''}`))}`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title>
<style>
  body { font-family: "Segoe UI", Tahoma, sans-serif; font-size: 13px; color: #000; margin: 24px; background: #fff; }
  h1 { font-size: 20px; border-bottom: 2px solid #000080; padding-bottom: 4px; }
  h2 { font-size: 15px; background: #000080; color: #fff; padding: 3px 6px; margin-top: 20px; }
  h3 { font-size: 13px; margin: 10px 0 4px; }
  table.meta { border-collapse: collapse; margin: 8px 0; }
  table.meta th { text-align: left; padding: 2px 10px 2px 0; vertical-align: top; width: 110px; color: #444; }
  ul { margin: 4px 0; padding-left: 20px; }
  .muted { color: #888; }
  .ts { color: #666; font-size: 11px; }
</style></head><body>
  <h1>${esc(c.title)}</h1>
  <table class="meta">
    ${row('Reference', esc(c.reference) || '<span class="muted">—</span>')}
    ${row('Status', `${esc(c.status)} · ${esc(c.priority)} priority`)}
    ${row('Tags', esc(c.tags.join(', ')) || '<span class="muted">—</span>')}
    ${row('Created', `<span class="ts">${esc(c.createdAt)}</span>`)}
    ${row('Updated', `<span class="ts">${esc(c.updatedAt)}</span>`)}
  </table>
  <h2>Description</h2>
  <p>${esc(c.description) || '<span class="muted">— none —</span>'}</p>
  <h2>Entities</h2>
  ${entitiesByBucket || '<p class="muted">— none —</p>'}
  <h2>Tasks</h2>
  ${list(c.tasks.map((t) => `[${t.done ? 'x' : ' '}] ${esc(t.text)}${t.dueAt ? ` <span class="ts">(due ${esc(t.dueAt)})</span>` : ''}`))}
  <h2>Web links</h2>
  ${list(c.links.map((l) => `${esc(l.title)} — ${esc(l.url)}`))}
  <h2>Reminders</h2>
  ${list(c.reminders.map((r) => `${esc(r.title)} <span class="ts">@ ${esc(r.fireAt)}${r.fired ? ' (fired)' : ''}</span>`))}
  <h2>Attachments</h2>
  ${list(c.attachments.map((a) => `${esc(a.originalName)} <span class="ts">(${Math.ceil(a.size / 1024)} KB)</span>`))}
  <h2>Timeline</h2>
  ${list(c.timeline.map((e) => `<span class="ts">${esc(e.at)}</span> [${esc(e.kind)}] ${esc(e.message)}`))}
  <hr><p class="muted">Exported from Ghost Access 98 · ${esc(c.id)}</p>
</body></html>`;
}

export async function renderCasePdf(c: CaseRecord): Promise<Buffer> {
  const html = buildSummaryHtml(c);
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
