/** Best-effort stream reachability for the drawer's Test button. Goes through the SAME egress gate as
 *  playback (resolveSource): when streaming is off it returns 'off' and never touches the network. */
import Hls from 'hls.js';
import { resolveSource, isHlsUrl } from './resolveSource';

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject('timeout'), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function testStation(url: string, streamingEnabled: boolean): Promise<'ok' | 'off' | 'fail'> {
  const resolved = resolveSource({ url }, streamingEnabled);
  if (!resolved) return 'off';
  try {
    if (isHlsUrl(url) && Hls.isSupported()) {
      await withTimeout(new Promise<void>((res, rej) => {
        const hls = new Hls();
        hls.on(Hls.Events.MANIFEST_PARSED, () => { hls.destroy(); res(); });
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) { hls.destroy(); rej('fail'); } });
        hls.loadSource(url);
      }), 8000);
    } else {
      await withTimeout(new Promise<void>((res, rej) => {
        const a = new Audio(); a.src = resolved.src;
        a.addEventListener('loadedmetadata', () => res(), { once: true });
        a.addEventListener('error', () => rej('fail'), { once: true });
      }), 8000);
    }
    return 'ok';
  } catch { return 'fail'; }
}
