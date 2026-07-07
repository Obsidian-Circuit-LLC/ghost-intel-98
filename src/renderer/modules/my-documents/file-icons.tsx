/**
 * Per-file-type Win98 pixel-SVG icons for the My Documents grid, replacing the generic
 * 📁/📄 emoji glyphs. House style matches `src/renderer/shell/Icon.tsx`: small `viewBox`,
 * `shapeRendering="crispEdges"`, hand-drawn rects rather than smooth vector paths.
 */

import type { DocEntry } from '../../../shared/documents-types';

export type FileIconKind =
  | 'text' | 'document' | 'spreadsheet' | 'data' | 'image'
  | 'audio' | 'video' | 'archive' | 'code' | 'generic';

const EXT: Record<string, FileIconKind> = {
  txt: 'text', md: 'text', log: 'text', rtf: 'text',
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document',
  csv: 'spreadsheet', xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet',
  json: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
  webp: 'image', svg: 'image', tif: 'image', tiff: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  mp4: 'video', mpeg: 'video', mpg: 'video', mov: 'video', avi: 'video',
  mkv: 'video', webm: 'video', m4v: 'video',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
  js: 'code', ts: 'code', tsx: 'code', py: 'code', html: 'code', css: 'code',
  sh: 'code', rs: 'code', c: 'code', cpp: 'code',
};

/** Deterministic extension → icon-kind map. Dotfiles (`.gitignore`) and extension-less names are 'generic'. */
export function fileIconKind(name: string): FileIconKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'generic'; // no dot, or leading-dot dotfile
  return EXT[name.slice(dot + 1).toLowerCase()] ?? 'generic';
}

const KIND_ACCENT: Record<FileIconKind, string> = {
  text: '#3b6ea5',
  document: '#b23b3b',
  spreadsheet: '#2e8b57',
  data: '#8a6d3b',
  image: '#7a3ba5',
  audio: '#c07a1f',
  video: '#31708f',
  archive: '#6b6b6b',
  code: '#2f4f4f',
  generic: '#5a5a5a',
};

/** Short type-mark text drawn on the folded corner of the page silhouette. */
const KIND_MARK: Record<FileIconKind, string> = {
  text: 'TXT',
  document: 'DOC',
  spreadsheet: 'XLS',
  data: '{ }',
  image: 'IMG',
  audio: '♪',
  video: '▶',
  archive: 'ZIP',
  code: '</>',
  generic: '?',
};

/**
 * Win98-style folder glyph — matches the shell's existing folder look (manila body,
 * darker tab, top highlight), hand-drawn as crisp-edged pixels.
 */
export function FolderGlyph(): JSX.Element {
  return (
    <svg width="40" height="40" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* tab */}
      <rect x="4" y="7" width="11" height="4" fill="#f0c467" stroke="#000" />
      {/* body */}
      <rect x="4" y="10" width="24" height="16" fill="#f6d67e" stroke="#000" />
      {/* top highlight */}
      <rect x="5" y="11" width="22" height="2" fill="#fbe6ac" />
      {/* lower shading */}
      <rect x="4" y="22" width="24" height="4" fill="#d9a83f" />
    </svg>
  );
}

/**
 * Document-page silhouette (white page, folded corner, ruled lines) with a per-kind
 * accent color on the corner-fold and a short type mark, ~40px footprint.
 */
export function FileGlyph({ kind }: { kind: FileIconKind }): JSX.Element {
  const accent = KIND_ACCENT[kind];
  const mark = KIND_MARK[kind];
  return (
    <svg width="40" height="40" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* page body */}
      <rect x="7" y="3" width="18" height="26" fill="#fdfdfd" stroke="#000" />
      {/* ruled lines */}
      <rect x="10" y="16" width="12" height="1" fill="#c7c7c7" />
      <rect x="10" y="19" width="12" height="1" fill="#c7c7c7" />
      <rect x="10" y="22" width="9" height="1" fill="#c7c7c7" />
      {/* folded corner, accent-colored */}
      <path d="M19 3 L25 3 L25 9 Z" fill={accent} stroke="#000" />
      {/* accent header band carrying the type mark */}
      <rect x="7" y="10" width="18" height="4" fill={accent} />
      <text
        x="16"
        y="13"
        textAnchor="middle"
        fontSize="3.4"
        fontFamily="monospace"
        fill="#fff"
        style={{ fontWeight: 700 }}
      >
        {mark}
      </text>
    </svg>
  );
}

/** Resolve the glyph node for a documents-grid entry (folder or per-kind file). */
export function fileGlyphNode(entry: DocEntry): JSX.Element {
  if (entry.kind === 'folder') return <FolderGlyph />;
  return <FileGlyph kind={fileIconKind(entry.name)} />;
}
