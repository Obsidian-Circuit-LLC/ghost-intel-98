# Dead Cyber Society 98 — v3.6.0

**Ghost Access 98 is now Dead Cyber Society 98 (DCS98).** Same tool, same data, new identity — plus
a field-report punch list cleared end to end: a desktop sticky-notes layer, ChatGPT-style AI memory,
a working PDF viewer, a Mail module that actually connects, GeoINT Street View, and a pile of bug
fixes. Hardened by an adversarial red-team pass before release.

## The rename

- **Dead Cyber Society 98 / DCS98** everywhere — window titles, Start ("Access") menu, About, installer,
  new icon and pixelated splash logo. The desktop icon is kept.
- **Your data is carried forward automatically.** On first launch the app copies your existing
  `Ghost Access 98` data — cases, settings, sticky notes, the encrypted vault — into the new location.
  It **copies, never moves**, so the old data stays intact as a safety net, and the migration only marks
  itself complete if every file copied successfully (a partial copy retries on the next launch).

## What's new

- **Desktop sticky notes (new).** Win95-style notes you pin to the desktop: drag them around, type,
  pick an icon and a color. They float above your windows but click through empty space, and a global
  **Hide** tucks them all away without deleting anything. **Fired reminders now appear as sticky notes** —
  hit **OK** to clear one. Everything persists (encrypted at rest when login is on).
- **AI Assistant — conversation memory (new).** A ChatGPT-style sidebar of saved chats: **+ New chat**,
  click any past conversation to resume it, right-click/× to delete. Conversations auto-save as you go.
- **AI Assistant — right-click to copy** a message (or the whole conversation).
- **GeoINT — Street View + map fixes.** A **Street View** view of the current map center, a proper
  **Load** button for custom map tiles, the "Street" view renamed **2D Map**, and the map now resizes
  correctly when you resize or restore the window.
- **Markets — a quick intro popup** on first open, with "Don't show this again."
- **Default AI model is now `qwen3-abliterated:4b`.**

## Fixes

- **Minimize no longer wipes your work.** Minimizing a window used to throw its contents away — the
  Jukebox stopped, the AI conversation reset, unsaved Notepad text vanished. Windows now stay alive while
  minimized: **music keeps playing, your chat and notes are preserved.**
- **PDF viewer works.** PDFs render again (a pdf.js v5 API change was rejecting the page draw).
- **Mail connects.** Pick your provider (Gmail / Outlook / Yahoo / iCloud) for the right host/port/TLS,
  with a clear reminder that these services need an **App Password**, not your login password. SMTP now
  forces STARTTLS where required. The **Compose window can always be closed** (title-bar ✕, Cancel, or Esc).
- **My Cases** — "Case Files" is renamed **My Cases**, and switching between cases no longer shows the
  previous case's title/reference (a stale-form bug; your attachments were always correct).
- **Calendar** — a reminder now lands on the day you actually clicked (a timezone off-by-one), and you can
  **right-click a reminder to delete it.**
- **Jukebox** — the duplicate Pause button is gone; Play and Pause are now distinct, like a real CD deck.
- **Bookmarks** categories scale to the number of links (with a one-click "fit" to clear a manual height).
- **Net Explorer** — an **"Open the Firefox folder" button** opens the exact folder Firefox Portable goes
  in, so you can drop the files in place and hit Re-check (no reinstall).

## Security

Every change went through an adversarial red-team pass; all High/Medium findings fixed:
- The data migration only commits when every file copied — no silent data loss on a partial copy.
- Sticky-note edits flush on lock; AI conversation writes are serialized and no longer re-save on browse.
- GeoINT Street View embeds Google's street imagery **only on explicit action while the GeoINT network is
  on**; it loads nothing third-party until you open it, and falls back to opening in Firefox if framing is
  blocked. All other network egress remains **off by default** behind per-module opt-in gates and is refused
  while the vault is locked.

## Verification

- `typecheck` clean · **228 tests** (44 files) · production build OK · headless boot smoke clean.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.0.exe` (124,447,968 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `c84fe11f89f620941c0432cb7077852f5aeccf763955775128bacfeb5bce9020`
