Bundled Tor (C-tor) — DCS98 P2P chat (EXPERIMENTAL)
====================================================

The chat module runs the official Tor Expert Bundle as a controlled sidecar (SOCKS out + an
ephemeral v3 onion service bound to localhost). The binary is NOT committed to git (it's large and
.exe is gitignored); it is fetched + verified by scripts/fetch-tor.mjs and bundled into the installer
at package time (electron-builder extraResources: resources/tor -> tor).

Pinned release (verified 2026-06-06)
------------------------------------
  Component : Tor Expert Bundle, Windows x86_64
  Version   : 15.0.15  (tor 0.4.9.9)
  File      : tor-expert-bundle-windows-x86_64-15.0.15.tar.gz
  Source    : https://archive.torproject.org/tor-package-archive/torbrowser/15.0.15/
  SHA-256   : 8d3daf579192f3f128c0f42553dd994c640501b4b98682216d807c88004f7a96
  Integrity : SHA-256 matches the Tor Project's signed sha256sums-signed-build.txt, whose GPG
              signature verified as "Good signature from Tor Browser Developers (signing key)
              <torbrowser@torproject.org>" (key EF6E286DDA85EA2A4BA7DE684E2C6E8793298290).

Layout after fetch (resources/tor/win-x64/, gitignored)
-------------------------------------------------------
  tor/tor.exe              the Tor daemon (controlled by katana... no — by the chat TorTransport)
  tor/tor-gencert.exe      (unused by the app)
  data/geoip, data/geoip6  GeoIP databases tor needs at runtime
  data/torrc-defaults      default torrc (the app supplies its own control/SOCKS config)
  docs/*.txt               upstream license / credit files (Tor, OpenSSL, zlib, libevent, lyrebird)

License / attribution
---------------------
Tor is distributed under the 3-clause BSD license; OpenSSL/zlib/libevent under their own permissive
licenses. The upstream license + credit texts ship in docs/ (do not remove them from the bundle).

To (re)fetch:  node scripts/fetch-tor.mjs        (idempotent; verifies SHA-256, fails closed)
