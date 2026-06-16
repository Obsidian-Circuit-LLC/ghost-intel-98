/**
 * Pure case-summary HTML builder — no Electron, no fs, no decryption. Deterministic given its
 * inputs, so it unit-tests under the node vitest env directly. The PDF path (renderCasePdf, in
 * export.ts) renders this HTML offline with javascript:false and no network, which is exactly why
 * embedded photos must arrive as pre-built `data:` URIs: the render sandbox can neither fetch nor
 * decrypt. Gathering + decrypting those bytes stays in the main process (the IPC handler), never
 * here and never in the renderer.
 */
import type { CaseRecord } from '@shared/types';

/** A single image to embed in the report. `dataUri` must be a self-contained data:image URI. */
export interface ReportImage {
  /** Plain-text caption shown under the image (HTML-escaped at render time). */
  caption: string;
  /** `data:image/<jpeg|png|webp|gif>;base64,...` — anything else is dropped, not rendered. */
  dataUri: string;
}

/** Photos to embed, already decrypted into data URIs by the main process. */
export interface ReportImages {
  bio: ReportImage[];
  attachments: ReportImage[];
  /** Rendered as a muted note when some images were skipped (size budget). */
  omittedNote?: string;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c));
}

// Only well-formed, standard-alphabet base64 image data URIs are emitted. This is defence in depth:
// the URIs are built in main from bytes we just read, but validating here means a malformed value
// can never reach an <img src> attribute regardless of how the builder is called.
const DATA_IMG_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function figure(im: ReportImage): string {
  if (!DATA_IMG_RE.test(im.dataUri)) return '';
  return `<figure class="img"><img src="${im.dataUri}" alt="${esc(im.caption)}"><figcaption>${esc(im.caption)}</figcaption></figure>`;
}

function gallery(title: string, items: ReportImage[]): string {
  const figs = items.map(figure).filter(Boolean);
  if (!figs.length) return '';
  return `<h2>${esc(title)}</h2><div class="gallery">${figs.join('')}</div>`;
}

export function buildSummaryHtml(c: CaseRecord, images?: ReportImages): string {
  const row = (label: string, value: string): string => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
  const list = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p class="muted">— none —</p>');

  const entitiesByBucket = (['family', 'associate', 'other', undefined] as const).map((b) => {
    const items = c.entities.filter((e) => (e.relationship ?? undefined) === b);
    if (!items.length) return '';
    const label = b ? b[0].toUpperCase() + b.slice(1) : 'Untagged';
    return `<h3>${label}</h3>${list(items.map((e) => `<b>${esc(e.entity.value)}</b> <span class="muted">[${esc(e.entity.type)}]</span>${e.entity.notes ? ` — ${esc(e.entity.notes)}` : ''}`))}`;
  }).join('');

  const bioBlock = images ? gallery('Bio images', images.bio) : '';
  const attImgBlock = images ? gallery('Attachment images', images.attachments) : '';
  const omitted = images?.omittedNote ? `<p class="muted">${esc(images.omittedNote)}</p>` : '';

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
  .gallery { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0; }
  figure.img { margin: 0; max-width: 260px; page-break-inside: avoid; }
  figure.img img { max-width: 260px; max-height: 260px; border: 1px solid #808080; display: block; }
  figure.img figcaption { font-size: 11px; color: #444; word-break: break-word; margin-top: 2px; }
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
  ${bioBlock}
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
  ${attImgBlock}
  ${omitted}
  <h2>Timeline</h2>
  ${list(c.timeline.map((e) => `<span class="ts">${esc(e.at)}</span> [${esc(e.kind)}] ${esc(e.message)}`))}
  <hr><p class="muted">Exported from Ghost Intel 98 · ${esc(c.id)}</p>
</body></html>`;
}
