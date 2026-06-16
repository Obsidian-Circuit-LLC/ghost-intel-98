Ghost Intel 98 ExifTool integration (attachment metadata)
================================================

Ghost Intel 98 can read rich file metadata from case attachments using Phil Harvey's ExifTool. When the
binary is present, the attachment "ⓘ" details panel gains an "ExifTool — N tags" section. ExifTool is
OPTIONAL and operator-supplied (it is NOT vendored in this repo): if absent, the section is simply
hidden — nothing else changes.

Layout (bundled via package.json `extraResources`, resolved by src/main/services/exiftool.ts):

    resources/exiftool/
      linux-x64/exiftool
      win-x64/exiftool.exe
      mac-x64/exiftool
      mac-arm64/exiftool

Get ExifTool from https://exiftool.org (Artistic/GPL — review its license before redistributing in a
published installer). The Windows build is a standalone `exiftool.exe`; on macOS/Linux you can drop the
standalone Perl distribution's `exiftool` launcher (and its `lib/`) into the platform folder, or a
self-contained build. Mark the unix launchers executable (`chmod +x`).

How it runs: the attachment (encrypted at rest) is decrypted to a short-lived temp file, ExifTool is
spawned with `-json -G1 -a -s` (no shell, fixed args — no command injection), the JSON is parsed, and
the temp file is deleted. Output is size- and time-bounded. No network.

Security note: ExifTool parses many formats and has had parser CVEs historically. It runs only over the
user's own case evidence, from the operator-supplied binary. Keep the bundled ExifTool up to date.
