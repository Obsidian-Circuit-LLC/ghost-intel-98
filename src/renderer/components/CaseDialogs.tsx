import { useState } from 'react';

/**
 * Shared Win98 modal dialogs for the scraping-case sidebars (GhostScrape / X Collector / SOCMINT).
 *
 * These replace `window.prompt`, which Electron's renderer does NOT implement — it returns `null`
 * without ever showing an input, so every prompt-based Add-Case / Import-to-case flow was a silent
 * no-op (the button flashed and nothing happened). Mirrors the same fix eyespy/WallSetupDialog.tsx
 * already applied for its own name entry.
 */

const OVERLAY: React.CSSProperties = {
  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
};

/** Single-line text entry (e.g. a new case name). Enter submits a non-empty value; Escape cancels. */
export function PromptDialog({ title, label, placeholder, initial, submitLabel = 'Create', onSubmit, onClose }: {
  title: string;
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial ?? '');
  const trimmed = value.trim();
  const submit = (): void => { if (trimmed) onSubmit(trimmed); };
  return (
    <div style={OVERLAY} role="dialog" aria-label={title}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 300 }}>
        <legend>{title}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 4, alignItems: 'center' }}>
          <label htmlFor="case-dialog-input">{label}:</label>
          <input
            id="case-dialog-input"
            className="ga98-text"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onClose(); }}
          />
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={submit} disabled={!trimmed}>{submitLabel}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}

/** Pick one option from a list (e.g. which investigation case to import into). */
export function ChoiceDialog({ title, label, options, submitLabel = 'Import', onSubmit, onClose }: {
  title: string;
  label: string;
  options: { id: string; label: string }[];
  submitLabel?: string;
  onSubmit: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [selected, setSelected] = useState(options[0]?.id ?? '');
  const submit = (): void => { if (selected) onSubmit(selected); };
  return (
    <div style={OVERLAY} role="dialog" aria-label={title}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 320 }}>
        <legend>{title}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 4, alignItems: 'center' }}>
          <label htmlFor="case-dialog-select">{label}:</label>
          <select
            id="case-dialog-select"
            className="ga98-text"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={submit} disabled={!selected}>{submitLabel}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}
