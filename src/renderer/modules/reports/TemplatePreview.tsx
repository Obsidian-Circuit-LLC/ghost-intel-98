/** TemplatePreview — the Reports shell's right-rail preview of a saved template, styled as a Win98
 *  MDI panel (blue title bar + sunken body). The body is a `sandbox=""` `srcdoc` iframe fed the
 *  main-side `buildReportHtml` output (`previewTemplate` IPC), so the preview is byte-faithful to the
 *  exported PDF/DOCX while running NO scripts — the empty sandbox token list disables scripts, forms
 *  and same-origin, so the untrusted-per-defence-in-depth document can only paint. A "Select
 *  Template" button (→ onSelect) is the create-from-template entry point. The title-bar "×" is
 *  decorative chrome (aria-hidden span), not an operable control. */
export interface TemplatePreviewProps {
  /** The main-built `buildReportHtml` document for the selected template (already sanitized upstream). */
  html: string;
  /** The selected template's name, shown in the panel title bar. */
  templateName?: string;
  /** Create a new report from the previewed template. */
  onSelect: () => void;
}

export function TemplatePreview({ html, templateName, onSelect }: TemplatePreviewProps): JSX.Element {
  return (
    <div className="ga98-report-panel ga98-report-tpl-preview">
      <div className="ga98-report-titlebar">
        <span>Preview{templateName ? ` — ${templateName}` : ''}</span>
        <span className="ga98-report-titlebar-x" aria-hidden="true">×</span>
      </div>
      <div className="ga98-report-panel-body ga98-report-tpl-preview-body">
        {/* sandbox="" — empty token list: no scripts, no forms, no same-origin. Preview-only. */}
        <iframe
          className="ga98-report-tpl-preview-frame"
          title="Template preview"
          sandbox=""
          srcDoc={html}
        />
        <div className="ga98-report-tpl-preview-actions">
          <button type="button" className="ga98-report-nav-quick-btn" onClick={onSelect}>
            <span className="ga98-report-btn-ico" aria-hidden="true">📋</span> Select Template
          </button>
        </div>
      </div>
    </div>
  );
}
