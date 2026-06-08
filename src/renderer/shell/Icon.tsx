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

/**
 * Windows-98-style spiral Notepad icon (teal header band over a white ruled page, dark spiral
 * binding across the top, a shadow page peeking behind), hand-drawn as crisp-edged pixels to match
 * MyComputerGlyph and read as a period icon rather than a smooth vector.
 */
export function NotepadGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* shadow page peeking behind, lower-right, for depth */}
      <rect x="9" y="9" width="17" height="20" fill="#9a9a9a" stroke="#000" />
      {/* main page */}
      <rect x="6" y="6" width="17" height="20" fill="#fdfdfd" stroke="#000" />
      {/* teal cover/header band + its lower edge */}
      <rect x="7" y="7" width="15" height="5" fill="#1ba7b8" />
      <rect x="7" y="11" width="15" height="1" fill="#0d7d8c" />
      {/* ruled lines */}
      <rect x="9" y="15" width="11" height="1" fill="#8aa0a8" />
      <rect x="9" y="18" width="11" height="1" fill="#8aa0a8" />
      <rect x="9" y="21" width="9" height="1" fill="#8aa0a8" />
      {/* spiral binding crossing the top edge */}
      <g fill="#2a2a2a">
        <rect x="8" y="4" width="2" height="5" />
        <rect x="12" y="4" width="2" height="5" />
        <rect x="16" y="4" width="2" height="5" />
        <rect x="20" y="4" width="2" height="5" />
      </g>
      <g fill="#cfcfcf">
        <rect x="8" y="4" width="2" height="1" />
        <rect x="12" y="4" width="2" height="1" />
        <rect x="16" y="4" width="2" height="1" />
        <rect x="20" y="4" width="2" height="1" />
      </g>
    </svg>
  );
}

/** Custom hand-drawn SVG glyph for modules that have one (falls through to the emoji otherwise). */
export function glyphNodeFor(m: ModuleKey): ReactNode | undefined {
  if (m === 'cases') return <MyComputerGlyph />;
  if (m === 'notepad') return <NotepadGlyph />;
  return undefined;
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
  minesweeper: '💣',
  chess: '♟',
  chat: '💬',
  help: '?'
};

export function glyphFor(m: ModuleKey): string {
  return GLYPHS[m] ?? '■';
}
