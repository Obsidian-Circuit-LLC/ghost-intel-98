/**
 * Shared Live News player — renders ONE NewsStream. Used by both the inline GeoINT LiveNewsPanel
 * and the pop-out news-view window so the two surfaces play identically. It reads the GeoINT
 * networkEnabled flag ITSELF: with the network off it renders ONLY a placeholder (no HLS chunks,
 * no iframe), preserving the load-on-network-only egress invariant on every surface. The render
 * decision is the pure, unit-tested newsRenderMode(); the JSX is a thin switch over it.
 *
 * NewsStream/NewsStreamKind live here (they have no importers outside the geoint news surface);
 * LiveNewsPanel imports them from this module.
 *
 * Callers MUST place <NewsStreamView/> inside a position:relative container — the placeholders and
 * the <iframe> use position:absolute; inset:0.
 */
import Hls from 'hls.js';
import { useEffect, useRef } from 'react';
import { useSettings } from '../../state/store';
import { parseYouTubeId, youtubeEmbedSrc } from '@shared/youtube';

export type NewsStreamKind = 'hls' | 'youtube';
export interface NewsStream {
  label: string;
  url: string;
  kind: NewsStreamKind;
}

export type NewsRenderMode = 'offline' | 'hls' | 'youtube' | 'bad-youtube-id';

/** Pure render decision. Network OFF always yields 'offline' (no player, no iframe) regardless of
 *  kind — the load-on-network-only egress invariant. */
export function newsRenderMode(stream: NewsStream, net: boolean): NewsRenderMode {
  if (!net) return 'offline';
  if (stream.kind === 'hls') return 'hls';
  return parseYouTubeId(stream.url) ? 'youtube' : 'bad-youtube-id';
}

function HlsVideo({ url }: { url: string }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    // Safari / native HLS fallback.
    video.src = url;
    return () => {
      video.src = '';
      video.load();
    };
  }, [url]);
  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      controls
      style={{ width: '100%', height: '100%', background: '#000' }}
    />
  );
}

const placeholderBase: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: 12, textAlign: 'center', padding: 12
};

export function NewsStreamView({ stream }: { stream: NewsStream }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const net = settings?.geoint?.networkEnabled ?? false;
  const mode = newsRenderMode(stream, net);

  if (mode === 'offline') {
    return <div style={{ ...placeholderBase, color: '#9ad' }}>Enable the GeoINT network to play live news.</div>;
  }
  if (mode === 'hls') {
    return <HlsVideo key={stream.url} url={stream.url} />;
  }
  if (mode === 'youtube') {
    const ytId = parseYouTubeId(stream.url)!;
    return (
      <iframe
        key={ytId}
        title={stream.label}
        src={youtubeEmbedSrc(ytId)}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    );
  }
  return <div style={{ ...placeholderBase, color: '#e88' }}>Cannot parse a YouTube video id from this stream URL.</div>;
}
