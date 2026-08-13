/**
 * Campaign editor modal (Task J1) — CREATE / EDIT a campaign with NAME, PURPOSE, DESCRIPTION.
 *
 * Enterprise's campaign editor collected all three fields; GI98's campaign is a generic ScrapingCase
 * (name only), so PURPOSE + DESCRIPTION persist to the per-campaign editor-meta sidecar (main-side
 * `campaign-meta.ts`) — the modal only collects + returns the draft, exactly like geoint's
 * AddStreamDialog. Reuses the shared `.ga98-dialog-veil` / `.window` chrome (theme-aware, both
 * classic + QUIET AMETHYST). Token-only styling; the primary button is disabled until a non-empty
 * NAME is entered (the one required field — parity with the main-side "Campaign name is required").
 */
import { useState } from 'react';

export interface CampaignEditorValue {
  name: string;
  purpose: string;
  description: string;
}

export function CampaignEditorDialog({
  mode,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial: CampaignEditorValue;
  busy: boolean;
  onSubmit: (value: CampaignEditorValue) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(initial.name);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [description, setDescription] = useState(initial.description);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;
  function submit(): void {
    if (!canSubmit) return;
    onSubmit({ name: trimmedName, purpose: purpose.trim(), description: description.trim() });
  }

  const title = mode === 'create' ? 'New campaign' : 'Edit campaign';
  const primaryLabel = mode === 'create' ? 'CREATE + ACTIVATE' : 'SAVE CAMPAIGN';

  return (
    <div className="ga98-dialog-veil xls-campaign-editor-veil" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="window ga98-dialog-window xls-campaign-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
        </div>
        <div className="window-body xls-campaign-editor-body">
          <label className="xls-field">
            <span className="xls-field-label">NAME</span>
            <input
              className="ga98-text xls-input"
              aria-label="Campaign name"
              value={name}
              placeholder="Operation name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              autoFocus
            />
          </label>
          <label className="xls-field">
            <span className="xls-field-label">PURPOSE</span>
            <input
              className="ga98-text xls-input"
              aria-label="Campaign purpose"
              value={purpose}
              placeholder="One-line objective"
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <label className="xls-field">
            <span className="xls-field-label">DESCRIPTION</span>
            <textarea
              className="ga98-text xls-input xls-textarea"
              aria-label="Campaign description"
              value={description}
              placeholder="Scope, targets, notes"
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="xls-campaign-editor-actions">
            <button type="button" className="xls-btn" onClick={onCancel} disabled={busy}>
              CANCEL
            </button>
            <button
              type="button"
              className="xls-btn xls-btn-primary"
              onClick={submit}
              disabled={!canSubmit}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
