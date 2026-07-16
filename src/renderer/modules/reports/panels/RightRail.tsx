/** RightRail — the report editor's right-hand panel stack. Purely presentational: it renders three
 *  stacked panels from props and reports interactions back up, holding no state of its own.
 *
 *  - Descriptor Preview: a quick reference of the descriptor library (name + one-line body preview).
 *  - Document Outline: the heading entries from `extractOutline`; clicking one calls `onOutlineJump`
 *    with the owning block id (the editor scrolls that block into view).
 *  - Image Properties: shown only when an image block is selected — width %, caption, and alignment
 *    drive `onImagePatch`, the same patch channel the in-page ImageBlock uses. */
import type { Descriptor, ReportBlock } from '@shared/reports-types';

type ImageData = Extract<ReportBlock, { kind: 'image' }>;

export interface RightRailProps {
  descriptors: Descriptor[];
  outline: { id: string; text: string }[];
  /** The currently-selected image block, or null when no image is selected. */
  selectedImage: ImageData | null;
  /** Jump the page to the block that owns an outline entry. */
  onOutlineJump: (id: string) => void;
  /** Patch the selected image block from the properties panel. */
  onImagePatch: (patch: Partial<Pick<ImageData, 'widthPct' | 'caption' | 'align'>>) => void;
}

export function RightRail(props: RightRailProps): JSX.Element {
  const { descriptors, outline, selectedImage, onOutlineJump, onImagePatch } = props;

  return (
    <div className="ga98-report-rightrail">
      <section>
        <div className="ga98-report-panel-title">Descriptor Preview</div>
        {descriptors.length === 0 ? (
          <div className="ga98-report-descriptorlib-empty">No descriptors saved.</div>
        ) : (
          descriptors.map((d) => (
            <div key={d.id} className="ga98-report-descriptor-item">
              <div className="ga98-report-descriptor-name">{d.name || 'Untitled'}</div>
              <div className="ga98-report-descriptor-preview">{d.body}</div>
            </div>
          ))
        )}
      </section>

      <section>
        <div className="ga98-report-panel-title">Document Outline</div>
        {outline.length === 0 ? (
          <div className="ga98-report-descriptorlib-empty">No headings yet.</div>
        ) : (
          outline.map((o, i) => (
            <button
              key={`${o.id}-${i}`}
              type="button"
              className="ga98-report-outline-item"
              onClick={() => onOutlineJump(o.id)}
            >
              {o.text}
            </button>
          ))
        )}
      </section>

      {selectedImage ? (
        <section>
          <div className="ga98-report-panel-title">Image Properties</div>
          <label>
            <span>Width %</span>
            <input
              aria-label="Image width percent"
              type="number"
              min={10}
              max={100}
              value={selectedImage.widthPct}
              onChange={(e) => onImagePatch({ widthPct: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>Caption</span>
            <input
              aria-label="Image caption"
              value={selectedImage.caption}
              onChange={(e) => onImagePatch({ caption: e.target.value })}
            />
          </label>
          <label>
            <span>Align</span>
            <select
              aria-label="Image align"
              value={selectedImage.align ?? 'left'}
              onChange={(e) => onImagePatch({ align: e.target.value as 'left' | 'center' | 'right' })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </section>
      ) : null}
    </div>
  );
}
