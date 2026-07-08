/** Optional signature capture: draw on a small canvas OR upload an image. Emits a PNG data URL; the
 *  parent persists it as an encrypted asset via putAsset. */
import { useRef, useState } from 'react';

export function SignaturePad({ onCapture }: { onCapture: (dataUrl: string, mime: 'image/png' | 'image/jpeg') => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  function pos(e: React.PointerEvent): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent): void { drawing.current = true; const p = pos(e); const c = canvasRef.current!.getContext('2d')!; c.beginPath(); c.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent): void { if (!drawing.current) return; const p = pos(e); const c = canvasRef.current!.getContext('2d')!; c.lineTo(p.x, p.y); c.stroke(); setDirty(true); }
  function end(): void {
    if (!drawing.current) return; drawing.current = false;
    if (dirty) onCapture(canvasRef.current!.toDataURL('image/png'), 'image/png');
  }
  function clear(): void {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d'); // jsdom (no `canvas` package) yields a null context in tests — guard it
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  }
  function upload(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.type !== 'image/png' && f.type !== 'image/jpeg') return; // accept only the two image kinds
    const mime = f.type; // emit the real mime, not a hardcoded png
    const rd = new FileReader();
    rd.onload = () => onCapture(String(rd.result), mime);
    rd.readAsDataURL(f);
  }
  return (
    <div className="ga98-signature-pad">
      <canvas ref={canvasRef} width={280} height={80} className="ga98-sig-canvas"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div className="field-row" style={{ gap: 6 }}>
        <button onClick={clear}>Clear</button>
        <label>Upload signature<input type="file" accept="image/png,image/jpeg" aria-label="Upload signature" onChange={upload} style={{ display: 'none' }} /></label>
      </div>
    </div>
  );
}
