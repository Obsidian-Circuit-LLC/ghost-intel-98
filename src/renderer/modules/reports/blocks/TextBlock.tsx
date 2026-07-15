/** TextBlock — one rich-text block in a report's body. A `contentEditable` div bound to the
 *  block's stored `html`, with a small `[B][I][U][Size ▾]` toolbar. Every edit (`input`/`blur`)
 *  runs the live DOM through `sanitizeReportHtml` before handing it to `onChange` — the block's
 *  `html` the caller receives (and ultimately persists) is therefore ALWAYS the sanitized output,
 *  never the raw contentEditable DOM. This is the renderer half of the security spine: `main` has
 *  no DOM/DOMPurify, so nothing downstream (report-html.ts, docx.ts) may treat unsanitized html as
 *  safe — this component is where the guarantee is established.
 *
 *  Task 7 adds the descriptor right-click menu: `onContextMenu` opens a small popover listing every
 *  descriptor (name + a short body preview) with two insert actions. Insertion splices the
 *  `descriptorInsertHtml` output (already HTML-escaped — a descriptor is plain-text data, never
 *  trusted markup) into the caret position via the Range/Selection API, then runs the usual
 *  `commit()` — so an inserted descriptor is re-sanitized exactly like any other edit. The plan text
 *  suggested `document.execCommand('insertHTML', ...)`; this repo's Electron/Chromium target does
 *  support it, but PRE-FLIGHT trust-the-repo applies here too: a Range-based insert (the same API
 *  `applySize` below already relies on) is used instead so the insert path is deterministically
 *  testable in jsdom, which has no `execCommand` implementation at all. */
import { useEffect, useRef, useState } from 'react';
import type { ReportBlock, Descriptor } from '@shared/reports-types';
import { sanitizeReportHtml, descriptorInsertHtml, FONT_SIZES } from '../rich-text';

export interface TextBlockProps {
  block: Extract<ReportBlock, { kind: 'text' }>;
  onChange: (html: string) => void;
  /** The report's descriptor library, for the right-click insert menu. Optional so existing
   *  callers/tests that don't care about descriptors keep working unchanged. */
  descriptors?: Descriptor[];
}

export function TextBlock(props: TextBlockProps): JSX.Element {
  const { block, onChange, descriptors = [] } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  // The selection at the moment the context menu opened, cloned so it survives the ensuing blur
  // when the operator clicks a menu button (blur can collapse/clear the live selection).
  const savedRange = useRef<Range | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  /** Sanitize the live DOM and hand the result up. Called on every input + on blur, so the stored
   *  html is never a moment behind an unsanitized edit. */
  function commit(): void {
    const el = ref.current;
    if (!el) return;
    onChange(sanitizeReportHtml(el.innerHTML));
  }

  function format(cmd: 'bold' | 'italic' | 'underline'): void {
    ref.current?.focus();
    // execCommand is deprecated but still the pragmatic way to toggle inline bold/italic/underline
    // on a contentEditable selection; guarded because some test/headless DOM environments don't
    // implement it at all.
    try { document.execCommand(cmd); } catch { /* unsupported in this environment; no-op */ }
    commit();
  }

  /** Wrap the current selection in a `<span style="font-size:${pt}pt">` (heading additionally
   *  wraps in `<b>` — sanitizeReportHtml strips any `font-weight` style prop, so bold must be a
   *  real `<b>` element, not a style declaration). No-ops on a collapsed/empty selection. */
  function applySize(pt: number, bold?: boolean): void {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const span = document.createElement('span');
    span.style.fontSize = `${pt}pt`;
    span.appendChild(range.extractContents());
    const wrapper: HTMLElement = bold ? document.createElement('b') : span;
    if (bold) wrapper.appendChild(span);
    range.insertNode(wrapper);

    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(wrapper);
    sel.addRange(after);

    commit();
  }

  /** Right-click: capture the caret/selection (so a later blur can't lose it) and open the
   *  descriptor popover at the pointer position. */
  function openDescriptorMenu(e: React.MouseEvent): void {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      savedRange.current = el.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
    } else {
      savedRange.current = null;
    }
    setMenu({ x: e.clientX, y: e.clientY });
  }

  /** Splice a descriptor's insert HTML into the block at the saved caret (falling back to the end
   *  of the block if there wasn't one), then close the menu and re-sanitize via `commit()`. Uses
   *  the Range/Selection API (not `execCommand`) — see the file header for why. */
  function insertDescriptor(d: Descriptor, mode: 'text' | 'title'): void {
    const el = ref.current;
    if (!el) return;
    el.focus();

    const tpl = document.createElement('template');
    tpl.innerHTML = descriptorInsertHtml(d, mode);
    const frag = tpl.content.cloneNode(true) as DocumentFragment;
    const lastNode = frag.lastChild;

    let range = savedRange.current;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(frag);

    if (lastNode) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
    }

    savedRange.current = null;
    setMenu(null);
    commit();
  }

  // Close the descriptor popover on any outside mousedown — mirrors the whiteboard colour-popover
  // fix (a position:fixed backdrop can't be relied on the same way here either: the report body can
  // scroll/transform independently of the viewport).
  useEffect(() => {
    if (!menu) return;
    function onDocDown(e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest('.ga98-report-descmenu')) setMenu(null);
    }
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [menu]);

  return (
    <div className="ga98-report-textblock">
      <div className="ga98-report-textblock-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => format('bold')}><b>B</b></button>
        <button type="button" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => format('italic')}><i>I</i></button>
        <button type="button" aria-label="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
        <select
          aria-label="Font size"
          defaultValue=""
          onChange={(e) => {
            const key = e.target.value;
            const preset = FONT_SIZES.find((f) => f.key === key);
            e.target.value = '';
            if (preset) applySize(preset.pt, preset.bold);
          }}
        >
          <option value="" disabled>Size</option>
          {FONT_SIZES.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
      </div>
      <div
        ref={ref}
        className="ga98-report-textblock-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Report text block"
        // Uncontrolled by design: re-rendering from `block.html` on every keystroke would fight the
        // browser's own caret/selection state. The DOM is the source of truth between commits;
        // `onChange` (via `commit`) is how it re-joins React state.
        dangerouslySetInnerHTML={{ __html: block.html }}
        onInput={commit}
        onBlur={commit}
        onContextMenu={openDescriptorMenu}
      />
      {menu ? (
        <div
          className="ga98-report-descmenu"
          role="menu"
          aria-label="Insert descriptor"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
        >
          {descriptors.length === 0 ? (
            <div className="ga98-report-descmenu-empty">No descriptors yet.</div>
          ) : descriptors.map((d) => (
            <div key={d.id} className="ga98-report-descmenu-item" role="none">
              <div className="ga98-report-descmenu-name">{d.name}</div>
              <div className="ga98-report-descmenu-preview">{d.body.slice(0, 120)}</div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertDescriptor(d, 'text')}
              >
                Insert text
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertDescriptor(d, 'title')}
              >
                Insert with title
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
