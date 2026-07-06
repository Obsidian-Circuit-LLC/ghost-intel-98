# Ghost Intel 98 — v3.32.0

**A "My Documents" file manager on the desktop, a tidier desktop, and the SearXNG-instance editor that v3.31.0 promised.** Everything here has been on `main` since v3.31.0; this is the build that puts it in your hands.

## What's new

- **My Documents — a global file manager.** A new module, a peer of My Cases, reached from its own desktop icon (a hand-drawn Win98 folder-and-document). Create **nested folders**; right-click for **New Folder / Rename / Delete / Copy / Cut / Paste**; **drag files in from your PC** to import them; **Reveal in Explorer** to open the folder on disk. It's one personal store, independent of any case.

- **Encrypted at rest, real names, honest about the trade-off.** My Documents obeys the same rule as the rest of the app: files route through `secure-fs`, so they're **encrypted on disk exactly when app login is on** and plaintext when it isn't. Filenames stay real (the folder tree is legible; "Reveal in Explorer" is meaningful). When login is on, an in-app banner is upfront that the on-disk bytes are ciphertext — you open those files **here**, not in Explorer. That's the accepted edge of encrypt-at-rest; it is not weakened.

- **A tidier desktop.** **Calendar**, **Reminders**, and **Chat** move off the desktop into the **Access menu**. Existing installs keep all three — Chat is seeded into the menu on update (append-only; if you later remove it, it stays removed), and Calendar/Reminders were already menu entries.

- **Editable SearXNG instance.** The SearXNG onion that Q's web search uses is now editable in **Settings → Q**, with a Reset-to-default and the **same fail-closed `.onion` validation** the search engine enforces — a non-onion value is rejected the same way in the UI as it is in the main process. (v3.31.0 shipped the multi-engine picker with this value editable only in the settings file; this surfaces it.)

## Under the hood

- **Security is the load-bearing surface here** — the file manager takes untrusted paths from the renderer. Every path is fenced **twice**: segment validation at the IPC boundary (rejects `..`, separators, absolute paths, reserved Win32 device names) **and** a `realpath`-prefix confinement check inside every store operation (closes symlink-escape). Traversal fails closed.
- Built subagent-driven, with a **parallel adversarial whole-branch review** that caught a **critical the implementation plan itself contained**: a `rename('')` with no empty-path guard would have relocated the *entire* documents root out of its confinement — data loss plus a confinement escape. Also caught and fixed: an unvalidated import source-path (a compromised renderer could have read arbitrary host-readable files into the store) and two renderer error-swallowing bugs. Four confirmed findings fixed; five minor findings then folded in (refresh request-sequencing against fast folder-switching, an explicit copy-into-descendant guard, and added safety-guard test coverage).
- A **pre-ship reachability audit** confirmed My Documents opens with **no case selected** (it's global — no case dependency) and that Calendar, Reminders, and Chat all stay reachable from the Access menu on both fresh and upgraded installs.
- **3,067 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- **No new network egress**; no telemetry. My Documents is local file IO only.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.32.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `f85c93b8d0ee79e65181e0935e21ad72bbfaf9745b2049d2a84a31fb66fe469d`
- **Size:** 958,365,905 bytes (~958 MB).

*Everything from v3.31.0 (multi-engine search, clickable links, X sessions, Vosk voice, investigation cockpit) carries forward.*
