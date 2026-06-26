import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { parseYouTubeId, youtubeEmbedSrc } from '@shared/youtube';
import { cctvProxyUrl, tryCctvProxyUrl, cctvRoutableKind } from '@shared/cctv/proxy';
import { toast } from '../../state/toasts';
import { useSettings } from '../../state/store';

// Media fills its container and is centred + contained: the whole frame is visible (no crop), scaled
// up to fit the tile/pane instead of sitting letterboxed in the top-left. Used for every visual kind
// so a 2-col wall tile, a 6-col tile, and the double-click expanded pane all behave the same.
const MEDIA_STYLE: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' };

/** Placeholder shown when Tor isn't bootstrapped yet. */
function TorNotReady(): JSX.Element {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#e88', fontSize: 11, textAlign: 'center', padding: 12 }}>
      TOR NOT READY — wait for Tor to bootstrap, then reopen this stream.
    </div>
  );
}

/** Placeholder shown when the camera URL is not a valid http(s) URL and cannot be proxied. */
function BadStreamUrl(): JSX.Element {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#e88', fontSize: 11, textAlign: 'center', padding: 12 }}>
      Invalid stream URL — only http(s) URLs can be proxied via Tor.
    </div>
  );
}

/** Placeholder shown when the stream kind cannot be routed through the ga98cctv:// proxy. */
function NotTorRoutable(): JSX.Element {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#e88', fontSize: 11, textAlign: 'center', padding: 12 }}>
      Not Tor-routable — disable CCTV-over-Tor to view.
    </div>
  );
}

export function Viewer({ stream, poster = false, refreshNonce = 0 }: { stream: CameraStream; poster?: boolean; refreshNonce?: number }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgTick, setImgTick] = useState(0);
  const [torReady, setTorReady] = useState<boolean | null>(null);

  const settings = useSettings((s) => s.settings);
  const cctvOverTor: boolean = settings?.geoint?.cctvOverTor ?? false;

  // Poll Tor readiness once on mount (when cctvOverTor is active and kind is routable).
  useEffect(() => {
    if (!cctvOverTor || poster || !cctvRoutableKind(stream.kind)) return;
    let cancelled = false;
    void window.api.geoint.cctvTorReady().then((ready) => {
      if (!cancelled) setTorReady(ready);
    });
    return () => { cancelled = true; };
  }, [cctvOverTor, poster, stream.kind]);

  // HTTP still-image refresh ticker (clearnet path only).
  useEffect(() => {
    if (poster || stream.kind !== 'http') return;
    // When Tor is active and ready we feed a ga98cctv: src; the ticker still drives refreshNonce
    // in the img src below, so keep it running regardless of Tor state.
    const t = setInterval(() => setImgTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [poster, stream.kind]);

  // HLS via hls.js — used for both clearnet and Tor paths.
  useEffect(() => {
    if (poster || stream.kind !== 'hls') return;
    const video = videoRef.current;
    if (!video) return;

    // Compute the source: if Tor is active and ready, proxy through ga98cctv://.
    // If torReady is null we haven't resolved yet — don't load anything yet.
    if (cctvOverTor) {
      if (torReady === null || torReady === false) return;
    }

    const src = cctvOverTor && torReady ? cctvProxyUrl(stream.url) : stream.url;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = src;
    return () => { video.src = ''; video.load(); };
  }, [poster, stream.kind, stream.url, cctvOverTor, torReady]);

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

  if (stream.kind === 'youtube') {
    // When CCTV-over-Tor is on, youtube is not routable via the proxy.
    if (cctvOverTor) return <NotTorRoutable />;

    // A user-supplied YouTube live/video URL, framed via the sandboxed www.youtube-nocookie.com embed
    // (the same operator-authorized frame-src exception the GeoINT Live News panel uses). Host-checked
    // by parseYouTubeId so a youtube-shaped path on a non-youtube host yields no embed.
    const id = parseYouTubeId(stream.url);
    if (!id) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#e88', fontSize: 11, textAlign: 'center', padding: 12 }}>
          Not a parseable YouTube URL (watch?v=…, youtu.be/…, or /live/…).
        </div>
      );
    }
    return (
      <iframe
        title={stream.label}
        src={youtubeEmbedSrc(id)}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#000' }}
      />
    );
  }

  if (stream.kind === 'webpage') {
    // When CCTV-over-Tor is on, webpage is not routable via the proxy.
    if (cctvOverTor) return <NotTorRoutable />;

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

  if (stream.kind === 'mjpeg') {
    if (cctvOverTor) {
      if (torReady === null) return <div style={{ ...MEDIA_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 11 }}>Checking Tor…</div>;
      if (!torReady) return <TorNotReady />;
      const proxyUrl = tryCctvProxyUrl(stream.url);
      if (proxyUrl === null) return <BadStreamUrl />;
      const sep = proxyUrl.includes('?') ? '&' : '?';
      return <img alt={stream.label} src={`${proxyUrl}${sep}_t=${refreshNonce}`} style={MEDIA_STYLE} />;
    }
    const sep = stream.url.includes('?') ? '&' : '?';
    return <img alt={stream.label} src={`${stream.url}${sep}_t=${refreshNonce}`} style={MEDIA_STYLE} />;
  }

  if (stream.kind === 'http') {
    if (cctvOverTor) {
      if (torReady === null) return <div style={{ ...MEDIA_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 11 }}>Checking Tor…</div>;
      if (!torReady) return <TorNotReady />;
      const proxyUrl = tryCctvProxyUrl(stream.url);
      if (proxyUrl === null) return <BadStreamUrl />;
      const sep = proxyUrl.includes('?') ? '&' : '?';
      return <img alt={stream.label} src={`${proxyUrl}${sep}_t=${imgTick}_${refreshNonce}`} style={MEDIA_STYLE} />;
    }
    const sep = stream.url.includes('?') ? '&' : '?';
    return <img alt={stream.label} src={`${stream.url}${sep}_t=${imgTick}_${refreshNonce}`} style={MEDIA_STYLE} />;
  }

  if (stream.kind === 'mp4') {
    if (cctvOverTor) {
      if (torReady === null) return <div style={{ ...MEDIA_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 11 }}>Checking Tor…</div>;
      if (!torReady) return <TorNotReady />;
      // Direct progressive/streamed MP4 over ga98cctv:// proxy. Range headers pass through
      // the handler for seeking support.
      const proxyUrl = tryCctvProxyUrl(stream.url);
      if (proxyUrl === null) return <BadStreamUrl />;
      return <video controls autoPlay muted loop src={proxyUrl} style={MEDIA_STYLE} />;
    }
    // Direct progressive/streamed MP4 over http(s). CSP media-src allows http(s); a
    // local file:// path would not load (not in media-src) — point users to a URL.
    return <video controls autoPlay muted loop src={stream.url} style={MEDIA_STYLE} />;
  }

  // HLS — render path. The useEffect above handles loading the source into hls.js / video.src.
  if (cctvOverTor) {
    if (torReady === null) return <div style={{ ...MEDIA_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ad', fontSize: 11 }}>Checking Tor…</div>;
    if (!torReady) return <TorNotReady />;
  }

  return <video ref={videoRef} controls autoPlay muted style={MEDIA_STYLE} />;
}
