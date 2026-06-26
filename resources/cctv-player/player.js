/*
 * CCTV player logic. Runs in the isolated `persist:cctv-tor` webview partition.
 * No node, no IPC. Reads kind + url from its own query string and renders one of:
 *   hls  → hls.js (bundled) into a muted autoplaying <video>, native HLS fallback
 *   mp4  → <video>
 *   mjpeg/http → <img> (multipart MJPEG and single still images both render in <img>)
 *
 * The url is decoded once and MUST be http(s); anything else is refused so the
 * webview can never be steered at file://, data:, javascript:, etc.
 */
(function () {
  'use strict';

  var KINDS = { hls: 1, http: 1, mjpeg: 1, mp4: 1 };
  var stage = document.getElementById('stage');

  function fail(text) {
    stage.innerHTML = '';
    var d = document.createElement('div');
    d.id = 'msg';
    d.textContent = text;
    stage.appendChild(d);
  }

  function clear() { stage.innerHTML = ''; }

  var params = new URLSearchParams(window.location.search);
  var kind = params.get('kind') || '';
  var url = params.get('url') || '';

  if (!KINDS[kind]) { fail('Unsupported stream type.'); return; }
  if (!/^https?:\/\//i.test(url)) { fail('Refusing to load a non-http(s) stream.'); return; }

  if (kind === 'mjpeg' || kind === 'http') {
    clear();
    var img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () { fail('Stream could not be loaded over Tor.'); };
    img.src = url;
    stage.appendChild(img);
    return;
  }

  // hls or mp4 → <video>
  clear();
  var video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = true;
  video.onerror = function () { fail('Stream could not be loaded over Tor.'); };
  stage.appendChild(video);

  if (kind === 'mp4') {
    video.src = url;
    return;
  }

  // kind === 'hls'
  var Hls = window.Hls;
  if (Hls && Hls.isSupported()) {
    var hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, function (_evt, data) {
      if (data && data.fatal) fail('Stream could not be loaded over Tor.');
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; // native HLS (Safari-style)
  } else {
    fail('HLS is not supported in this player.');
  }
})();
