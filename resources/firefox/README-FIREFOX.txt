Firefox Portable payload
=========================

Net Explorer launches a bundled Firefox Portable as a separate process (operator decision,
v3.3 — full swap of the in-app webview). The Firefox binary itself is NOT vendored into this
repository: it is a ~90 MB third-party payload and a distribution/BOM decision for the operator.

To enable the launcher, place a Firefox Portable payload in THIS directory so that one of the
following exists relative to here:

    resources/firefox/FirefoxPortable.exe                 (PortableApps launcher)
    resources/firefox/firefox.exe                          (plain extracted Firefox)
    resources/firefox/App/Firefox64/firefox.exe            (PortableApps internal layout)

Linux/macOS dev layouts also resolve (resources/firefox/firefox, .../Firefox.app/Contents/MacOS/firefox).

This whole directory is copied into the installer via electron-builder `extraResources`
(-> resources/firefox in the packaged app). Until a binary is present, Net Explorer shows
setup guidance and the launch action is a no-op; bookmarks and save-URL-to-case still work.

License note: Firefox is distributed by Mozilla under the MPL 2.0; bundling/redistribution must
follow Mozilla's trademark/distribution policy. Confirm before publishing an installer that ships it.
