/** The Jukebox equalizer panel — ten vertical band sliders + preset select + on/off. Presentational:
 *  it owns no persistence; the parent maps onChange to settings.media.eq and the live audio graph. */
import { EQ_BANDS, EQ_GAIN_MIN, EQ_GAIN_MAX, EQ_PRESETS, presetGains } from './eq';

export interface EqState { enabled: boolean; gains: number[]; preset: string }

export function EqPanel({ eq, onChange }: { eq: EqState; onChange: (next: EqState) => void }): JSX.Element {
  function setBand(i: number, v: number): void {
    const gains = eq.gains.slice(); gains[i] = v;
    onChange({ ...eq, gains, preset: 'Custom' });
  }
  return (
    <div className="ga98-eq-panel">
      <div className="ga98-eq-head">
        <label><input type="checkbox" aria-label="EQ on" checked={eq.enabled}
          onChange={() => onChange({ ...eq, enabled: !eq.enabled })} /> EQ</label>
        <select className="ga98-select" aria-label="EQ preset" value={eq.preset}
          onChange={(e) => onChange({ ...eq, preset: e.target.value, gains: presetGains(e.target.value) })}>
          {eq.preset === 'Custom' && <option value="Custom">Custom</option>}
          {Object.keys(EQ_PRESETS).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="ga98-eq-bands">
        {EQ_BANDS.map((hz, i) => (
          <div className="ga98-eq-band" key={hz}>
            <input type="range" min={EQ_GAIN_MIN} max={EQ_GAIN_MAX} step={1}
              // vertical slider; orient in CSS (writing-mode / appearance)
              aria-label={`${hz} Hz`} value={eq.gains[i] ?? 0}
              onChange={(e) => setBand(i, Number(e.target.value))} disabled={!eq.enabled} />
            <span className="ga98-eq-label">{hz >= 1000 ? `${hz / 1000}k` : hz}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
