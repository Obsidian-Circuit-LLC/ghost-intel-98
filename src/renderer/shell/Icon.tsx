/**
 * Pixel-style desktop icon. Single click selects, double click activates.
 */

import type { MouseEvent, ReactNode } from 'react';
import { getModule } from '../state/registry';

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

/**
 * Magnifier icon for the Searchlight module — simple pixel-style magnifying glass, ~16×16 viewport.
 */
export function SearchlightGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {/* lens ring */}
      <circle cx="6" cy="6" r="4" fill="none" stroke="#d8d1ba" strokeWidth="1.5" />
      {/* lens interior */}
      <circle cx="6" cy="6" r="2.5" fill="#0f7f96" opacity="0.7" />
      {/* highlight */}
      <circle cx="5" cy="5" r="0.8" fill="#bdeef9" opacity="0.8" />
      {/* handle */}
      <line x1="9.2" y1="9.2" x2="13.5" y2="13.5" stroke="#d8d1ba" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

/**
 * Hand-drawn "Mind's Eye" glyph for the memory graph module — a stylised open eye (lids + iris)
 * over a faint node/edge motif, so it reads as "the mind, visualized" rather than a literal eye.
 */
export function MindsEyeGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {/* faint graph nodes behind the lids, evoking the memory graph */}
      <circle cx="2.5" cy="3" r="0.8" fill="#8aa0a8" opacity="0.6" />
      <circle cx="13.5" cy="12.5" r="0.8" fill="#8aa0a8" opacity="0.6" />
      <line x1="2.5" y1="3" x2="6" y2="6" stroke="#8aa0a8" strokeWidth="0.6" opacity="0.6" />
      {/* eye outline (almond lids) */}
      <path d="M1 8 Q8 2 15 8 Q8 14 1 8 Z" fill="none" stroke="#d8d1ba" strokeWidth="1.3" />
      {/* iris + pupil */}
      <circle cx="8" cy="8" r="3" fill="#0f7f96" opacity="0.85" />
      <circle cx="8" cy="8" r="1.4" fill="#000" />
      <circle cx="7.2" cy="7.1" r="0.6" fill="#bdeef9" opacity="0.9" />
    </svg>
  );
}

/**
 * Windows-98 "My Documents" icon — an open manila folder with a white ruled document sheet
 * standing up out of it, hand-drawn as crisp-edged pixels to match the other period glyphs.
 */
export function MyDocumentsGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* white document sheet rising out of the folder */}
      <rect x="11" y="4" width="13" height="15" fill="#fdfdfd" stroke="#000" />
      <rect x="13" y="7" width="9" height="1" fill="#2b6cb0" />
      <rect x="13" y="10" width="9" height="1" fill="#8aa0a8" />
      <rect x="13" y="13" width="9" height="1" fill="#8aa0a8" />
      <rect x="13" y="16" width="6" height="1" fill="#8aa0a8" />
      {/* folder back */}
      <rect x="4" y="12" width="24" height="15" fill="#e8c766" stroke="#000" />
      {/* folder tab */}
      <rect x="4" y="9" width="9" height="4" fill="#e8c766" stroke="#000" />
      {/* folder front flap (lighter, overlapping the sheet's base) */}
      <rect x="4" y="17" width="24" height="10" fill="#f2d98a" stroke="#000" />
    </svg>
  );
}

/** Custom hand-drawn SVG glyph for modules that have one (falls through to the emoji otherwise). */
export function glyphNodeFor(m: string): ReactNode | undefined {
  if (m === 'cases') return <MyComputerGlyph />;
  if (m === 'notepad') return <NotepadGlyph />;
  if (m === 'searchlight') return <SearchlightGlyph />;
  if (m === 'minds-eye') return <MindsEyeGlyph />;
  if (m === 'my-documents') return <MyDocumentsGlyph />;
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

export function glyphFor(m: string): string {
  return getModule(m)?.glyph ?? '▢';
}
