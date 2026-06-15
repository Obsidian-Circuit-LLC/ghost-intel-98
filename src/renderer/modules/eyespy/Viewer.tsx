import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';

export function Viewer({ stream, poster = false, refreshNonce = 0 }: { stream: CameraStream; poster?: boolean; refreshNonce?: number }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgTick, setImgTick] = useState(0);

  useEffect(() => {
    if (poster || stream.kind !== 'http') return;
    const t = setInterval(() => setImgTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [poster, stream.kind]);

  useEffect(() => {
    if (poster || stream.kind !== 'hls') return;
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(stream.url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = stream.url;
    return () => { video.src = ''; video.load(); };
  }, [poster, stream.kind, stream.url]);

  if (poster) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#9ad', fontSize: 11 }}>
        ▶ {stream.label}
      </div>
    );
  }

  if (stream.kind === 'rtsp') {
    return (
      <div style={{ color: '#fff', padding: 16, fontSize: 12 }}>
        RTSP streams cannot be played directly in the browser. Run a local
        <code style={{ margin: '0 4px' }}>ffmpeg → HLS</code>
        bridge on your network and add the resulting <code>.m3u8</code> URL as an HLS stream.
        <br /><br />
        Example:
        <pre style={{ background: '#222', padding: 8, marginTop: 8 }}>
{`ffmpeg -rtsp_transport tcp -i ${stream.url} \\
  -c:v copy -f hls -hls_time 2 -hls_list_size 3 \\
  /var/www/cam.m3u8`}
        </pre>
      </div>
    );
  }

  if (stream.kind === 'mjpeg') {
    const sep = stream.url.includes('?') ? '&' : '?';
    return <img alt={stream.label} src={`${stream.url}${sep}_t=${refreshNonce}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  if (stream.kind === 'http') {
    const sep = stream.url.includes('?') ? '&' : '?';
    return <img alt={stream.label} src={`${stream.url}${sep}_t=${imgTick}_${refreshNonce}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  if (stream.kind === 'mp4') {
    // Direct progressive/streamed MP4 over http(s). CSP media-src allows http(s); a
    // local file:// path would not load (not in media-src) — point users to a URL.
    return <video controls autoPlay muted loop src={stream.url} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  }

  if (stream.kind === 'webpage') {
    // The URL is the camera's HTML viewer page (e.g. an .shtml MJPEG viewer), not a media
    // URL — it would render blank as <video>/<img>. We do NOT embed third-party HTML/JS in
    // the app renderer (an in-app iframe would require broadening the renderer-GLOBAL CSP
    // frame-src to http:/https:, which would also expose every dcs98-plugin: plugin sharing
    // this renderer to phishing/clickjacking/exfil). Instead we open the page in the bundled
    // Firefox via the browser launcher — process-isolated from the app, the same pattern
    // GeoIntModule/BookmarksModule use for external links. The main-process launchFirefox
    // path validates http(s) and spawns with shell:false.
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#111', color: '#9ad', fontSize: 12, padding: 16, textAlign: 'center' }}>
        <div>This is a camera viewer page, not a direct stream. It opens in the secure bundled browser, isolated from the app.</div>
        <button
          onClick={() => void window.api.browser.launchFirefox(stream.url, stream.label).catch((e) => toast.error((e as Error).message))}
          style={{ fontSize: 12, padding: '4px 12px' }}
        >
          ⇱ Open in Firefox
        </button>
        <div style={{ fontSize: 10, color: '#667', wordBreak: 'break-all', maxWidth: '90%' }}>{stream.url}</div>
      </div>
    );
  }

  return <video ref={videoRef} controls autoPlay muted style={{ maxWidth: '100%', maxHeight: '100%' }} />;
}
