/**
 * Pixel-style desktop icon. Single click selects, double click activates.
 */

import type { MouseEvent } from 'react';
import type { ModuleKey } from '../state/store';

interface IconProps {
  label: string;
  glyph: string;
  selected: boolean;
  onSelect(): void;
  onActivate(): void;
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
      <div className="ga98-icon-glyph">{props.glyph}</div>
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
  help: '?'
};

export function glyphFor(m: ModuleKey): string {
  return GLYPHS[m] ?? '■';
}
