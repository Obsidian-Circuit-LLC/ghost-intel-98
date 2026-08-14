/**
 * WebSDR Viewer — control-bar DOM-heuristic injection (Phase 3, R3).
 *
 * A verbatim behavioural port of GhostExodus's `electron/main.ts` `execControl`: it drives a
 * public WebSDR/KiwiSDR/OpenWebRX page's OWN controls by injecting a small DOM script that matches
 * the page's frequency input / mode select-or-button / volume slider by his exact id/name/class/
 * placeholder/title regexes and fires the same `input`/`change`/`blur` events, returning one of his
 * exact codes (`frequency-input` / `mode-select` / `mode-button` / `volume-slider` / `media-volume`
 * / `''`). An incompatible page returns `''` and stays fully usable via its native controls.
 *
 * Hardening (Global Constraint 5): the injection is CONFINED. `buildControlScript` is a PURE string
 * builder (no electron/node import) that JSON-encodes the payload — the untrusted renderer value is
 * serialized through `JSON.stringify`, never string-concatenated into code — and `execControl`
 * executes it ONLY through a caller-supplied `executeJavaScript`, which the manager wires to the
 * `persist:websdr` receiver view and NOTHING else. The script text is asserted against his contract
 * in `test/websdr-control.test.ts` and run against a jsdom receiver page for behavioural parity.
 */

/** The three controls his common control bar drives. */
export type WebSdrControlKind = 'frequency' | 'mode' | 'volume';

/** His `execControl` result shape ({ ok, message }). */
export interface ControlResult {
  ok: boolean;
  message: string;
}

/** The minimal `webContents` surface control injection needs — `executeJavaScript` only. Kept
 *  structural (not `import type` from electron) so it is testable with a plain fake and the manager
 *  can satisfy it with the receiver view's real webContents. */
export interface ControlWebContentsLike {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

/**
 * Build his DOM-heuristic control script for `kind`/`value`. The payload is JSON-encoded (so a
 * hostile renderer value can never break out of the string literal into executable code) and the
 * body is his `execControl` script VERBATIM in behaviour — same selectors, same regexes, same
 * event firing, same return codes.
 */
export function buildControlScript(kind: WebSdrControlKind, value: string | number): string {
  const payload = JSON.stringify({ kind, value });
  return `(()=>{const p=${payload};const all=(s)=>Array.from(document.querySelectorAll(s));const fire=(e)=>{['input','change','blur'].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})));};
  if(p.kind==='frequency'){const hz=Number(p.value),vals=[String(hz),String(hz/1000),String(hz/1000000)];const inputs=all('input').filter(e=>/freq|frequency|tune/i.test((e.id||'')+' '+(e.name||'')+' '+(e.className||'')+' '+(e.placeholder||'')+' '+(e.title||'')));if(inputs[0]){const e=inputs[0];e.focus();e.value=vals[0];fire(e);return 'frequency-input';}return '';}
  if(p.kind==='mode'){const m=String(p.value).toLowerCase();const sels=all('select').filter(e=>/mode|demod/i.test((e.id||'')+' '+(e.name||'')+' '+(e.className||'')+' '+(e.title||'')));for(const s of sels){const opt=Array.from(s.options).find(o=>(o.value+' '+o.text).toLowerCase().includes(m));if(opt){s.value=opt.value;fire(s);return 'mode-select';}}const btn=all('button,input[type=button],input[type=radio],label').find(e=>(e.textContent||e.value||'').trim().toLowerCase()===m);if(btn){btn.click();return 'mode-button';}return '';}
  if(p.kind==='volume'){const v=Math.max(0,Math.min(1,Number(p.value)));const media=all('audio,video');media.forEach(e=>e.volume=v);const inputs=all('input[type=range]').filter(e=>/vol|audio|gain/i.test((e.id||'')+' '+(e.name||'')+' '+(e.className||'')+' '+(e.title||'')));if(inputs[0]){const e=inputs[0];const min=Number(e.min||0),max=Number(e.max||100);e.value=String(min+(max-min)*v);fire(e);return 'volume-slider';}return media.length?'media-volume':'';}return '';})()`;
}

/** Map his script's return code to the {ok,message} result: a truthy code → "synchronized",
 *  an empty code → "use its native controls" (his exact messages). */
export function interpretControlReturn(returned: unknown): ControlResult {
  return returned
    ? { ok: true, message: `Control synchronized (${String(returned)}).` }
    : {
        ok: false,
        message: 'This receiver did not expose a compatible control. Use its native controls.',
      };
}

/**
 * Run the control script for `kind`/`value` through `wc.executeJavaScript` and map the result.
 * A null webContents (no receiver loaded) short-circuits to his "No receiver is loaded." message;
 * a thrown execution error surfaces its message (his catch behaviour). The `userGesture` flag is
 * passed `true` (his call) so a page that gates audio behind a user activation still responds.
 */
export async function execControl(
  wc: ControlWebContentsLike | null,
  kind: WebSdrControlKind,
  value: string | number,
): Promise<ControlResult> {
  if (!wc) return { ok: false, message: 'No receiver is loaded.' };
  try {
    const r = await wc.executeJavaScript(buildControlScript(kind, value), true);
    return interpretControlReturn(r);
  } catch (e) {
    return { ok: false, message: (e as Error)?.message || 'Control failed' };
  }
}
