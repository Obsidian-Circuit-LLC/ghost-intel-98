/**
 * Pixel-style desktop icon. Single click selects, double click activates.
 */

import type { MouseEvent, ReactNode } from 'react';
import type { ModuleKey } from '../state/store';

interface IconProps {
  label: string;
  glyph: string;
  /** Optional custom glyph (e.g. an SVG) rendered in place of the emoji string. */
  glyphNode?: ReactNode;
  selected: boolean;
  onSelect(): void;
  onActivate(): void;
}

/**
 * Authentic Windows-95 "My Computer" icon (beige CRT monitor resting on a desktop case),
 * hand-drawn as crisp-edged pixels so it reads as a period icon rather than a smooth vector.
 */
export function MyComputerGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* desktop case the monitor sits on */}
      <rect x="3" y="20" width="26" height="8" fill="#d8d1ba" stroke="#000" />
      <rect x="5" y="22" width="10" height="1" fill="#000" />
      <rect x="5" y="24" width="10" height="1" fill="#8a8a8a" />
      <rect x="24" y="23" width="2" height="2" fill="#000" />
      <rect x="21" y="24" width="1" height="1" fill="#33d033" />
      {/* monitor bezel */}
      <rect x="6" y="3" width="20" height="16" fill="#d8d1ba" stroke="#000" />
      {/* screen */}
      <rect x="8" y="5" width="16" height="12" fill="#0f7f96" />
      <rect x="8" y="5" width="16" height="5" fill="#37a9c2" />
      <rect x="9" y="6" width="3" height="2" fill="#bdeef9" />
    </svg>
  );
}

export function Icon(props: IconProps): JSX.Element {
  function handleClick(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
    if (e.detail === 2) {
      props.onActivate();
    } else {
      props.onSelect();
    }
  }
  return (
    <div
      className="ga98-icon"
      data-selected={props.selected}
      role="button"
      tabIndex={0}
      onMouseDown={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onActivate();
      }}
    >
      <div className="ga98-icon-glyph">{props.glyphNode ?? props.glyph}</div>
      <div>{props.label}</div>
    </div>
  );
}

const GLYPHS: Record<ModuleKey, string> = {
  cases: '📁',
  notepad: '🗒',
  calendar: '📅',
  reminders: '🔔',
  alarm: '⏰',
  shred: '🗑',
  settings: '⚙',
  'net-explorer': '🌐',
  mail: '✉',
  dialterm: '📞',
  eyespy: '📷',
  'ai-assistant': '✨',
  'doc-viewer': '📄',
  search: '🔍',
  whiteboard: '🗺',
  'media-player': '🎵',
  geoint: '🌍',
  bookmarks: '🔖',
  markets: '📈',
  briefcase: '💼',
  solitaire: '🃏',
  chat: '💬',
  help: '?'
};

export function glyphFor(m: ModuleKey): string {
  return GLYPHS[m] ?? '■';
}
