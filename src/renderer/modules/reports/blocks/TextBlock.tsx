/** TextBlock — one rich-text block in a report's body. A `contentEditable` div bound to the
 *  block's stored `html`, with a small `[B][I][U][Size ▾]` toolbar. Every edit (`input`/`blur`)
 *  runs the live DOM through `sanitizeReportHtml` before handing it to `onChange` — the block's
 *  `html` the caller receives (and ultimately persists) is therefore ALWAYS the sanitized output,
 *  never the raw contentEditable DOM. This is the renderer half of the security spine: `main` has
 *  no DOM/DOMPurify, so nothing downstream (report-html.ts, docx.ts) may treat unsanitized html as
 *  safe — this component is where the guarantee is established. */
import { useRef } from 'react';
import type { ReportBlock } from '@shared/reports-types';
import { sanitizeReportHtml, FONT_SIZES } from '../rich-text';

export interface TextBlockProps {
  block: Extract<ReportBlock, { kind: 'text' }>;
  onChange: (html: string) => void;
}

export function TextBlock(props: TextBlockProps): JSX.Element {
  const { block, onChange } = props;
  const ref = useRef<HTMLDivElement | null>(null);

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
      />
    </div>
  );
}
