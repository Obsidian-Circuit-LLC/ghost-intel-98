/**
 * Pure, unit-tested visual helpers for whiteboard nodes. Kept free of React/DOM so the
 * colour/size/label logic can be tested in isolation and shared by WhiteboardModule.
 *
 * `resolveNodeColor` maps a node's stored `color` (a preset key OR a CSS hex, ≤16 chars per the
 * validator) to concrete body/head fills. Only a regex-gated hex is ever passed through into CSS.
 */

/** Tile colour palette. node.color stores the key (or a custom hex). 'default' is the grey/white. */
export const NODE_COLORS: { key: string; body: string; head: string }[] = [
  { key: 'default', body: '#ffffff', head: '#607d8b' },
  { key: 'yellow', body: '#fff9c4', head: '#f9a825' },
  { key: 'green', body: '#e8f5e9', head: '#43a047' },
  { key: 'blue', body: '#e3f2fd', head: '#1e88e5' },
  { key: 'pink', body: '#fce4ec', head: '#d81b60' },
  { key: 'orange', body: '#ffe0b2', head: '#fb8c00' },
  { key: 'grey', body: '#cfd8dc', head: '#455a64' }
];

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Resolve a node's stored colour to body/head fills. Preset key → its pair; a valid hex → white
 *  body + hex head; anything else → the default preset (never emits an unsanitised string). */
export function resolveNodeColor(color?: string): { body: string; head: string } {
  const preset = NODE_COLORS.find((c) => c.key === color);
  if (preset) return { body: preset.body, head: preset.head };
  if (color && HEX.test(color)) return { body: '#ffffff', head: color };
  return { body: NODE_COLORS[0].body, head: NODE_COLORS[0].head };
}

/** Clamp a node size to the interactive minimum (the validator also clamps the persisted max). */
export function clampNodeSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(120, w), h: Math.max(64, h) };
}

/** Header label: the user-given name when non-blank, else the node type. */
export function headerLabel(node: { name?: string; type: string }): string {
  return node.name && node.name.trim() !== '' ? node.name : node.type;
}
