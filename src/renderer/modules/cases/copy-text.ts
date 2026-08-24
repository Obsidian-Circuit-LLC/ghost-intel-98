/**
 * Plain-text renderings of a case's Web links and Entities, for the right-click Copy actions.
 *
 * Requested from the field: lifting a case's links or entities into a report meant retyping them.
 * These formatters back both the per-item copies and the whole-section copies. Local clipboard only
 * — nothing here leaves the machine.
 */
import type { WebLink } from '@shared/types';

/** An entity as the case pane resolves it (the registry record plus its case link). */
export interface CopyableEntity {
  entity: { type: string; value: string; aliases?: string[]; notes?: string };
}

/** `Title — url`, or the bare url when the title adds nothing (absent, blank, or the url again). */
export function formatLink(link: Pick<WebLink, 'url' | 'title'>): string {
  const url = String(link.url ?? '').trim();
  const title = String(link.title ?? '').trim();
  return !title || title === url ? url : `${title} — ${url}`;
}

/** Every link, one per line, in display order. Empty input yields '' — never a stray newline. */
export function formatLinks(links: readonly Pick<WebLink, 'url' | 'title'>[]): string {
  return (links ?? []).map(formatLink).filter(Boolean).join('\n');
}

/** An entity as multiple lines: type/value, then aliases and notes ONLY when present. */
export function formatEntity(item: CopyableEntity): string {
  const e = item.entity;
  const lines = [`Case entity — ${e.type}: ${e.value}`];
  const aliases = (e.aliases ?? []).filter((a) => String(a).trim());
  if (aliases.length) lines.push(`aliases: ${aliases.join(', ')}`);
  const notes = String(e.notes ?? '').trim();
  if (notes) lines.push(`notes: ${notes}`);
  return lines.join('\n');
}

/** Every entity, blank-line separated so a multi-line record stays readable when pasted. */
export function formatEntities(items: readonly CopyableEntity[]): string {
  return (items ?? []).map(formatEntity).join('\n\n');
}
