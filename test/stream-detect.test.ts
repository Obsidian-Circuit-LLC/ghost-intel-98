/**
 * EyeSpy "Detect format" probe. Verifies the bounded-egress contract: http(s)-only, content-type →
 * kind mapping, viewer-page → candidate-path discovery, redirects NOT followed, body never read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectStream } from '../src/main/services/stream-detect';

type FakeRes = {
  status?: number;
  type?: string;
  contentType: string | null;
  /** Spy we assert was called so the (possibly endless) body is never consumed. */
  cancel: ReturnType<typeof vi.fn>;
};

function res(contentType: string | null, opts: { status?: number; type?: string } = {}): FakeRes {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    status: opts.status ?? 200,
    type: opts.type ?? 'basic',
    contentType,
    cancel
  };
}

/** Install a fake global fetch that resolves per-URL from `map` (default: 404-ish text/html). */
function installFetch(map: Record<string, FakeRes>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string) => {
    const r = map[url] ?? res('text/html', { status: 404 });
    return {
      status: r.status,
      type: r.type,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? r.contentType : null) },
      body: { cancel: r.cancel }
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('detectStream — direct media URLs', () => {
  it('classifies multipart/x-mixed-replace as mjpeg, URL unchanged', async () => {
    installFetch({ 'http://cam/stream': res('multipart/x-mixed-replace; boundary=foo') });
    expect(await detectStream('http://cam/stream')).toEqual({ kind: 'mjpeg', url: 'http://cam/stream' });
  });

  it('classifies image/jpeg as http (refreshing snapshot)', async () => {
    installFetch({ 'http://cam/snap.jpg': res('image/jpeg') });
    expect(await detectStream('http://cam/snap.jpg')).toEqual({ kind: 'http', url: 'http://cam/snap.jpg' });
  });

  it('classifies an m3u8 content-type as hls', async () => {
    installFetch({ 'http://cam/live.m3u8': res('application/vnd.apple.mpegurl') });
    expect(await detectStream('http://cam/live.m3u8')).toEqual({ kind: 'hls', url: 'http://cam/live.m3u8' });
  });

  it('never reads the response body (cancels it)', async () => {
    const r = res('multipart/x-mixed-replace');
    installFetch({ 'http://cam/stream': r });
    await detectStream('http://cam/stream');
    expect(r.cancel).toHaveBeenCalled();
  });
});

describe('detectStream — viewer-page → candidate endpoint', () => {
  it('finds the real MJPEG endpoint when the root is an HTML viewer page', async () => {
    // The insecam shape: bare root returns HTML; the real stream is at a known path.
    installFetch({
      'http://61.246.194.45:8080/': res('text/html'),
      'http://61.246.194.45:8080/cgi-bin/viewer/video.jpg': res('image/jpeg')
    });
    expect(await detectStream('http://61.246.194.45:8080/')).toEqual({
      kind: 'http',
      url: 'http://61.246.194.45:8080/cgi-bin/viewer/video.jpg'
    });
  });

  it('returns null when neither the root nor any candidate is media', async () => {
    installFetch({ 'http://cam/': res('text/html') }); // every candidate falls through to the 404 default
    expect(await detectStream('http://cam/')).toBeNull();
  });
});

describe('detectStream — egress bounds', () => {
  it('rejects non-http(s) schemes without fetching', async () => {
    const f = installFetch({});
    expect(await detectStream('rtsp://cam/stream')).toBeNull();
    expect(await detectStream('file:///etc/passwd')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('does not follow redirects — a 3xx/opaqueredirect is treated as no media', async () => {
    installFetch({
      'http://cam/': res(null, { status: 302 }),
      // even if a candidate would 200, an opaqueredirect on the candidate is ignored:
      'http://cam/video.cgi': res('image/jpeg', { status: 0, type: 'opaqueredirect' })
    });
    expect(await detectStream('http://cam/')).toBeNull();
  });

  it('passes redirect:manual and a Range header on every request', async () => {
    const f = installFetch({ 'http://cam/x': res('image/jpeg') });
    await detectStream('http://cam/x');
    const opts = f.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
    expect(opts.redirect).toBe('manual');
    expect(opts.headers.Range).toBe('bytes=0-0');
  });

  it('caps concurrent detections (a hostile/plugin renderer cannot flood sockets)', async () => {
    // Make fetch hang until released so the first calls stay in-flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate;
      return {
        status: 200, type: 'basic',
        headers: { get: () => 'image/jpeg' },
        body: { cancel: vi.fn().mockResolvedValue(undefined) }
      } as unknown as Response;
    }));
    // MAX_IN_FLIGHT is 3; fire 3 that hang, then a 4th must be rejected immediately.
    const inflight = [detectStream('http://a/'), detectStream('http://b/'), detectStream('http://c/')];
    await expect(detectStream('http://d/')).rejects.toThrow(/in flight/i);
    release();
    await Promise.all(inflight);
    // After they drain, a new detection is accepted again.
    await expect(detectStream('http://e/')).resolves.toEqual({ kind: 'http', url: 'http://e/' });
  });
});
