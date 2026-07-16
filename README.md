# Ghost Intel 98

A Windows 98–inspired OSINT / case-management desktop application. Built with Electron + React + TypeScript. Runs on Windows 11.

**Ghost Intel 98** looks and feels like a late-1990s desktop environment — grey taskbar, pixel icons, draggable windows with title bars — but it is not a Windows emulator. It is a serious investigative case-management and OSINT tool that happens to wear a retro shell.

> **Formerly "Ghost Access 98."** The program is now **Ghost Intel 98**; your data is migrated forward automatically on first launch (see [Data location](#data-location)).

## TL;DR

A retro-skinned but serious, **offline-first** investigative workspace. Cases with attachments,
entities, timelines, exports, and an in-app document viewer — plus a suite of self-owned tools
that never depend on a third-party staying up:

- **My Cases** — the spine: attachments (drag-drop), entities, timeline, bio photos, PDF/HTML/CSV
  exports, cross-case search, and shareable `.ghost` case bundles.
- **My Documents** *(new)* — a global Win98 file manager on the desktop: nested folders, right-click
  New Folder / Rename / Delete / Copy / Cut / Paste, drag-drop import from your PC, and Reveal-in-
  Explorer. Encrypted at rest through the vault, exactly like your cases.
- **Sticky Notes** *(new)* — Win95-style draggable desktop notes (text, icon, color); fired reminders
  surface as notes you dismiss with **OK**; a global **Hide**. Persists, encrypted at rest.
- **AI Assistant** — local (Ollama) or remote LLM, opt-in case context, **conversation memory**
  (ChatGPT-style saved-chat sidebar), right-click copy, and **offline voice conversation**
  (push-to-talk + hands-free, on-device Vosk STT + TTS), API keys encrypted.
- **Markets** — offline-first market overview (crypto / FX / indices / equities / commodities) with an
  editable watchlist and bring-your-own feeds, off by default.
- **GeoINT / EyeSpy / Jukebox** — pluggable geopolitical feeds + map (2D / satellite / **Street View**),
  your own/authorized camera streams, and a Win98 CD-Player audio player.
- **Searchlight** — username-sweep OSINT: check a handle across the **full 3,166-site Maigret database**
  through **Tor** (clearnet opt-out, network off by default), then work the hits in a relationship graph
  with bundled site favicons, exportable reports, and its own encrypted cases. Add your own sites.
- **Bookmarks** — an offline start.me: drag-organized link board, per-link glyph/emoji/favicon,
  shareable `.ghostbookmarks` file.
- **Briefcase & Solitaire** — a home for loose notes that aren't tied to a case, and a full Klondike
  card game (drag-and-drop + win cascade) for the Win98 vibes.
- **DialTerm / Net Explorer / Mail** — SSH/Telnet/FTP with a dial-up handshake, a Firefox launcher,
  and IMAP/SMTP.
- **Private by construction:** no telemetry, no phone-home; all egress is explicit and consent-gated;
  optional encrypt-at-rest login (AES-256-GCM). Windows installer; per-user, no admin.

> **Install:** download [`GhostIntel98-Setup-3.50.1.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/latest), verify the SHA-256, **More info → Run anyway** (unsigned). *(Current build includes the Tor P2P chat — handshake **formally verified internally**: symbolic (ProVerif) + computational (CryptoVerif), internally adversarially reviewed; **not** independently audited and **not** FIPS-validated. See Status.)*

> **📘 User guides** — plain-language, step-by-step (download or read in-browser):
> - [**SOCMINT: X, Telegram & WhatsApp**](docs/guides/SOCMINT-Tutorial.pdf) — set up and run the social-media collectors, per platform, with the Tor / clearnet and opsec caveats. ([markdown](docs/guides/socmint-tutorial.md))
> - [**How Searchlight Learns**](docs/guides/Searchlight-Learning-Guide.pdf) — how the username-sweep detector gets smarter from your own labels, and when to turn ML on. ([markdown](docs/guides/searchlight-learning.md))

## Status

**v3.50.1** — **Minds Eye: forget a conversation's memory.** The "Forget" button on a **conversation** node in the Minds Eye memory graph is now live. It's a **tombstone, not a delete** — the chat stays in AI Assistant history, but the conversation stops being recalled and its node leaves the graph, reversibly ("Remember" restores it; a Forget/Remember toggle also lives in the AI Assistant conversation list). Crucially it forgets the conversation across *both* memory channels: its vector-index chunks **and** the adaptive-memory facts distilled from it — while a fact that also has independent support from another conversation stays live. **Entity** memory Forget stays intentionally disabled (an entity node is a per-case aggregate, managed in the case tool). Built subagent-driven with a parallel adversarial whole-branch review that caught a real gap — the first cut only excluded the vector chunks and would have left the distilled facts still influencing answers. Everything goes through the encrypted memory store; a failed re-index surfaces as an error, never a silent success. **3,601 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.50.0 carries forward.*

**v3.50.0** — **Report Templates + a word-processor editor.** The final piece of the "Chain of Custody Report and Template Generator" vision. **Templates:** save any report as a reusable **template** (its banner/photos are deep-copied so it's self-contained), browse your templates in the new **Templates** nav branch with a live **preview** (rendered in a sandboxed frame, matching the export), and **Use Template** deep-copies one into a fresh report — lighting up all the previously-greyed Templates controls. **Editor:** opening or creating a report now drops you **straight into a typable document** (a focused text body under the header — no "+ Text" click), and reports gain chain-of-custody **metadata** — Case #, Reference #, Classification, and a Signature line — shown in the header and carried into the PDF/DOCX exports. Built subagent-driven across **7 TDD tasks** with a parallel adversarial whole-branch review that caught and fixed a real focus bug (File→New while editing left the new document unfocused). Templates keep the encrypted-store + block model + sanitizer; template previews are script-sandboxed; every new field is escaped into the exports. **3,591 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.49.1 carries forward.*

**v3.49.1** — **Reports goes classic Windows 98 + recurring calendar reminders.** Two GhostExodus requests. **(1)** The **Reports** module is reskinned to a true Windows-98 look end-to-end — dashboard, editor, and dialogs: classic silver chrome with 3-D bevels, blue MDI-style title bars on the Navigation / Quick Actions / Dashboard panels, folder/house/page tree icons, a toolbar with icons, white sunken inputs and lists, the document page floating on a grey workspace, and a `Ready · Workspace · 🔒 ENCRYPTED` status bar. The dark "intelligence-workstation" hero is kept, framed inside the light Dashboard. (Reports only — the other modules keep the dark theme.) **(2)** **Recurring calendar reminders**: right-click a reminder → **Make recurring ▸ Daily / Weekly / Monthly** (and **Remove recurring**). A repeating reminder now shows on every matching day of the month with a 🔁 badge and keeps firing its notification each period. Built on an immutable-anchor + `lastFiredAt` model so it survives the app being closed for weeks without a notification burst (it catches up with a single reminder, then resumes). Built subagent-driven with a parallel adversarial whole-branch review that caught and fixed three real bugs (a catch-up notification burst, a stale-refresh race, a remove-recurring re-fire). **3,563 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.49.0 carries forward.*

**v3.49.0** — **Reports Dashboard + a filled My Cases pane.** Two things GhostExodus asked for. **(1)** Opening **Reports** now lands on a proper Win98 **Dashboard** — a "Report Generator" welcome, quick-action tiles (Create New Report, Manage Contacts, Export PDF), and a **Recent Reports table** (Name / Status / Last Modified / Created By) with single-click select, double-click open, column sort, and a right-click menu (Open / Rename / Duplicate / Export / Archive / Delete). A left **Navigation tree** (Dashboard · Reports: All / Recent / Drafts / Archived · Contacts) filters the table, backed by a new **status** (draft / completed / archived, colour-coded) and **author** on every report. The window gains a full **menu bar + toolbar** (File / Edit / View / Reports / Templates / Tools / Help); editor-only and not-yet-built items are **greyed, never dead**. The v3.48.0 three-column editor is unchanged and opens when you pick a report. (Templates — save / reuse / preview — are the next sub-project; their menu + "Use Template" tile are present but disabled.) **(2)** The **My Cases** detail pane is no longer a blank grey void when no case is selected — it now shows GhostExodus's branded magnifying-glass artwork (*"Trust nothing. Verify everything."*). Built subagent-driven across **7 TDD tasks** with a parallel adversarial whole-branch review that caught and fixed **two real bugs** (a view-swap that discarded the editor's pending autosave; a deleted report leaving the Export/Open controls pointing at a dead id). **3,541 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.48.0 carries forward.*

**v3.48.0** — **Report Template Generator — the Reports tool, redesigned.** The v3.47.0 Reports tool worked but shipped **unstyled** — an uploaded banner and inserted photos rendered at full native size and swamped a grey, top-left-collapsed editor. This release writes the missing stylesheet as the **root-cause fix** and rebuilds Reports toward a proper document editor: a **centered fixed-width page** (banner and photos capped to page width), a **three-column layout** — reusable **Contact**, **Introductions**, and **Descriptor** libraries on the left; the document in the middle; **Descriptor Preview**, a **Document Outline**, and **Image Properties** on the right — plus a **status bar** (word count, ~page count, zoom). The toolbar gains **font family** (six Windows-standard typefaces, no bundled font files), **alignment**, **bullet/numbered lists**, and **scheme-guarded hyperlinks** (http/https/mailto only). A new **table** block (simple grid, add/remove rows & columns) rounds out the document, and everything exports to **PDF and DOCX** with matching fidelity. The renderer sanitizer grew to match — `font-family` constrained to the exact whitelist, alignment/lists, and links stripped of `javascript:`/`data:` — and remains the sole trust boundary before the exporters. Built subagent-driven across **9 TDD tasks** with a parallel adversarial whole-branch review that caught and fixed **six real defects** (table data-loss, three still-unstyled panels, a DOCX schema-order bug, a dead introduction-insert path). **3,504 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.47.0 carries forward.*

**v3.47.0** — **Chain of Custody report generator.** A new global **Reports** tool — the formal deliverable after an OSINT investigation. A structured-block document editor: a **logo banner** across the top, a saved **contact book** (add/edit/delete/select your details for the "From"), an editable **To** recipient, **rich text** (bold/italic/underline + preset sizes), and **drag-drop photos** you can resize with a caption. A **descriptor library** lets you build reusable canned descriptions (e.g. "what OSINT.Industries is, treat as a lead not proof") and **right-click → preview → Insert** them into the text — either the body alone or with a bold title. Photos can also be **imported from a case**. Export to **PDF and DOCX**. Every text edit is DOMPurify-sanitized to a `font-size`-only allowlist and every field is escaped into the exports (no injection); reports + libraries are encrypted at rest; report photos accept up to 25 MB. Built subagent-driven across 8 TDD tasks with a parallel adversarial whole-branch review. **3,450 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency. *Everything from v3.46.0 carries forward.*

**v3.46.0** — **Whiteboard export + import.** A GhostExodus request: get an investigation board out as a document, and move boards around. **Export → PDF / DOCX** produces a **visual snapshot** of the board (nodes at their positions, colors, photos, connecting lines) *plus* a **structured appendix** listing every node and connection — the PDF renders the layout, the DOCX embeds the same board image. **Board file (`.gboard`)** is a portable, self-contained export/import: it bundles the board graph *and* its referenced photos, so you can move a board between cases or machines, share it, or back it up — round-trippable, re-writing photos through the vault on import. All node text is escaped into the exports (no injection), attachment reads are capped, and export goes only through the OS save dialog. **3,404 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.45.0 carries forward.*

**v3.45.0** — **Whiteboard upgrades: selectable file text, resizable nodes, colors + names.** A GhostExodus feature batch on the per-case Whiteboard. **(1) File views are now copyable** — opening a dropped file's viewer (text/CSV/JSON/HTML/**DOCX**/EML) lets you highlight and copy text, and **PDFs get a real selectable text layer** over the page so PDF text copies like a normal document (the app is globally selection-locked for its Win98 feel; the viewer bodies now opt back in). **(2) Nodes resize** — a bottom-right drag handle grows any node to fit clipped content (scale-aware, autosaved). **(3) Colors + names** — the header swatch opens a color picker (7 presets **plus a custom hex input**), and you can **double-click a node's header to give it a name** (falls back to the type when unnamed). Built subagent-driven across 5 TDD tasks with a parallel adversarial whole-branch review that caught + fixed a PDF text-layer sizing bug and two color-popover interaction bugs before ship. **3,391 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.44.0 carries forward.*

**v3.44.0** — **Q: right-click copy now respects your selection.** A GhostExodus field fix. Highlighting a section of a Q message and using right-click **Copy** was grabbing the whole conversation (Ctrl+C worked fine). Q's messages use a custom right-click menu that suppresses the browser's native "Copy", and that menu only offered *Copy message* / *Copy whole conversation* — never the selection. Now the menu reads your live highlight and offers **Copy selection** first when text is selected, copying exactly what you highlighted. **3,378 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.43.0 carries forward.*

**v3.43.0** — **A tighter News window and a top-tab Number Muncher.** Two layout follow-ups from GhostExodus. **(1) The News window loses its right scrollbar and tightens up.** The scrollbar came from the module content slightly overflowing the *shared* window body (`overflow: auto`, used by every window) — so instead of touching that global rule, the News module now clips its own overflow (the video fills the space; nothing there legitimately scrolls), and the Stream / Add-stream control spacing is tightened to match the clean pop-out mockup. **(2) Number Muncher's modes move to a top tab strip.** The seven modes were a left rail that left a large empty grey column; they're now a wrapping row of tabs across the top, the empty column is gone, and the window shrinks from 380×580 to 320×450. All seven keypads and the memory-scope rule are unchanged. **3,355 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.42.0 carries forward.*

**v3.42.0** — **Two Live News regressions fixed.** Both reported by GhostExodus and both traced (via `git -S` bisection, not guesswork) to the same v3.38.0 commit that introduced the Add-stream modal. **(1) The News feed's pop-out (⧉) button is back** — it had been deleted as collateral when that commit dropped the older per-row pop-out; the pop-out window itself was never removed, only the button that opens it. It's restored in the *shared* feed control, so it returns on **both** the GeoINT Live News panel and the standalone OSINT Toolkit News window at once. **(2) The GeoINT Live News border spans the panel again** — the `<fieldset>` had no width rule and was falling back to the browser default (`min-content`), so it shrank once the wide inline add-form moved into a modal; a full-width, border-box rule makes the near-transparent border reach the panel's right edge regardless of content. Regression tests added for both. **3,354 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.41.0 carries forward.*

**v3.41.0** — **A compact Number Muncher and bigger documents.** Two quick GhostExodus follow-ups from field-testing v3.40.0. **(1) Number Muncher shrinks** to roughly the Windows 11 Calculator footprint (default 380×580, down from 760×620) — the fixed side column is gone: the Memory keys become a slim row above the keypad, History hides behind a 🕘 toggle that overlays a drawer, and the Info panel folds into a one-line status footer (`Mode · 64-bit · Ready`). All seven modes and the memory-scope rule are unchanged. **(2) The in-app document viewer's size cap goes from 64 MB to 512 MB** — a 108 MB PDF that was being rejected now opens (the per-byte `number[]` marshalling was already removed in v3.40.0, so memory cost is linear; encrypted files still decrypt in-process with no OS handoff, and anything over the cap still offers **Export**). A self-review during the change caught a shared CSS class the Statistics results readout reused, before ship. **3,352 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.40.0 carries forward.*

**v3.40.0** — **Number Muncher, an in-app document viewer, and a fixed signature pad.** A batch of GhostExodus field feedback. **(1) Number Muncher** — a new **7-mode calculator** (Standard · Scientific · Programmer · Converter · Statistics · Date Calc · Unit Calc) with a memory register and calculation history, tucked into the Access menu's **Organizer** category (renamed from "Organization"). Each mode is a pure, exhaustively unit-tested engine — 64-bit BigInt base conversion and bitwise ops, affine °C/°F/K temperature, population-vs-sample statistics, UTC-pure date math. **(2) My Documents now opens files in Ghost Intel 98's own document viewer** — PDF, images, CSV, JSON, HTML, `.docx`, and text render **in-app, fully offline**, decrypted in-process with no handoff to Windows or any external app; a size cap keeps a huge file from freezing the viewer, and an unsupported type offers an **Export** rather than a broken preview. The old decrypt-to-temp OS-handoff "Open" path is removed. **(3) The signature pad is fixed** — drawing a signature by hand now works (the canvas was CSS-stretched wider than its drawing bitmap, so strokes landed off-canvas and vanished; uploading an image always worked). Built subagent-driven across nine TDD tasks with a parallel adversarial whole-branch review that caught and fixed real defects before ship — the viewer's missing size cap, a memory register that read the wrong value outside the arithmetic modes, and a formatter that printed very large finite results as "Infinity". **3,348 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.39.0 carries forward.*

**v3.39.0** — **Ghost Ledger 98 goes midnight purple.** A visual pass on the invoice module from GhostExodus. The module is re-themed **midnight purple** (module-scoped — every other tool stays Win98 grey; text meets WCAG-AA contrast, verified by a test), the recolored banner is **left-pinned** with the empty header space now filled by an **animated canvas** — purple pixel-cubes dissolving out of the banner edge with a subtle matrix code-rain behind them and a low-key "NO CHEATING!" watermark (throttled, pauses off-screen, static under reduced-motion). In the Access menu, **OSINT Toolkit moves above Games**. The **exports are deliberately untouched** — the PDF and `.docx` stay clean black-and-white professional invoices, and a test asserts no theme colour can leak into them. Built subagent-driven with a parallel adversarial whole-branch review (a reduced-motion resize blank was caught + fixed). **3,311 automated tests** green (1 skipped); typecheck clean; no new egress; no new dependency; encrypt-at-rest unchanged. *Everything from v3.38.0 carries forward.*

**v3.38.0** — **Ghost Ledger 98, a categorized Access menu, and RTFM field guides.** A batch of GhostExodus field feedback. **(1) The invoice module becomes "Ghost Ledger 98"** — a branded banner header, a new **`.docx` export** beside the PDF (a real editable OOXML Word document, footed identically to the PDF, built with the bundled `adm-zip` — no new dependency), **uploaded logos and the signature now show in preview boxes with a Remove control**, and the "Upload signature" control is a proper button with a preview. **(2) The Access (start) menu is reorganized into categorized flyouts** — Programs · Creativity · Music · Network · Organization (each with an icon), plus the existing Games and OSINT Toolkit submenus, with **RTFM moved directly below Settings**. **(3) RTFM gains two field guides** — **Searchlight** and **SOCMINT** step-by-step tutorials, rendered from the in-repo guide markdown; the built-in markdown renderer now handles tables, blockquote callouts, fenced code, and rules, so the guides (and the AI assistant's replies) read cleanly. Built subagent-driven across several TDD passes with parallel adversarial whole-branch reviews that caught and fixed real defects before ship — a `.docx` that emitted XML-1.0-illegal control characters (an unopenable file) and guide tables that rendered as raw pipe text. **3,303 automated tests** green (1 skipped); typecheck clean; **no new egress**; no new dependency; encrypt-at-rest unchanged. *Everything from v3.37.1 carries forward.*

**v3.37.1** — **Jukebox dimensional fixes** (GhostExodus field feedback on the v3.36.0 rebuild). The **Prev / Next / Shuffle / Repeat** buttons now show their icons instead of rendering blank (their glyph colour wasn't pinned, so they inherited the button-face grey and vanished); the **Playlist** button no longer bleeds its label (the crowded control row wraps instead of shrinking the text buttons below their width); and the **fully-expanded** view no longer spills off the bottom of the app — the equalizer is a little shorter, the expanded height comes down from 780→640px, and the frame clips so the playlist scrolls internally rather than the deck overflowing. Purely dimensional — no behaviour change. **3,271 automated tests** green (1 skipped); typecheck clean. *Everything from v3.37.0 carries forward.*

**v3.37.0** — **An offline invoice generator.** From GhostExodus ("investigators may find this useful to calculate their invoice stuff and export it"). A new free **Invoices** module: build a month of work as **line items** (date + start/end time → hours are derived, e.g. 12:00–15:30 = 3.5 h), apply a **flat hourly rate** with an optional **tax/VAT %** and a currency, and watch the totals foot live. Add your **and the client's** name, company, and **logo**, an optional **signature** (draw on a pad or upload an image), then **export to PDF** — the on-screen preview *is* the exported document. It **remembers your details**: reusable sender/client profiles, a list of past invoices you can reopen or duplicate, and an auto-incrementing invoice number, all **encrypted at rest** through the vault. Fully offline — no network, no new dependency. Built subagent-driven over **9 TDD tasks** with a **parallel adversarial whole-branch review** that caught and fixed a **critical** before ship (a renderer-supplied asset ref reached the filesystem unvalidated — a vault-exfiltration path — now gated by `ensureFileName` with defense-in-depth and a traversal-rejection test), plus verified minors folded in (money now rounds to cents and line amounts foot to the subtotal; no unrounded `0.3333…` hours; signature mime tracks the file). Every user-supplied string is HTML-escaped in the printable invoice (XSS fence). **3,271 automated tests** green (1 skipped); typecheck clean; **no new egress**; encrypt-at-rest unchanged. *Everything from v3.36.0 carries forward.*

**v3.36.0** — **A rounded Windows-Media-Player Jukebox and a cleaner News add-stream flow.** Two items from GhostExodus's field feedback. **(1) The Jukebox is rebuilt** into the rounded chrome shell from his mockup: a **3-state shade** (slim strip → deck-with-playlist → full-with-drawer), a **real 10-band graphic equalizer** (Web-Audio peaking bands, presets, the analyser tapping *after* the EQ so the visualizer shows what you hear), a fold-out **stream-station manager** (add/edit/remove, up/down reorder, Save List, and a Test button that probes reachability through the *same* opt-in egress gate as playback — off means it never touches the network), and an **honest format readout** (codec · bitrate · channels · sample-rate from the file's real tags; bit-depth shown **only** when the container actually declares it, so MP3s don't get a fabricated "16-bit"). Same functions as before, restyled and extended; the current docked width is preserved. **(2) News custom streams** are now added through an **Add-stream modal** (Label · kind · URL · OK/Cancel) instead of an always-visible inline form, and the redundant per-row pop-out button is gone — less in the visual path, and an invalid entry keeps the dialog open with your text intact. Built subagent-driven over **11 TDD tasks** with a **parallel adversarial whole-branch review**: two confirmed findings auto-fixed before ship (a stale-settings write race and a vacuous IPC test), four verified minors folded in (modal input retention, a timed-out Test probe that now tears down, and two coverage gaps). **3,240 automated tests** green (1 skipped); typecheck clean; **no new egress** (streaming stays opt-in); no new dependency; encrypt-at-rest unchanged. *Everything from v3.35.0 carries forward.*

**v3.35.0** — **GeoINT field fixes: the Host Info panel tells the truth, settings stay in sync, and host resolution gains an opt-in clearnet mode.** From GhostExodus's casework on Tor-blocked cameras. **(1)** The Host Info panel no longer claims "Host resolution is turned off" right after resolving a host — the message is now driven by what the lookup **actually did** (a stale settings copy could contradict the real result), and the standalone panel resolves as soon as it opens. **(2)** Settings changes now **sync across the app without a restart** — the main process pushes a `settings:changed` event to the UI, and per-panel writes (GeoINT tiles, the news feed list) send only the field they changed instead of re-sending a whole block that could clobber a sibling from a stale copy. **(3)** Host resolution (the DoH/PTR/RDAP recon) gains an **opt-in CLEARNET mode** in Settings → GeoINT — **off by default**, gated behind a one-time real-IP-exposure acknowledgement, and visibly marked ("Resolved over CLEARNET — real IP exposed") whenever a lookup used it; with the toggle off, a mutation-tested guard proves no code path reaches a clearnet socket (Tor-only stays the default). Also clarifies the two GeoINT Tor labels so camera **streams** vs camera **hosts** stop getting confused — and a reminder: to watch a Tor-blocked camera's **video**, that's the separate "Route CCTV over Tor" toggle (turn it off → clearnet stream). Built subagent-driven over 6 TDD tasks with a **charter-focused adversarial whole-branch review** whose confirmed finding (the clearnet-off guard was untested) was fixed with a mutation-survival test before ship. **3,191 automated tests** green (1 skipped); typecheck clean; **no new egress with the clearnet toggle off**; encrypt-at-rest unchanged. *Everything from v3.34.0 carries forward.*

**v3.34.0** — **Field-feedback batch: file-type icons, drag-and-drop, notes into My Documents, a readable Investigation panel, a mirrored News feed, and a Windows Media Player–style Jukebox.** Six items from GhostExodus's live casework. **(1) Per-file-type icons** — My Documents files no longer share one generic glyph; text/document/spreadsheet/data/image/audio/video/archive/code each get a hand-drawn Win98 icon (neutral fallback for the rest). **(2) Drag-and-drop** — drag a file onto a folder tile to move it, and drag text notes **between My Documents and the Briefcase** both ways (a Briefcase note → an encrypted `.txt`; a text file → a note; binaries declined, not mangled). **(3) Save a note into My Documents** — Notepad's save-target dropdown now lists **📂 My Documents** beside the Briefcase and your cases; re-saving updates in place, encrypted at rest. **(4) The Investigation window is readable** — the autonomous-investigation cockpit's side panel was black-on-near-black (a missing stylesheet); it now has a proper Win98-grey control panel while the graph canvas stays dark (it *is* a Maltego-style tool — seed an entity, pivot across transforms; autonomous fan-out needs the reasoning pack). **(5) News mirrors GeoINT Live News** — the standalone News window shares GeoINT's saved live-news feeds: pick any from the dropdown or add one, and adds in either place appear in both (one list, no duplicate store). **(6) Jukebox WMP re-skin** — the compact deck is restyled as a classic media player (bordered visualizer screen, rewind/play/pause/stop/fast-forward, GI98 logo bottom-right), opening smaller by default with the caret still expanding the track info + library. Two new encrypt-at-rest channels carry note content through secure-fs with path-confinement (oversize bodies rejected, not truncated). Built subagent-driven over 9 TDD tasks with a **parallel adversarial whole-branch review** whose verified findings were folded in before ship. **3,165 automated tests** green (1 skipped); typecheck clean; **no new egress**; encrypt-at-rest unchanged. *Everything from v3.33.1 carries forward.*

**v3.33.1** — **Hotfix: the Jukebox window fits the compact deck.** v3.33.0 made the Jukebox *content* default to compact, but the window frame stayed at its full expanded height — the deck sat atop a tall empty gray panel. The window now resizes to match the mode (a short deck-sized frame when compact, full height when expanded via the caret, back down when collapsed), and a fresh Jukebox opens deck-sized. The media module drives its own frame height through the window store (compact 270px / expanded 840px). **3,095 tests** green; typecheck clean; no new egress, no behavior change beyond window sizing. *Everything from v3.33.0 carries forward.*

**v3.33.0** — **My Documents can now open and export your files, a proper large-icons folder view, a compact Jukebox, and a clearnet toggle in Q — all from GhostExodus's field feedback.** **(1) Open & Export in My Documents** — v3.32.0 stored everything encrypted-at-rest but gave you no way to read it back (opening the on-disk file in Word/Acrobat showed ciphertext — "unreadable content"). Now **Open** decrypts a file into a session-scoped temp and launches it in your default app, and **Export…** writes one decrypted copy to a location you choose. The vault store stays ciphertext throughout: the Open temp is written **owner-only**, **shredded on quit**, and **overwrite-swept on next launch**, and **Export refuses a destination inside the encrypted store** so a plaintext copy can never land back in the vault. **(2) A large-icons folder view** — My Documents now shows folders and files as a Win98 **large-icons grid**; double-click a file to Open it. The right-click menu is reordered (**New Folder** at the top, **Paste** under Cut) and gains **Open** / **Export…** on files. **(3) Jukebox opens compact** — the player opens as the compact deck by default with a caret to expand the library/stations, and **remembers your choice**. **(4) Clearnet toggle in Q** — a **Clearnet** checkbox in Q's chat toolbar (**off by default**) with a **Fallback / First** mode: *Fallback* keeps today's Tor-first behavior (clearnet only if Tor returns nothing), *First* skips Tor and queries DuckDuckGo directly — each carrying the unmistakable **real-IP-exposure warning**. Clearnet stays **DuckDuckGo-only** and can never route the SearXNG onion. Built subagent-driven with a **parallel adversarial whole-branch review** whose verified findings were folded in before ship — export-into-vault refusal, owner-only + overwrite-swept Open temps, and a jukebox-persist race. **3,093 automated tests** green (1 skipped); typecheck clean; **no new egress** beyond the existing opt-in clearnet path. *Everything from v3.32.0 carries forward.*

**v3.32.0** — **A "My Documents" file manager on the desktop, and a cleaner desktop.** **(1) My Documents** — a new global file manager, a peer of My Cases and reached from its own desktop icon: create **nested folders**, right-click for **New Folder / Rename / Delete / Copy / Cut / Paste**, **drag files in from your PC**, and **Reveal in Explorer** to see where they live on disk. It's a single personal store, independent of any case, and it obeys the same **encrypt-at-rest** rule as everything else — files are encrypted on disk exactly when app login is on (with an in-app note that, while encrypted, they open here rather than in Explorer). Every path the file manager touches is fenced twice against traversal (segment validation at the process boundary **and** a realpath-confinement check in the store), so nothing can escape the documents folder. **(2) A tidier desktop** — **Calendar**, **Reminders**, and **Chat** move off the desktop into the **Access menu** (existing installs keep them: Chat is seeded into the menu on update, so it never disappears). **(3)** The **SearXNG instance** used by Q's web search is now editable in **Settings → Q** (with the same fail-closed `.onion` validation the engine enforces). Built subagent-driven with a **parallel adversarial whole-branch review** that caught a **critical the plan itself contained** — a `rename('')` that would have relocated the entire documents root *out* of its confinement (data-loss + escape) — plus an unvalidated import path and two error-swallowing UI bugs, all fixed before merge; a **pre-ship reachability audit** confirmed My Documents opens with no case selected and all three moved tools stay reachable. **3,067 automated tests** green (1 skipped); typecheck clean; **no new egress**. *Everything from v3.31.0 carries forward.*

**v3.31.0** — **Five features from GhostExodus's field requests, now in an installer: pick your web-search engine, click links in Q's answers, a rebuilt X-session model, out-of-box voice input, and a per-case investigation cockpit.** **(1) Multi-engine web search** — a Firefox-style engine picker in Q's chat toolbar chooses **DuckDuckGo** or **SearXNG** for the `[SEARCH:]` loop; both run **onion-to-onion over Tor** (IP-hidden, no exit node), and SearXNG is a metasearch that aggregates Google/Bing/etc. **server-side**, so you get broad coverage with zero clearnet exposure. (The candidate clearnet engines — Google/Bing/Yandex/Yahoo — were **dropped after real-fixture testing** proved every one captcha-walls scraping; SearXNG is how their coverage still reaches you, safely.) **(2) Clickable links in Q's replies** — URLs and markdown links in the assistant's answers are now clickable, opened via a safe external path behind a **one-time real-IP-exposure acknowledgement** (an adversarial review caught and fixed a middle-click bypass of that consent). **(3) X/Twitter collector session refinement** — the credential model is rebuilt around **atomic `auth_token`+`ct0` sessions** (no more mixing tokens from two different logins), a one-control clearnet gate with a durable first-time consent modal, a **"Test session"** button that catches an expired cookie *before* a job fails, and a collector picker by session label. **(4) Voice input works out of the box** — Talk-to-Q's offline speech-to-text now ships with the bundled Apache-2.0 **Vosk** model (no more "voice input needs a model in resources/vosk/"); recognition runs fully on-device, and the model is OS-independent so it's ready for future Linux/macOS builds. **(5) A per-case investigation cockpit** — open a case → **"Open investigation…"** → an entity graph you build and add to, beside an **INTELREPORT** generator with PDF export (the automated-transform run engine arrives with a forthcoming reasoning pack). Built subagent-driven with **parallel adversarial whole-branch reviews** that caught real criticals before merge — a build-target wiring gap, a tar non-determinism bug, a credential-loss migration, and a clickable-link deanon vector; a **pre-ship reachability audit** then caught and fixed a cockpit launcher gap that would have shipped the investigator opening into an error state. **3,026 automated tests** green (1 skipped); typecheck clean; **no new egress** beyond the existing opt-in paths. *Everything from v3.30.3 carries forward.*

**v3.30.3** — **Five fixes from GhostExodus's field testing: the assistant no longer hangs on documents, adaptive memory actually learns, and three UI dead-ends are fixed.** **(1) The assistant "stopped responding"** on uploaded documents — root cause: the chat stream had **no inactivity timeout**, so a silently-stalled local generation (common under memory pressure right after an upload loads the embedding model) blocked forever with no error and no way out but a restart. A **stall-watchdog** now bounds each read (120s of total silence) — a stuck generation surfaces a clear error instead of hanging. **(2) The "Learned" panel stayed empty** no matter how long adaptive memory ran: the distiller was hardcoded to a `llama3.1` model on the bundled runtime, which ships **only the embedding model** — so every distill call 404'd and nothing was ever learned. It now distills using the **same model + endpoint your chat already uses** (no new egress — the conversation already went there), and logs a warning instead of failing silently. **(3) "Add Case"** in GhostScrape, X Collector, and SOCMINT did nothing — `window.prompt` is a **no-op in Electron** (returns null), so the button flashed and no case was created; replaced with a proper in-app dialog (also fixes the "Import into case" pickers). **(4) The Memory sidebar** no longer overlaps its toolbar button labels onto the Voice controls (the toolbar now wraps). **(5) The GhostScrape Account dropdown** no longer renders a glitched row of chevrons when opened. **2,802 automated tests** green (1 skipped); typecheck clean; no new egress. *Everything from v3.30.2 carries forward.*

**v3.30.2** — **Three fixes from GhostExodus's v3.30.1 field testing: file references, web-search visibility, and the Mind's Eye label glitch.** With memory recall now working (v3.30.1 landed), these clean up the surrounding rough edges. **(1) Referencing a file** that can't be included in chat — a binary/Office file (`.docx`), a scanned/image PDF with no text layer, or a read error — now raises a **clear notice** naming the file and why, instead of a silent skip. **(2) Web search** no longer collapses every zero-result into a silent "(0 results)": it distinguishes **"Tor isn't available"**, **"couldn't reach DuckDuckGo over Tor (onion unreachable/blocked/timed out)"**, and **"reached DuckDuckGo but no results"** — so a failed search points at its own cause (search itself is verified working over both Tor and clearnet; a persistent zero is local Tor-reachability, now surfaced). **(3) Mind's Eye** no longer stacks node labels into an unreadable blob in dense clusters — the shared graph canvas now **declutters labels** (keeps non-overlapping ones, prioritizes larger nodes, drops colliders), which also keeps the new investigation graph readable. **2,684 automated tests** green (1 skipped); typecheck clean; no new egress.

**v3.30.1** — **The offline-memory fix, finally complete — plus a web-search loop fix.** v3.28.0 and v3.30.0 both chased the "0 chunks / `nomic-embed-text` not present" 404 and both missed the real cause: the dedicated embedding runtime spawns `resources/local-ai/ollama.exe`, but **no Ollama binary was ever bundled** — the model shipped, the engine to run it did not, so the runtime never started and embeddings fell back to the user's own Ollama (which lacks the model). Every prior fix passed because its tests **mocked the runtime**. This release **bundles the CPU-only Ollama runtime** (`ollama.exe` + CPU runners, **~43 MB** — the ~2 GB of GPU runners are excluded since embeddings run on CPU), so the dedicated runtime on port 11435 serves the model **fully offline, independent of the user's Ollama**. A new **`afterPack` build guard fails the build** if the runtime/runner/model isn't in the packaged app, so this can't silently recur. Verified: the bundled blobs return a real 768-dim embedding via the exact `/api/embeddings` path, and the packaged installer was confirmed to contain the runtime. Also: **web search no longer spins on the same query** — the local model would sometimes re-run an identical `[SEARCH:]` several times instead of answering; Q now detects a repeated query and answers from the results it already has. **2,642 automated tests** green (1 skipped); typecheck clean. *(Rebuild the memory index once after updating: Settings → Q → Rebuild memory index.)*

**v3.30.0** — **The assistant's memory actually works offline again — the 0-chunks bug is fixed at the root — plus honest embed-engine status, visible failures, the finished "Q" rename, an in-conversation web-search toggle, and an operator-authorized clearnet fallback.** From GhostExodus's field report: memory had gone completely empty (Mind's Eye blank, "➕ Add to memory" a no-op, 0 chunks indexed). **Root cause:** the dedicated offline embedding runtime shipped in v3.28.0 was gated on the *chat* model marker (`MODEL_PRESENT`), but the installer ships only the *embedding* marker (the chat model is your own Ollama) — so the gate was always false, the dedicated `nomic-embed-text` runtime on port 11435 never started, and embeddings silently fell back to your chat Ollama, which doesn't have the model → **HTTP 404 → 0 chunks**. Now the embed runtime gates on the **embedding** bundle, so memory runs on the bundled model, offline, independent of your chat Ollama — exactly as v3.28.0 intended. The **embedding-engine status is now honest** (reports "model not loaded" instead of a false "ready"), and embed failures on "➕ Add to memory" and background auto-index are now **visible, plain-language errors** instead of silent no-ops. The **"Q" rename is finished** — the Access (Start) menu now reads **Q**, with a migration so existing installs relabel on update too. The Tor **web-search toggle is now reachable in-conversation** (a compact "Web (Tor)" checkbox in the chat toolbar), not just buried in Settings. And a new **operator-authorized clearnet fallback** (off by default, hard-gated behind `webSearchClearnet`): when a Tor search returns nothing *and* you've explicitly opted in, Q may fall back to a plain-clearnet DuckDuckGo query — Tor-first always, the onion path is **never weakened**, and every clearnet query prints an **unmistakable "⚠ your real IP is exposed" warning** in the chat; clearnet results pass the **same** untrusted-data fence as Tor results. Built subagent-driven with a **parallel adversarial whole-branch review** (0 confirmed findings; the review specifically proved clearnet cannot run when the flag is off and cannot bypass the injection fence). No new egress beyond the opt-in clearnet path; no telemetry. **2,619 automated tests** green (1 skipped); typecheck clean. *Everything from v3.29.0 carries forward.*

**v3.29.0** — **Meet "Q": the assistant gets a name, one-tap voice, and Tor-routed web search.** Three items from GhostExodus's feedback, all scoped to the AI assistant. The assistant is now **Q** (à la 007) across its window title, Help, Welcome, Settings, and default persona prompt — a branding pass, not a behavior change. Voice collapses to a **single latching toggle**: tap **🎤 Talk to Q** for a hands-free conversation (mic stays open; Q listens, answers, and speaks while you read), tap **🔴 Listening — tap to stop** to end it (the Vosk STT + Piper turn-taking engine is unchanged; voice *input* still needs the operator-supplied Vosk model). And Q can now **search the web over Tor** (off by default): enable it and Q emits a `[SEARCH: query]` directive that runs over the bundled Tor SOCKS to **DuckDuckGo's onion service** — onion-to-onion, no exit node, no clearnet, no API key — then answers citing sources; a **hybrid directive loop** (bounded to 3 searches/turn) is used instead of model-native tool-calling so it works with the local abliterated model. Web egress is **`.onion`-enforced and fail-closed** — a non-onion host can never route through a Tor exit node — and results are treated as **untrusted**: wrapped in an unforgeable per-request fence, newline-stripped, and URL-sanitized, closing a prompt-injection surface a **red-team pass** found and fixed before merge. No new clearnet egress, no telemetry. **2,595 automated tests** green (1 skipped); typecheck clean. *Everything from v3.28.0 carries forward.*

**v3.28.0** — **Global scalable memory, on by default, plus Mind's Eye — a visual map of what the assistant remembers.** The assistant's local memory graduates from an opt-in per-conversation feature to a **global, always-on-by-default** system, backed by a **dedicated embedding runtime** (its own bundled, loopback-only Ollama instance, separate from chat) so an embedding failure is now a **loud, actionable error** instead of a silently empty index — the indexer refuses to overwrite a good shard with an empty one. Memory now spans a **global document library**: upload PDF/TXT/MD/DOCX straight into memory via "➕ Add to memory", and the indexer pulls in your **briefcase** and **journal** entries alongside chat, all as first-class memory sources. A new **Mind's Eye** module renders the whole memory pool as an interactive SVG graph — nodes for chat/profile/library/briefcase/journal, similarity auto-edges, a deterministic clustered layout — with curation built into the graph itself: **pin**, **forget**, **merge duplicates**, **resolve a flagged conflict**, and **recall a node straight into chat**. You can also draw (and cut) your own **retrieval bonds** between two items directly in the graph, teaching recall that they belong together even when they aren't lexically similar; every recall hit that used a bond carries that provenance back with it. `useMemory` now defaults to **on** for new installs (existing installs are not force-flipped — the settings merge is additive only); no new network egress, encrypted at rest throughout. **2,582 automated tests** green (1 skipped); typecheck clean. *Everything from v3.27.0 carries forward.*

**v3.27.0** — **Seven items from GhostExodus's field feedback: crash-safety, a Tor-hang fix, a scraper-credential-race fix, per-tool scraping cases with migration, OSINT consolidation, an installer cleanup opt-in, and a Searchlight graph reset.** **(1) Crash-safety** — a module error boundary means no single tool can white-screen the whole app again, and Hosts / News / Camera now open standalone instead of crashing when launched from the Toolkit. **(2) CCTV host-resolution** no longer hangs on Tor bootstrap (fast-fail → a clear "Tor not ready" state) and gains an explicit "resolve camera hosts over Tor" toggle — resolution stays **Tor-only**, never clearnet, so a lookup can't leak your IP. **(3) GhostScrape** runs each scrape job in its **own ephemeral session partition**, so two concurrent jobs can no longer clobber each other's X credentials. **(4) Independent scraping cases** — SOCMINT and X/GhostScrape now have their **own encrypted case stores** with a left-hand Cases sidebar, fully separate from your investigation cases; existing harvested data is relocated by a **one-time, backed-up, idempotent migration**, and an **"Import into a main case"** action pulls results across when you want. **(5) OSINT consolidation** — the OSINT tools move off the desktop into the Toolkit and a **one-hop Access-menu flyout**; the Toolkit window is compact. **(6) Installer** — an **opt-in, default-off** checkbox to remove a previous installation's data. **(7) Searchlight** — reset the entire relationship graph and re-import. Built subagent-driven, each workstream on its own branch with a **parallel adversarial whole-branch review** that caught and fixed real bugs before merge — a cache-poisoning regression, resident X credentials, an off-screen flyout, an installer data-loss on Back/Next, and a migration duplication-on-crash critical. Pre-ship **reachability audit** + **packaged-artifact integrity check**; the runtime pass ships as a **[Windows smoke checklist](docs/guides/v3.27.0-windows-smoke-checklist.md)** (automated Windows-VM smoke still pending an ISO on the build host). **2,535 automated tests** green; typecheck + build clean. *Everything from v3.26.0 carries forward.*

**v3.26.0** — **Four features: adaptive AI memory, GhostScrape (native X timeline scraper), an OSINT Toolkit launcher, and free text-selection in the AI assistant.** **(1) Adaptive Memory** — the assistant's local memory now goes **live** (auto-reindex on save, no more manual snapshot), learns a **local, encrypted, self-updating** profile, and adds a **Memory panel** to inspect / edit / pin / **erase** everything it has learned (including the rolling summary). Off by default; loopback-Ollama only; nothing learned is silent or un-erasable. **(2) GhostScrape** — a new module that scrapes an X user's timeline (tweets / retweets / bio, date-filtered) by driving a **hidden, cookie-authenticated Electron browser** and capturing X's GraphQL; it reuses your X Intel session + the same clearnet gate, stays inside the X clearnet quarantine (no Tor/Telegram link, no new egress), exports JSON/TXT/CSV, and saves to a case (adapted from ZenScraper by 0Day3xpl0it, MIT — reimplemented on native Electron primitives). **(3) OSINT Toolkit** — a folder-style launcher grouping the OSINT tools by category (Social Media / Geospatial / Identity / Network-Recon) into one discoverable home; desktop icon + Access-menu entry. **(4) AI assistant** — click-drag to highlight and copy any part of a message (the right-click Copy menu is unchanged). Built subagent-driven, each feature on its own branch with a parallel adversarial whole-branch review that caught and fixed a charter-level memory-privacy critical + correctness bugs before merge. Pre-ship **reachability audit** + **packaged-artifact integrity check** (all four confirmed present in the shipped `app.asar`); the runtime pass ships as a **[Windows smoke checklist](docs/guides/v3.26.0-windows-smoke-checklist.md)** for now (automated Windows-VM smoke is next cycle). **2,410 automated tests** green; typecheck + build clean. *Everything from v3.25.0 carries forward.*

**v3.25.0** — **Searchlight sweeps survive tab switches; SOCMINT gets a case picker, a visible reason when it's blocked, and an X launcher.** Four casework-blocking papercuts from the field, fixed. **(1) Searchlight sweeps used to vanish** if you left the Sweep tab mid-run or to glance at the Graph — the panel unmounted, and with it the local pointer to which job was on screen, so you'd come back to "No sweep yet" even though the results were still sitting in the case. The selected job is now tracked in the store itself (survives unmount) and a mount-independent stream manager keeps writing results into it whether or not the panel is on screen, so a sweep keeps collecting while you're on another tab and is exactly where you left it when you come back. **(2) SOCMINT's Start Monitor** used to sit disabled with no on-screen explanation — the only "why" was a hover tooltip, which isn't a fix for a busy investigator. It now names the next concrete step in plain language (pick a case, add a channel, enter a burner) directly under the button. **(3) SOCMINT case selection** was a free-text Case ID field — easy to typo, easy to point at a case that doesn't exist. It's now a dropdown of your real, existing cases. **(4) An "X / Twitter ↗" launcher** inside SOCMINT opens the existing X collector window — X stays a quarantined clearnet trust domain in its own window (no embed, no link to the Tor/Telegram transports); SOCMINT itself doesn't gain any new egress. **2,249 automated tests** green; typecheck + build clean. *Everything from v3.24.2 carries forward.*

**v3.24.2** — **Hotfix: the SOCMINT collectors actually collect.** Two social-media intelligence flows looked ready but were broken at the seam between the screen and the engine — and in both cases the main process already accepted the right inputs, so each side looked complete on its own. **(1) X / Twitter** ran every harvest logged-out: the Collect screen never told the collector *which stored account* to use, so the saved `auth_token`/`ct0` cookie was never attached and X answered with near-zero results and instant rate-limiting. The screen now lists your stored accounts (IDs only — credentials never leave the main process), makes you pick one, and threads it through; collection is blocked until an account is chosen so you can't launch a guaranteed-empty logged-out harvest. **(2) Telegram / WhatsApp Start Monitor** was a dead button: the screen asked to start with only the case ID — no burner, no channels, no platform — which the monitor engine requires, so it refused and the screen swallowed the refusal silently. The screen now sends the full request, adds a **Burner ID** field, and surfaces *why* a run didn't start instead of doing nothing. The request-building logic for both flows now lives in small, pure, **unit-tested** modules so neither request can silently drop a required field again. No change to the egress model — X still requires both the network-enable and clearnet-acknowledge confirmations, Telegram/WhatsApp still run through the chosen transport and still fail closed when Tor is selected but unavailable; the fixes only complete requests the safety gates already guard. **2,224 automated tests** green; typecheck + build clean. *Everything from v3.24.1 carries forward.*

**v3.24.1** — **Hotfix: username sweeps work again after upgrading.** On any install carried forward from a build older than v3.23.0, launching a Searchlight **username sweep did nothing** — the panel sat on "No sweep yet" and the action felt unresponsive — and the **Learning** tab was dead. Root cause was a settings-merge gap: the app deep-merges nested settings blocks against their defaults on every read, but the `searchlight` block was missing from that list, so an older saved `settings.json` (which predates the v3.23.0 `scorer` config) **replaced** the default wholesale and left `searchlight.scorer` undefined — the sweep's main-process handler then threw on it and the launch silently aborted. Fresh installs were unaffected, which is why it slipped past the suite and the smoke tests. The fix restores the deep-merge for `searchlight` (and audits in the same-class `chat`, `offensive`, and `x` blocks, which had the same latent gap), plus a fail-safe default in the sweep handler so a missing scorer can never hard-break detection again. Heals existing settings transparently on next launch — no reinstall, no lost data. **2,195 automated tests** green; typecheck + build clean. *Everything from v3.24.0 carries forward.*

**v3.24.0** — **Searchlight learns your casework.** v3.23.0 shipped a detection model that stays off because a generic model only ties the heuristic — and there's no good source of training labels except *real investigative use*. So labeling and training now live **in the app**: a new **Learning** tab plus one-click **👍 Real / 👎 Not real** thumbs on sweep results turn your own verdicts into a personal, **fully-local, encrypted** training corpus. Hit **Train** when prompted and the app retrains a model on your labels (seeded with the Aliens_eye set for a head-start), evaluates it against the built-in heuristic on *your* held-out labels, and — **only if it genuinely beats the heuristic** — recommends turning ML on, which *you* confirm. Nothing trains silently, nothing turns on silently, and the corpus + model **never leave your machine** (zero new network egress). The UI is built for low cognitive load: one clear next action at a time, a bounded "review these" queue of the most useful (uncertain) results, a plain-language verdict ("beats the built-in detector on your cases" — never raw metrics), and a visible progress milestone. **Ships with ML off by design** — it's the *machinery* to earn ML on, locally, from your work; the heuristic keeps doing the soft-404 job the whole time, so you lose nothing while it learns. Built across two plans (engine + UI); the engine reuses the v3.23.0 ML core. **2,190 automated tests** green; typecheck + build clean. *Everything from v3.23.0 carries forward.*

**v3.23.0** — **Searchlight detection scorer — soft-404 false positives, killed.** Username sweeps used to trust HTTP 200, so a site that returns a styled "this account doesn't exist" page (a *soft-404*) was reported as a confident **FOUND**. Searchlight now scores the **uncurated detection tail** structurally: an adaptive **two-phase probe** does a cheap header check first and, only when a bare 200 is genuinely ambiguous, fetches the page body and scores ~25 structural signals — `og:type=profile`, JSON-LD `Person`, username-in-title/canonical, profile-vs-error keywords and DOM shape. A real profile reads as a profile; a soft-404 reads as an error. Results gain a first-class **MAYBE** tier (its own badge, filter chip, and report line) with a confidence %, plus **sortable columns, a live progress bar, and a summary panel**. Curated Maigret sites stay byte-for-byte authoritative — the scorer only engages where Maigret has no per-site rule, so it's *database-maintenance-independent*: it works on custom sites and on sites whose curated strings have rotted. Detection is **zero-config** (deep-scan on by default; nothing to set up), with optional threshold knobs in **Settings → Searchlight**. A new **SITE DB FOLDER** button (Sweep toolbar) opens the writable site-database folder and supports a **fail-safe drop-in `maigret_sites.json` override** (a corrupt override falls back to the bundled DB, so it can never brick detection). A logistic-regression **ML model** (ported from the MIT-licensed [Aliens_eye](https://github.com/arxhr007/Aliens_eye), © 2021 Aaron Thomas, see `THIRD_PARTY_LICENSES`) is **bundled and toggle-able** in Settings but ships **off by default**: it fails its feature-fidelity parity gate because two of its 30 features need a per-site fingerprint cache this release doesn't build — a fingerprint-free retrain is the planned follow-on. The heuristic path that fixes the false positives is independent of the model and ships on. Built subagent-driven (15 TDD tasks) with a parallel adversarial whole-branch review; four confirmed findings fixed before merge. **2,072 automated tests** green; typecheck + build clean. *Everything from v3.22.3 carries forward.*

**v3.22.3** — **X / Twitter collection now works on Windows out of the box.** The Windows `twscrape` sidecar binary — the one piece that couldn't be cross-compiled — is now **built and bundled** in the installer, so the X collector window is no longer "sidecar not installed": it has a real, SHA-256-pinned `twscrape-runner.exe` and its onedir runtime. The binary was produced on a genuine Windows 11 environment (PyInstaller is per-OS — no cross-compilation), verified byte-for-byte against its build hash, and gated at runtime by the existing verify-before-exec check (the app refuses to run a binary whose SHA doesn't match the pin). X remains a **quarantined clearnet trust domain** — separate window, no link to the Tor/Telegram transports — and still gated behind both `settings.x.networkEnabled` and the clearnet acknowledgement, off by default; provisioning burner X cookies is yours. *(macOS sidecar still pending a macOS build host; Linux sidecar was already bundled.)* **1,979 automated tests** green; typecheck + build clean. *Everything from v3.22.2 carries forward.*

**v3.22.2** — **Searchlight Connect-Tor + the X / Twitter collector window.** Two dogfooding gaps from the v3.22.0 SOCMINT activation, closed. **(1) Searchlight Tor:** a Tor-mode sweep used to report **"TOR NOT READY"** for every site whenever the bundled Tor hadn't been bootstrapped by the chat module — Searchlight never started Tor itself. It now shows a clear **"Tor is not connected"** notice with a one-click **Connect Tor** button (and a reminder that ticking *Direct (clearnet)* sweeps without Tor); the no-silent-clearnet invariant is unchanged — Tor mode still fails closed, the button just lets you start Tor explicitly. **(2) X / Twitter:** the X collector window was built in v3.22.0 but never registered, so there was no way to open it. It is now a launchable window (Start menu + desktop), separate from the SOCMINT window by design (X is a quarantined clearnet trust domain — the import-graph sentinel still forbids any link between X and the Tor/Telegram transports). The **twscrape sidecar** is now bundled by the packager when present. **Honest platform note:** the X sidecar binary is per-OS and cannot be cross-compiled — the **Linux** sidecar is built and SHA-pinned, but **this Windows build ships without an X sidecar**, so the X window opens and reports **"sidecar not installed"** until you build it on Windows (`scripts\build-twscrape-runner.bat`) and pin its SHA. Built subagent-driven (4 tasks) with a parallel adversarial whole-branch review that caught a broken channel-contract test (fixed) before merge. **1,979 automated tests** green; typecheck + build clean. *Everything from v3.22.1 carries forward.*

**v3.22.1** — **Searchlight readability fix.** The **Sweep results** and **Reports preview** tables now render on the intended **midnight-purple** surface with readable text, instead of white. Root cause was a CSS cascade bug: the bundled `98.css` paints every native `<table>` white, which sat on top of (and hid) the dark results container, so both tables read as white regardless of the container color. The fix restates the dark surface on the table's *class* selectors — which win on specificity — and lifts the few text colors (not-found URL, site name) that were only legible against the accidental white. Cosmetic only; no behavior, dependency, or security-surface change. **1,972 automated tests** green; typecheck + build clean. *Everything from v3.22.0 carries forward.*

**v3.22.0** — **SOCMINT activated: Telegram, WhatsApp, and X collectors, live and gated.** The three SOCMINT collectors are now wired live into the gated IPC with their real libraries — **Telegram** (`@mtcute/node` MTProto, public-channel join-then-filter), **WhatsApp** (`@whiskeysockets/baileys`, monitoring-only, pairing-code link), and **X/Twitter** (`twscrape` via a quarantined Python sidecar) — all feeding the shared encrypted `HarvestedItem` pipeline (per-case store, exact-id dedup, local-Ollama relevance ranking, analyst labels). Egress is **off by default** and **gate-before-egress is adversarially verified**: no collector connects, and no Baileys socket is constructed, before the network gate. Transport is **fail-closed** — Tor mode refuses when Tor is down (never a silent clearnet fallback) and routes via **`socks5h://`** so hostnames resolve *inside* the circuit (no DNS-deanonymization side-channel), with per-burner `IsolateSOCKSAuth` isolation; secrets live only in the encrypted `secretStore`, never echoed. Baileys is **supply-chain pinned** against the genuine package (not the Dec-2025 `lotusbail` clone). Built and hardened over multiple subagent-driven passes whose adversarial whole-branch reviews caught and fixed a real **Tor DNS-leak** and an **un-stoppable-circuit leak** before release. **Honest scope:** mock-tested + boot-verified (both ESM-only libs load in the packaged main with no `ERR_REQUIRE_ESM`), but **not** live-smoked against the real platforms — bring your own burner accounts; the X sidecar binary is operator-built. **1,972 automated tests** green; typecheck + build clean. *Everything from v3.21.0 carries forward.*

**v3.21.0** — **Batch 2 refinements — plus CCTV-over-Tor streaming.** Searchlight gains midnight-purple readability, the **SEARCHLIGHT** rename (Dashboard + report headers), a **dependency-free PDF report export** (native `printToPDF` — report export, not an in-app viewer), and a **Load Custom DB** button (the full Maigret corpus is already bundled). GeoINT adds a per-row **remove** button to Monitored Situations and a new **Settings → GeoINT** pane surfacing the encrypted **AIS API key**; the keyless **ADS-B** aircraft feed **remains active** and now **retries with exponential back-off**, surfacing a readable status instead of a raw HTTP 429 (the earlier error was ADS-B rate-limiting, not AIS). The headline: **view CCTV streams over Tor** — a `ga98cctv://` privileged-scheme proxy routes camera streams (HLS / HTTP / MJPEG / MP4) through a main-process Tor SOCKS handler, no direct CDN egress, HLS manifests rewritten in-proxy (with body content-sniffing so a hostile host can't bypass it); YouTube/webpages/RTSP are not Tor-routable and show a notice instead of clearnet; **TOR NOT READY** with no fallback when Tor is down; the `<webview>` lockdown is untouched. Built subagent-driven (Tasks 1–5 + redesign R1–R4) with a parallel **adversarial whole-branch review** that caught and fixed an HLS-deanonymization hole before merge. **1,393 automated tests** green; typecheck + build clean. *Everything from v3.20.0 carries forward.*

**v3.20.0** — **Searchlight, refined: the full Maigret corpus, offline favicons, and your own sites.** Searchlight now ships the **complete 3,166-site Maigret database** — engine-backed sites are resolved at parse time, so the ~1,000 sites that inherit their check logic from a shared engine probe correctly instead of returning false negatives. Each result can show the site's **favicon** from a **bundled offline snapshot** (~1,270 icons) — zero runtime egress, no third-party favicon proxy. Add individual sites with a one-field **Add custom site** form (persisted encrypted, exportable as `sites.json`). A dedicated **Settings → Searchlight** pane holds the master network toggle (still **off by default**), and Searchlight now appears in the **Start menu** with a first-run intro card. The **Whiteboard** tab was **removed** (and its `react-rnd` dependency dropped); dropdowns and report buttons are restyled midnight-purple for readability on the dark canvas. **GeoINT** now opens its timeline on **all events** (the scrubber still works) and supports **right-click → Add to Monitor** on any situation-feed item, persisted across sessions through the vault. **EyeSpy** Add-Stream now takes **latitude / longitude**, which flow into the master CCTV export. Built subagent-driven over 14 TDD tasks with a parallel **adversarial whole-branch review** that caught and fixed an engine-placeholder probe bug before merge. **1,336 automated tests.** *Everything from v3.19.0 carries forward.*

**v3.19.0** — **Searchlight: username-sweep OSINT, Tor-first.** A new top-level **Searchlight** module: enter a username and sweep it across a bundled **1,433-site Maigret database** to find where that handle exists. The sweep runs **through Tor by default** (a clearly-labelled per-sweep **"Direct (clearnet)"** opt-out for sites that hard-block Tor exits), entirely in the main process, and is gated behind a new master network opt-in that is **off by default** — nothing leaves the machine until you turn it on. Results stream in live, Maigret-aware (status-code / page-text presence-absence / redirect heuristics) and bucketed into **Found / Not found / Redirect / Blocked / Error**, so an anti-Tor **403/429** reads as *blocked*, never a false *not found*; if Tor isn't up yet you get a clean **"Tor not ready"** rather than a wall of connection errors. Around the sweep are five more tabs: a **Dashboard**, an SVG **relationship graph** (drag/zoom/pan, auto-import found hits), an **infinite whiteboard** (drag-drop files + sticky notes), **Reports** (HTML / CSV / JSON / TXT export), and its own **Cases** with `.gic` import/export. Everything persists **encrypted at rest** through the vault (no plaintext on disk); imported `.gic`/Maigret `data.json` is **sanitised at the trust boundary** (arrays/types coerced, `javascript:` image payloads dropped) and the generated HTML report is **fully XSS-escaped** with scheme-guarded links. Bring your own site list by importing a Maigret `data.json`. The renderer makes **no network calls**; one new dependency (`react-rnd`); no telemetry. **1,317 automated tests.** *Everything from v3.18.1 carries forward.*

**v3.18.1** — **GeoINT map-popup ✕ polish.** The coordinate/pin popup's close button is now a small **bordered square** with a centered ✕, vertically centered on the pill, sitting in a reserved right-hand gutter so the coordinates can never run under it (it previously read as a wide button bleeding over the text). Renderer CSS only; everything from v3.18.0 carries forward.

**v3.18.0** — **Live ADS-B aircraft and AIS ships on the GeoINT globe.** Two new toggleable real-time layers in GeoINT: **Live Aircraft (ADS-B)** polls [adsb.lol](https://adsb.lol) (free, no key, ODbL) every ~15 s and renders viewport-bounded aircraft as color-coded circle pins by altitude band (ground / low / mid / high); **Live Ships (AIS)** streams from [AISStream.io](https://aisstream.io) (free WebSocket, user-supplied API key) and renders viewport-bounded vessels at up to ~2 s cadence with 10-minute prune. Both layers are in the new **Live Feeds** panel in the left rail (below Space Satellites), disabled until the GeoINT network gate is on; AIS additionally requires a stored API key (same encrypted-key UX as FIRMS/UCDP — store once, key never re-echoed to the renderer). Toggling either layer off or leaving the module clears the feed and stops all traffic. The AIS WebSocket runs exclusively in the main process; the renderer receives only parsed positions over IPC (no CSP `connect-src` change, no renderer socket). New egress hosts: `api.adsb.lol` (REST) and `stream.aisstream.io` (WSS) — both hard-pinned, gated on the existing network opt-in. ADS-B data © adsb.lol contributors (ODbL). **1243 automated tests.** **Everything from v3.17.1 carries forward.**

**v3.17.1** — **Hotfix: GeoINT no longer crashes on load.** v3.17.0 could throw **"Style is not done loading"** and drop GeoINT into its error screen (Reset couldn't recover): the new Space Satellites layer called MapLibre's `addSource` before the map style had finished loading — synchronously at init and from a `styledata` event that fires mid-load. Satellite-layer creation is now guarded by `isStyleLoaded()` and driven off the `load` + a self-guarded `styledata` event, so it only ever adds the source once the style is ready (and still survives basemap/network toggles). Renderer-only; everything from v3.17.0 carries forward.

**v3.17.0** — **Space Satellites on the GeoINT globe.** A new toggleable **Space Satellites layer** in GeoINT: tick **"Show Space Satellites (N)"** and every active satellite in the offline TLE snapshot drops a real-time SGP4-propagated pin on the 3D globe, color-coded by type (Starlink, GPS, weather, comms, earth-obs, space stations, scientific, other). The layer boots from a bundled offline TLE snapshot (no network needed on first toggle); enable the GeoINT network and hit **Refresh** to pull a live catalogue from CelesTrak for the group of your choice (Active Satellites, Starlink, GPS, Space Stations, etc.). Add or paste-import your own TLE sets via the **Space Satellite Manager** panel alongside — user satellites merge with the snapshot on load. A sortable, filterable table shows the propagated set (name, type, altitude, velocity, inclination) with **Track / Center / Details** row actions and a **Export…** JSON download. Per-type checkboxes filter both the table and the globe. Refresh without network enabled toasts guidance rather than fetching. No new egress beyond `celestrak.org`, already behind the existing GeoINT network opt-in. This release also **actually fixes the GeoINT map popup** that v3.16.3 tried to: that "fix" tied MapLibre's own CSS on specificity and lost on load order, leaving a white box with near-invisible coordinates — the popup is now an **opaque black card with light-grey, unobstructed coordinates and a minimal square ✕** (specificity-correct, so it wins regardless of import order). **1226 automated tests.** **Everything from v3.16.3 carries forward.**

**v3.16.3** — **Field-fix polish: the assistant stops voicing markdown, and the GeoINT map ✕ finally shrinks.** Three cosmetic fixes from the field. **(1) Spoken markdown** — the assistant's Piper/character voices no longer read formatting markers aloud (`**`, `*`, `` ` ``, `#`, `-`): the spoken text now passes through the *same* in-house markdown stripper the on-screen renderer uses, so what you hear matches what you see. **(2) GeoINT popup ✕** — the map pin/popup close button was overlapping the coordinate readout despite two prior sizing passes; root cause was a CSS scope (`.ga98-geo-right`) that never actually matched the popup, so MapLibre's oversized default ✕ kept rendering. The popup styling is now scoped globally to MapLibre's own classes (GeoINT is the only MapLibre surface), so the tight dark card + small ✕ apply for real, clear of the coordinates. **(3) Bug reports** — RTFM gains a "Found a bug?" line with a contact address. No crypto/data/protocol/egress change; renderer + CSS only. **1207 automated tests.** *Everything from v3.16.2 carries forward.*

**v3.16.2** — **Character voices.** The assistant's offline Piper voice now ships with four selectable **character voices** alongside the public-domain default — **Jarvis, HAL 9000, GLaDOS, and Wheatley** — pickable from the voice dropdown in the assistant's TTS controls. The default stays **LJ Speech (public-domain)**, so out-of-the-box behavior is unchanged; the character voices are opt-in. Each bundled voice is **SHA-256 pinned** at build time (fail-closed — a tampered model never ships) and the piper binary keeps its verify-before-exec gate; voice selection is resolved **traversal-safe in the main process** (an invalid pick falls back to the default). You can still add **your own** voices via the v3.16.1 Voices folder. The installer grows to ~837 MB to carry the four extra voices; no runtime network, no telemetry. *Everything from v3.16.0 carries forward.*

**v3.16.1** — **Bring your own TTS voice.** The AI assistant's Piper (offline neural) voice is no longer limited to the one bundled voice: drop your own `<name>.onnx` + `<name>.onnx.json` Piper voice pair into a **Voices** folder and pick it from a dropdown in the assistant's voice controls. A **📁 Voices** button opens the folder (created on first click); the picker lists every valid voice you've added alongside the bundled neural default. Voice selection is resolved **traversal-safe in the main process** (a malicious/garbage selection can never load a model outside the Voices folder — it falls back to the bundled voice), the bundled piper binary keeps its verify-before-exec hash gate, and your voice files are **local only** — nothing is bundled or downloaded, no telemetry, no new network path. *Everything from v3.16.0 carries forward.*

**v3.16.0** — **Live News pop-out, manual CCTV coordinates + export, and a readable AI assistant.** Four field-driven additions. **(1) Live News pop-out** — pick a Live News feed in GeoINT and pop it into its own draggable Win98 window (the `⧉` button beside the feed); open as many as you like, and re-popping the same feed re-focuses its window. **(2) Manual CCTV coordinates** — the EyeSpy "Set location…" right-click now takes a **Latitude** and **Longitude** for a single camera (validated, both-or-neither, clear to remove); the camera then drops a pin on the GeoINT map. **(3) Export CCTV** — a new **"Export CCTV…"** button in the EyeSpy finder writes your whole camera library back out to a `master_CCTV.json` in the same `Country → Region → City → {stream_url, coordinates}` shape the importer reads, so coordinate edits are portable and round-trip. **(4) Readable AI assistant** — the bundled assistant's replies now render as real **bold/italics/bullets/headings** (emojis pass through) instead of raw `**`/`#` symbols, via a safe in-house renderer (no new dependency, no HTML injection); a **"Formatted assistant output"** toggle in Settings (default on) returns to plain text if you prefer. Also a follow-up GeoINT fix: the map popup's **✕ is shrunk again** to a clean upper-right square after the v3.15.0 sizing wasn't tight enough. Coordinate range-gating is enforced main-side (the trust boundary); no telemetry, no new egress host, no CSP change. **1167 automated tests.** *Everything from v3.14.0 carries forward.*

**v3.15.0** — **CCTV cameras on the GeoINT map.** A new toggleable **CCTV camera layer**: tick **"CCTV cameras (N)"** in GeoINT and every catalogued camera with coordinates drops a clustered pin on the map — dense areas (e.g. London) collapse to a Win98 count badge that splits into individual camera pins as you zoom in. Click a camera pin to pop a small draggable **camera window** that plays the live feed (reusing the EyeSpy player); up to 8 windows at once, re-clicking a pin re-focuses its window. The layer reads straight from your EyeSpy library (the coordinates the v3.14.4 importer now lands), is **off by default**, and renders without enabling the GeoINT network — playback is the same direct view EyeSpy already does. Also two GeoINT polish fixes from the field: the map popup's **✕ is sized to match the window title-bar button** (was oversized), and the **left command rail now collapses** to a thin strip (« / ») so the map can use the full width. The camera layer is a pure view over local data — no telemetry, no new network path, no CSP change. *Everything from v3.14.0 carries forward.*

**v3.14.4** — **EyeSpy import: `stream_url` + nested coordinates (patch).** GhostExodus's coordinate-bearing CCTV scrapes (the insecam/TfL "by country" dump shape) imported **zero** cameras: every leaf used a `stream_url` key and a nested `coordinates: {latitude, longitude}` block, neither of which the importer recognized, so all feeds were dropped before categorization. The importer now accepts `stream_url` as a URL key and reads lat/lon from a nested `coordinates` object (flat `lat`/`lon` still win when both are present). Verified end-to-end against the real files: **0 → 2,555 cameras** import, 2,469 carrying coordinates, all filed under their country. This also unblocks the upcoming CCTV-pins-on-GeoINT-map feature, which needs lat/lon in the stream store. Main-process parser change only; geo-less and flat feeds behave exactly as before. *Everything from v3.14.0 carries forward.*

**v3.14.3** — **EyeSpy "All Cameras" finder polish (patch).** A GhostExodus field batch on the finder: a **⊟ Collapse all** button (closes every expanded country/region in one click), the location tree and feed list now **share the pane evenly** (was 40/60), the camera-feed **right-click menu no longer hides behind the taskbar** (its bottom items — Set location…, Delete — stay reachable when right-clicking a feed low in a long list), and slightly **larger finder text**. Renderer-only; no backend, IPC, or data change. *Everything from v3.14.0 carries forward.*

**v3.14.0** — **first stable release of the 3.14 line** — out of beta; the entire `beta.1 → beta.21` series is folded in and field-tested. EyeSpy bulk import now ingests a **nested Country → Region → City JSON tree**, so a large scraped-by-country camera dump imports **fully categorized** in one shot (filed under the finder tree) instead of landing flat and "Ungeocoded." New **`docs/EYESPY_IMPORT_FORMAT.md`** documents every accepted format (flat JSON array, nested tree, header CSV, URL list) and the Import button links to it. Everything from beta.20 carries forward — EyeSpy feed right-click menu clamps into the window; **GeoINT** command stack stays on-screen and map "blips" don't stack overlapping ✕ buttons; EyeSpy ➕ Add-new-feed tile reliably clickable; **Mail** select-and-copy plus an app-wide right-click **Cut / Copy / Paste / Select All** menu. Built on the copyright-safe brand art (custom "G" mark, no Microsoft Windows flag).
**new app icon + logo** and beta.12's
**rename to Ghost Intel 98** (automatic data migration on first
launch — existing cases, settings, and the encrypted vault carry forward). Otherwise identical to beta.11's
**GhostExodus field-fix batch** on top of the GeoINT reimagine: an
outer-space starfield behind the globe + translucent-dark map popups, a responsive GeoINT layout, EyeSpy
fit-to-screen tiles + double-click + **YouTube camera feeds** + a fixed "Add new feed" wall flow, and a
Mail chime that finally fires from inside the app — now **user-replaceable** (Settings → open the sounds
folder, drop in your own jingle). The beta.10 work it builds on:

- **GeoINT reimagined as a 3D command center.** A **3D MapLibre globe** replaces the flat map (toggle back to
  flat in-app; Leaflet is retained as a fallback this release). A **command-center rail** (Global Threat View,
  Monitored Situations, Visual Imagery, Situation Feed) and **live threat layers** — USGS earthquakes, GDACS,
  GDELT-DOC, war-tracker, ReliefWeb, UCDP free/no-key + NASA FIRMS / gdeltcloud / UCDP keyed (key in the OS
  keyring), plus a **CISA KEV** advisory sidebar. New **JSON Feed** source type + feed images, and a **Live
  News panel** (HLS + sandboxed YouTube). Each layer is honestly labeled by authority and attribution.
- **DialTerm — local shell (opt-in, default off).** Run a local cmd/PowerShell terminal; enabling requires a
  native confirmation dialog. (Ships dark/feature-flagged — the native terminal backend lands in a follow-up
  Windows build.) Custom host ports survive protocol changes.
- **Mail.** Fixed the "You've got mail" chime (proven audio loader; Settings has a Test button) and added an
  **opt-in background mail poller** — chime + Win98 toast even when the Mail window is closed.
- **EyeSpy.** Unlimited cameras (scrollable, column-configurable wall — no 3×3 cap) + a **Refresh tiles** button.
- **My Cases / shell.** Category collapse state persists (defaults collapsed); Share/Import moved beneath
  New/Rename; Journal Jots / GeoINT / Markets / Jukebox moved to the programs menu.

A combined red-team pass (4 adversarial reviews) fixed a local-shell enable-bypass, a cross-origin redirect
credential leak, a shell session-id validator, an EyeSpy wall-persistence truncation, and an RSS
coordinate-integrity gap. ~1057 automated tests. *Everything from v3.14.0-beta.9 carries forward.*

<details><summary>v3.14.0-beta.9 — GeoINT geo-XML formats + Mail actions</summary>

- **GeoINT KML / GPX / generic XML sources.** Add a `.kml` or `.gpx` feed URL and Point placemarks /
  waypoints become map pins (coordinate-range guarded). A new **XML (custom)** source type accepts any
  structured XML feed via a dot-path field map (itemsPath / lat / lon + optional title / summary / link /
  date) — so feeds that are neither RSS/Atom nor GeoJSON can still become pins.
- **Mail: Star, Forward, Delete, Print.** Each open message now has an action row. **Star (★)** toggles the
  IMAP `\Flagged` flag and shows in the inbox list. **Forward** opens Compose pre-filled with `Fwd:` subject
  and a quoted body. **Delete** moves the message to the Trash folder (recoverable from webmail). **Print**
  opens the native OS print dialog with a clean plaintext rendering of the message (HTML body is not used —
  XSS-safe by design).

879 automated tests. *Everything from v3.14.0-beta.8 carries forward.*

</details>

<details><summary>v3.14.0-beta.7 — GhostExodus beta.6 field-test punch-list</summary>

- **GeoINT** crash-proofing (error boundary + Purge cache), 1,500-marker cap, default Google tiles, floating
  **Play Story** transport. **Mail Send** always reachable + 30s refresh. **Bookmarks** cards auto-fit links.
  **EyeSpy** **Webpage** kind (opens viewer pages in bundled Firefox) + toolbars no longer scroll off.
  **Cases** **categories** (collapsible grouped sections, right-click to move). 810 tests.

</details>

<details><summary>v3.14.0-beta.6 — GeoINT intelligence map + EyeSpy Wall Setup + Mail notifications</summary>

- **GeoINT** becomes an intelligence map. The offline gazetteer grew **250 country names → ~61.7k cities**,
  so RSS/Atom articles that name a city now **auto-pin** (this is the fix for "feeds not showing"). Markers
  are **colored by category** (conflict/cyber/protest/disaster/crime/politics) and sized by severity;
  events corroborated by **≥2 distinct sources** glow; a **timeline scrubber** plays events over time;
  **story mode** walks a set of events as a shareable briefing; search drops a 📌. (`Places © GeoNames CC-BY`.)
- **EyeSpy — Wall Setup:** **New** configures a board by **Country/State/City** and can **import a whole CCTV
  file into that category**; **Rename** now actually works.
- **Mail:** silent background **auto-refresh** + an **audio notification** only when new mail arrives.
- Internal: a security-hardening pass on the not-yet-shipped offensive-egress capability (no user-facing change).

</details>

<details><summary>v3.14.0-beta.5 — GeoINT map fix (no ghost box / drag catch)</summary>

A targeted render-wiring fix: the GeoINT map stopped flashing a "ghost box" in the centre and catching on click-drag (the event list rebuilt every render → marker thrash + a recenter loop; fixed by memoizing + splitting the focus step). **712 tests.**

</details>

<details><summary>v3.14.0-beta.4 — EyeSpy finder + curated 3×3 wall</summary>

The EyeSpy redesign: a **finder** (Countries/Cities tabs, global search, flag + count per node, a feed list whose rows right-click to *Add to active square / Play / Edit / Set location / Delete*) and a **curated 3×3 wall** of named, persisted boards (click a square active, right-click a feed to drop it in; "＋ Add new feed" empty tile; "as of <time>" header; × to clear). One contextual Import button ("Import to London…"), Set location to file a bare archive into the tree. Replaced the beta.3 auto-grid. **712 tests.**

</details>

<details><summary>v3.14.0-beta.3 — EyeSpy location grid (superseded by the beta.4 wall)</summary>

A left-sidebar Country→State→City tree with rolled-up counts, search, and a live tile grid (capped at 9, lazy-mounted) for the selected node, with "Import here" location stamping and per-tile delete. **704 tests.** *Superseded by the beta.4 finder + curated wall.*

</details>

<details><summary>v3.14.0-beta.2 — boot-fix re-release of beta.1 (the packaged app launches)</summary>

beta.1 crashed at boot with `ERR_REQUIRE_ESM` because the new ESM-only chat-crypto module (`@noble/ciphers`) was being `require()`'d from the CommonJS main bundle; beta.2 inlines it. The feature set is the beta.1 dogfooding punch-list — a new journal app, two audio/crypto fixes, and module polish:

- **Journal Jots** — a new password-protected (4-digit PIN) journal app. Entries are consolidated inside the
  app (they don't land in the Briefcase) and are encrypted at rest with everything else under the optional
  vault login. The PIN is a rate-limited lock over that already-encrypted storage — a convenience gate, not
  the encryption boundary (the vault is).
- **Chat invite-accept fix.** The Tor P2P chat's message encryption moved to a runtime-independent
  implementation of the same cipher, resolving an "Unknown cipher" failure that broke accepting invites on
  packaged builds (the algorithm and wire format are unchanged).
- **Piper TTS no longer plays as static.** Piper now writes its audio to a seekable temp file instead of a
  stdout pipe, so the WAV length headers are correct and the player stops decoding garbage over the voice.
  (The Microsoft voices were always clean; this was Piper-specific.)
- **EyeSpy** gains a Purge-all button, lets you edit an existing stream in place, and now imports geo
  metadata (city / lat / lon / country / source) from a **header-mapped CSV**, not just JSON.
- **Jukebox** opens at a sensible size and gains a collapse/expand toggle for a compact "just the deck" view.
- **DialTerm** drops the redundant touch-tone dialpad animation, going straight to the AOL-style dial-up client.
- **Mail** account-setup dialog now closes properly (it could trap you when no account was configured yet);
  **Notepad 98** can delete entries.

690 automated tests. *Everything from v3.13.3 carries forward.*

</details>

**v3.13.3-beta.1** — New lightning boot splash + Win9x loading bar:

- **New boot splash + loading bar.** The startup screen is now the higher-resolution "Welcome Ghost Intel 98"
  lightning render (the prior grayscale logo was pixelated at full screen), with a Win9x-style scrolling
  blue-block loading bar and a *Starting Ghost Intel 98…* caption playing under it while the startup jingle sounds,
  then fading to the login screen. The bar is **indeterminate by design** (boot work — auth check + settings
  load — is near-instant) and respects `prefers-reduced-motion`. Purely presentational.

505 automated tests (unchanged). *Everything from v3.13.2 carries forward — reconnect hardening verified, chat out of EXPERIMENTAL.*

**v3.13.2-beta.1** — Reconnect hardening verified — chat leaves EXPERIMENTAL — plus a Win98 boot splash and theme polish:

- **Tor P2P chat: reconnect path formally verified; the EXPERIMENTAL banner is gone.** This closes the two
  remaining internal audit findings on the handshake — **HIGH-1** (a dropped reconnect could permanently
  strand a contact, recoverable only by a fresh out-of-band invite) and **MED-2** (reconnect had no formal
  model and no DoS pre-gate). Reconnect now self-heals in-band (an authenticated `prekey_unknown` Reject +
  one bounded retry), is DoS-gated by a per-contact keyed MAC with an enforcement bootstrap and a
  split/deduped rate-limiter, and keeps its gate key **stable per epoch**. It is verified to the same
  standard as first-contact: **ProVerif** symbolic (reconnect + Reject — injective I-auth-R, recovery
  soundness, downgrade/substitution resistance) and **CryptoVerif** computational (`mac_R` gate
  unforgeability). The design cleared three independent adversarial-review passes before implementation.
  The in-app **EXPERIMENTAL / "not formally verified" banner is removed**; the handshake is now formally
  verified *internally* — an **independent external audit and a FIPS module remain the only unmet gates**,
  so the build does not claim "externally audited" or "FIPS-validated."
- **Win98 boot splash.** A Ghost Intel 98 startup screen (the grayscale storm/flame logo) now plays before the
  login screen while the startup jingle sounds, then fades to the desktop.
- **New default wallpaper.** The desktop default is now the blue 256-color-era Ghost Intel 98 scene. Only the
  default changes — any wallpaper you set yourself is untouched.
- **Date/Time desktop widget** (analog + digital, draggable, opt-in) and **game renames** — Minesweeper →
  **Mine Detector**, Pinball → **Ghost Space Ball**.

505 automated tests. *Everything from v3.13.1 carries forward (incl. the corrected pinball geometry).*

**v3.13.1-beta.1** — Pinball playability fix + formal-verification milestone:

- **Pinball geometry corrected.** The v3.13.0 flippers were too close for their length — they overlapped,
  leaving **no center drain gap**, and the assembly was off-center. Re-centered with a real ~1.5-ball drain
  gap; **slingshots** now hug the flippers (no slip-through dead zone); and **inlane/outlane guide rails**
  turn the open sides into a flipper-feeding inlane and a narrow drain. *(Physics feel — gravity, flipper
  strength, kicks — may still be tuned in a follow-up.)*
- **Chat handshake formal verification advanced.** The **CryptoVerif** hybrid bound is now proved (both
  legs): the session root key is indistinguishable from random if **either** X25519 (CDH) **or** ML-KEM
  (IND-CCA2) survives — alongside the completed ProVerif symbolic run. This is the key-schedule core, not
  the full wire protocol end-to-end, so the handshake **stays EXPERIMENTAL / not formally verified** (an
  end-to-end model, external audit, and FIPS build remain). Banner unchanged.

454 automated tests. *Everything from v3.13.0 carries forward.*

**v3.13.0-beta.1** — Dogfooding feedback turned into features:

- **Search results are clickable.** A hit on a note opens that note in Notepad, a file hit opens the
  document viewer, a metadata hit opens the case — straight to the exact result.
- **Chess vs the computer.** New 2-player / vs-computer toggle, pick White or Black, and Easy / Medium /
  Hard (alpha-beta search). The board flips when you play Black. Engine extracted + unit-tested.
- **Pinball rebuilt as a Space-Cadet-style table** (was Pong-like): power plunger, energetic slingshots,
  pop bumpers, a drop-target bank, rollover lanes that rank you up (Cadet → Fleet Admiral), a ramp combo,
  a **wormhole lock → multiball**, fast tip-velocity flippers, a space theme, and synthesized SFX.
  *(Physics feel still wants an interactive tuning pass.)*
- **Local AI memory (offline RAG).** Opt-in: the assistant recalls relevant notes, file text, entities,
  and past conversations from your own corpus and cites them — a local vector index, served over
  **loopback only**, **encrypted at rest** in your vault, with **deterministic** retrieval and zero
  telemetry/egress. Enable + rebuild the index under **Settings → Case Memory**. The embedding model
  (`nomic-embed-text`, ~262 MB) ships **in the installer**; it goes live through the local-AI runtime
  (the bundled runtime, or any Ollama you already run on `127.0.0.1:11434` with the model pulled). *(The
  bundled model is why this installer is larger.)*

454 automated tests. The chat handshake construction is **unchanged** and **remains EXPERIMENTAL / not
formally verified** (see below). *Everything from v3.12.x carries forward.*

**v3.12.1-beta.1** — Security patch from an adversarial (black-team) pass on the v3.12.0 chat crypto:

- **Fixed (HIGH): one-time prekey double-consume.** Under the engine's concurrent inbound dispatch, a peer
  replaying the handshake's first message on two streams could get the *same* one-time prekey served to two
  sessions — a post-quantum-forward-secrecy / replay regression. Now reserved atomically on lookup and
  released on abort (with a regression test).
- **Hardening:** the ML-KEM sidecar rejects oversized frames and kills a wedged helper; the helper zeroizes
  the decryption secret key + shared secrets; chat-enable is serialized (no orphaned processes on a
  double-trigger); and the helper-binary SHA-256 verify-before-exec is now live.
- **Honesty:** corrected code comments that called the ML-KEM helper "FIPS-validated" — the shipped Windows
  helper is a functional **non-FIPS** build (the FIPS-validated module is a CI follow-up).

The chat handshake **construction** held up under the black team (hybrid soundness at ML-KEM-1024, KEM-tamper
caught by AEAD key-confirmation) but **remains EXPERIMENTAL / not formally verified** — a black team finds
attacks, it cannot prove their absence; clearing that flag requires the ProVerif + CryptoVerif proofs and an
external audit. 435 automated tests.

**v3.12.0-beta.1** — a large one — post-quantum hardening, games, and case tooling:

- **PQ hardening — ML-KEM-1024 via AWS-LC.** The chat handshake's ML-KEM leg moves from the
  unaudited pure-JS ML-KEM-768 to **ML-KEM-1024** (CNSA 2.0 / FIPS-203 category 5), served by a native
  **AWS-LC** sidecar behind a fail-closed seam in `crypto.ts` — addressing the implementation
  side-channel + parameter-strength gaps that formal verification can't see. The handshake construction
  is unchanged and still **EXPERIMENTAL / not formally verified**. *(The Windows installer bundles a
  functional cross-built helper; the FIPS-validated module build is a CI follow-up — see release notes.)*
- **Games.** **Minesweeper**, **Chess** (full legal-move engine — castling, en passant, promotion,
  check/checkmate/stalemate), and a Win98-style **Pinball**, grouped under a new Access **"Games ▸"**
  submenu (off the desktop).
- **Case evidence migration.** Four buttons in the case detail — **Copy Evidence / Zip Files / Export to
  Desktop / Import Case** — for moving cases + their evidence between app users.
- **ExifTool metadata.** Rich attachment metadata in the ⓘ panel via an optional bundled ExifTool.
- **RTFM Hacktivist Ethos** content ("The Ten Nodes of Hacktivism", by GhostExodus), **whiteboard tile
  colours**, and a **chat first-run guide** (Don't-show-again).

434 automated tests. *Everything from v3.11.x and earlier carries forward unchanged.*

**v3.11.1-beta.1** — Fixes invisible checkboxes:

- **Checkboxes are visible again.** 98.css draws a checkbox's box via an `input + label` sibling
  element and hides the real input; Ghost Intel 98's checkboxes nest the input inside the label, so the box
  never drew — every checkbox (Settings, GeoINT, Mail TLS, case tasks, …) rendered as a label with no
  visible box. They still toggled when you clicked the text, but there was nothing to see. A single CSS
  rule restores a real, visible control. This is what made the new **Legacy sound pack** toggle look
  missing in v3.11.0.

429 automated tests. *Everything from v3.11.0-beta.1 (opt-in Legacy sound pack + uninstall fix) and
earlier carries forward unchanged.*

**v3.11.0-beta.1** — Optional Legacy sound pack + an uninstall fix:

- **Legacy sound pack (opt-in).** A new **Settings → Sound** toggle swaps the startup chime and the
  DialTerm dial-up for **AI-reworked recordings of the classic Windows startup jingle and dial-up
  handshake**. **Off by default**; the synthesized sounds remain the default. These two clips are the
  only bundled audio in the app, and they are **derivative works of their originals** — shipped as a
  deliberate, opt-in choice. When Legacy dial-up is on, the connection client's stage stepper and log
  are paced to the clip's length.
- **Fixed: the uninstaller could fail after enabling chat.** The app spawns a bundled `tor.exe` for
  P2P chat; the on-quit teardown that kills it ran in an `async` handler Electron didn't wait for, so
  the process could orphan and hold a file lock inside the install directory, breaking uninstall. Quit
  now blocks on teardown (bounded by a timeout) before exiting. *(Already-stuck installs: end any
  `tor.exe` in Task Manager, then uninstall.)*

429 automated tests. *Everything from v3.10.0-beta.1 (DialTerm dial-up client + authentic handshake)
and earlier carries forward unchanged.*

**v3.10.0-beta.1** — DialTerm gets a dial-up *client* and an authentic handshake:

- **Ghost Intel 98 dial-up connection client** — the DialTerm connecting screen is now a familiar dial-up-client
  layout: a **Ghost Intel 98 logo header**, a three-panel **DIAL → LINK → AUTH** stage stepper (with a little
  walking "marcher" in the active panel and ✓ on completed stages) and an AOL-style status caption —
  wrapped around the existing uplink **packet animation** and the live negotiation log. Ghost Intel 98-branded,
  no third-party marks.
- **Authentic dial-up handshake** — the DialTerm connect sound is rebuilt to follow a real V-series
  sequence: **dial tone → DTMF dialing → 2100 Hz answer + V.8 "bong" → V.21 negotiation → echo-cancel
  tone → V.34 line-probe "gallop" → scrambled-data roar**, beat-locked to the packet animation so the
  stage stepper, log, and audio advance together. Still **fully synthesized at runtime** from functional
  telephony / V-series frequencies — no sampled or copyrighted assets.

429 automated tests. *Everything from v3.9.1-beta.1 (Notepad icon + reworked startup/hang-up sounds),
v3.9.0-beta.1 (photo-embedding case reports, RTFM left-rail manual) and v3.8.0-beta.1 (experimental Tor
P2P chat, offline Piper TTS) carries forward unchanged.*

**v3.9.1-beta.1** — a look-and-feel pass:

- **New Notepad desktop icon** — a hand-drawn Windows-98-style spiral notepad (teal header, ruled
  page, spiral binding) replacing the generic glyph, in the same crisp-pixel style as My Computer.
- **Reworked sounds (all still synthesized at runtime — no sampled assets):** a warmer, more
  synthetic power-on swell; a fuller dial-up **handshake** in DialTerm whose tones are **beat-synced
  to the uplink connect animation** (each data chirp lands as a packet crosses the link, and the
  negotiation log reveals on the same beat); and a new **hang-up** sound — a legacy handset dropped
  back onto its cradle.

429 automated tests. *Everything from v3.9.0-beta.1 (photo-embedding case reports, RTFM left-rail
manual) and v3.8.0-beta.1 (experimental Tor P2P chat, offline Piper TTS) carries forward unchanged.*

**v3.9.0-beta.1** — two refinements on top of the v3.8.0 feature set:

- **Case reports now embed photos.** Exporting a case (Export… → **HTML** or **PDF**) inlines the
  case's **bio images** and any **image attachments** directly in the report, instead of just listing
  attachment names. Images are decrypted in the main process and embedded as `data:` URIs (the only
  thing the offline, script-disabled PDF renderer can show); a 24 MiB total / 8 MiB per-image budget
  keeps reports from ballooning, and anything skipped is footnoted.
- **RTFM is now a left-rail manual.** The Help (RTFM) window gained a sidebar: **Manual**
  (shortcuts + module reference + privacy), **OpChildSafety** (lifted into its own page),
  **Hacktivist Ethos**, and **OSINT**. The last two are live nav slots with placeholder pages —
  content from GhostExodus to drop in.

429 automated tests. *Everything from v3.8.0-beta.1 (experimental Tor P2P chat, offline Piper TTS)
carries forward unchanged.*

**v3.8.0-beta.1** — two big additions, both opt-in:

- **P2P chat over Tor** (⚠ **EXPERIMENTAL** — the PQ-hybrid handshake crypto is **not yet formally
  verified**; a loud in-app banner says so, and it's off by default). Invite-link **1:1** with an
  X25519 + ML-KEM-768 handshake (no hosting, loopback-only sockets), plus **file attachments**
  (whole-file SHA-256 verified before anything touches disk, received files held in an encrypted-at-rest
  quarantine with an explicit Save step), **small groups** (client-side fan-out — *zero new
  cryptography*; each message rides your existing 1:1 sessions), and **case-aware sharing** (a 📤 action
  on case entities and attachments sends them straight into a chat). Each phase was adversarially
  red-teamed and authorization-hardened.
- **Offline neural TTS (Piper)** — a bundled, fully-offline voice (`en_US-ljspeech-high`, **public-domain**
  LJ Speech dataset) as a selectable engine in the AI assistant, default when present, with the OS /
  Web-Speech path retained as fallback. Synthesizes locally, model bundled → **zero runtime egress**.

424 automated tests. *Bundled Tor + Piper binaries are fetched + SHA-256-verified (fail-closed) at
build time; see `scripts/fetch-tor.mjs` / `scripts/fetch-piper.mjs`.*

**v3.7.0-beta.1** — first cut of the experimental Tor-only P2P chat (invite-link 1:1; PQ-hybrid
handshake; bundled SHA-256-verified Tor). Superseded by v3.8.0-beta.1.

**v3.6.8** — a new **OpChildSafety** section in **RTFM** (Help) — field guidance for
grassroots child-protection / OSINT investigators on reporting CSAM lawfully through the proper
channels (NCMEC, IWF, CEOP, HSI, ACCCE, Cybertip.ca, Europol IRU, INHOPE, NCA) **without** viewing,
downloading, or mishandling material, plus evidence-handling do's and don'ts. Reference content only;
official reporting links open in your OS browser. Contributed by GhostExodus.

**v3.6.7** — a proper in-app **exit**. The Access (Start) menu now has a
**Shut Down…** entry (with a confirm) that quits the app cleanly — previously the only way out was the
native title-bar X, which a Win98-style shell trains you not to look for. Also: the **GeoINT** left
menu is a little wider so the View row and event titles no longer clip.

**v3.6.6** — a **warmer, lower startup chime** (an original synthesized power-on
swell — no sampled assets), and two **TTS voice-picker** fixes. The on-device voice selector no
longer **silently disappears** when no eligible voice is found — it now says *why* (cloud voices are
blocked by design; install Windows Natural voices) — and voice discovery is now **live**, so voices
that the OS populates after launch (or a freshly installed voice pack) appear without a restart.

**v3.6.5** — the **AI can now read PDF case attachments**. PDFs were previously
rejected as binary; the assistant now extracts the PDF **text layer** (offline, through the same
pdf.js engine the viewer uses — no OCR, no network) and folds it into case context, under the same
remote-egress confirmation and size caps as every other attachment. Also: **sticky notes are now
resizable** — drag the grip in a note's bottom-right corner; the size persists per note.

**v3.6.4** — the **in-app PDF viewer renders again** (it relied on a JS method
Electron 33's Chromium doesn't ship yet; v3.6.4 polyfills it). This cleared the v3.6.3 known issue.

**v3.6.3** added **desktop polish** — the **Ghost Intel 98 flame wallpaper** as the default background,
desktop icons in a single **vertical left-edge column**, an authentic Win95 **My Computer** icon for
**My Cases**, and a **draggable sticky-notes bar** that no longer overlaps the window minimise/close
buttons.

**v3.6.2** added **Solitaire** (Klondike, with full card drag-and-drop and the classic
bouncing-card win cascade), in the Access menu.

**v3.6.1** added the **Briefcase** (standalone text notes not tied to any case — browse them in the
Briefcase app or save straight there from Notepad 98), GeoINT **street-name labels** + a one-click tile
**Reset**, and **Shred** pinned to the bottom-right corner like the Recycle Bin.

**v3.6.0** renamed the program from **Ghost Access 98** (with automatic data migration from the
old install) and cleared a full field-report punch list:

- **Sticky Notes** *(new module)* — a Win95-style desktop note layer (drag, type, pick icon + color),
  fired reminders rendered as notes, and a global Hide.
- **AI conversation memory** *(new)* — a ChatGPT-style sidebar of saved chats: new / resume / delete,
  auto-saved; plus **right-click to copy** a message or the whole conversation, and a default model of
  `qwen3-abliterated:4b`.
- **GeoINT** — **Street View**, a proper **Load** button for custom tiles, "Street" renamed **2D Map**,
  and a map that resizes correctly.
- **Markets** — a first-run intro popup with "Don't show again."
- **Fixes** — minimizing a window no longer wipes its state (the **Jukebox keeps playing**, the **AI
  conversation and Notepad text survive**); **Mail** connects (provider
  presets, STARTTLS, app-password guidance) and the Compose window can always be closed; **My Cases** no
  longer shows the previous case's identity when you switch; the **Calendar** off-by-one is fixed with a
  right-click delete; the **Jukebox** double-pause is gone; **Bookmarks** scale to their link count; and
  **Net Explorer** gains an "Open the Firefox folder" button.

Migration carries an existing **Ghost Access 98** install's data forward on first launch (copy-not-move,
and only committed if every file copies — no silent loss). Every release is hardened by a pre-release
adversarial red-team (**0 Critical**; all High/Medium fixed). **254 tests.**

The v3.5.0 base added a **Markets** module, a stronger **GeoINT** (satellite, search, auto-refresh), and
**in-app playback of encrypted media**. v3.4.x added **offline voice conversation** to the AI Assistant —
on-device Vosk STT + OS TTS, fully local. See [Releases & changelog](#releases--changelog) and
[`SECURITY.md`](SECURITY.md).

## Install on Windows (recommended)

Download the latest installer from the [Releases page](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases) and run it.

Direct link to the current release: [`GhostIntel98-Setup-3.50.1.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/download/v3.50.1/GhostIntel98-Setup-3.50.1.exe)
(Tor P2P chat + Piper TTS; the chat handshake is **formally verified internally** — symbolic (ProVerif) +
computational (CryptoVerif), internally adversarially reviewed; **not** independently audited and **not**
FIPS-validated — see Status). The last fully-stable build is [`GhostIntel98-Setup-3.6.8.exe`](https://github.com/Obsidian-Circuit-LLC/ghost-intel-98/releases/download/v3.6.8/GhostIntel98-Setup-3.6.8.exe).

**Verify the download** before running it — compare its SHA-256 against the value in the release notes:

```powershell
Get-FileHash .\GhostIntel98-Setup-3.50.1.exe -Algorithm SHA256
# compare against the SHA-256 printed in that version's release notes
```

The installer is **unsigned** (no code-signing certificate yet), so SmartScreen will warn on first run — click **More info → Run anyway**. The app installs per-user (no admin required) and creates a desktop + Start menu shortcut.

To uninstall: Settings → Apps → Ghost Intel 98 → Uninstall.

## Modules

| Module | Purpose |
|---|---|
| My Cases | Create, open, rename, archive, delete cases; per-case dashboard with timeline / tasks / links / reminders / attachments / **entities (Family/Associates/Other)** / **bio photos** / **GeoINT events**; **document viewer**, **exports** (PDF/HTML/CSV), and **backup/share** |
| Sticky Notes | Win95-style draggable desktop notes — text, a chosen icon and color; **fired reminders appear as notes** (OK to clear); a global **Hide**. Persists, encrypted at rest, zero network |
| Briefcase | Standalone text notes not tied to any case — browse/edit/delete them here, or pick **💼 Briefcase** in Notepad 98's selector to save straight in. Encrypted at rest, zero network |
| Doc Viewer | In-app viewer for case attachments — PDF, DOCX, HTML, images, CSV, JSON, EML, text (sanitized; no remote fetches) |
| Search | Cross-case search over metadata, entities, and extracted attachment text; exportable results |
| Whiteboard | Per-case pannable/zoomable canvas — text/image/file/link nodes + connectors |
| **Markets** | Offline-first market overview — crypto (CoinGecko), FX (Frankfurter/ECB), indices/equities/commodities (Yahoo); editable watchlist + bring-your-own custom feeds. Network is **opt-in** (off by default); 60s auto-refresh while on |
| **Jukebox** | Win98 CD-Player audio player — local **MP3 / OGG / FLAC / WAV / M4A** + **M3U** playlists, spectrum visualizer; internet radio is **opt-in** (off by default). Local files are served through a path-confined internal protocol |
| **GeoINT** | Pluggable geopolitical-monitoring dashboard — **RSS / Atom / GeoJSON / KML / GPX / XML** sources + **OPML** import, a **MapLibre GL globe** (**2D** custom tiles, **Satellite**, **Street View**), offline **gazetteer** geocoding + manual pins. Network is **opt-in** (off by default). Save an event into a case as a record / link / note. **Space-satellite layer** (CelesTrak default behind the GeoINT network opt-in + offline snapshot; add/import your own TLEs). **Live ADS-B aircraft** (adsb.lol, ODbL) + **AIS ships** (AISStream.io, your key) behind the network opt-in — viewport-bounded, ~15 s / ~2 s cadence, both gated off by default |
| **Bookmarks** | Offline start.me-style link dashboard — **category cards** of named links you organize by **dragging** (cards auto-scale to their link count); per-link icon of your choice (glyph / emoji / **consent-gated favicon**); **Share** the whole board as a portable `.ghostbookmarks` file |
| Notepad 98 | Plain text editor — saves notes into a case, or into the **Briefcase** when "💼 Briefcase" is picked in the selector |
| Solitaire | Klondike card game — full drag-and-drop, foundations A→K, Draw 1/3, double-click-to-foundation, and the classic bouncing-card **win cascade**. Self-contained, offline, zero data |
| Calendar | Month grid surfacing case + global reminders and task due dates; right-click a reminder to delete it |
| Reminders / Alarm | Case-linked reminders + general alarms; native notifications + synthesized chime; fired reminders surface as desktop sticky notes |
| Shred | Soft-delete bucket — restore or purge |
| Settings | Sound, theme intensity, startup sound, image/colour wallpaper, default case folder, Access shortcut editor, AI / Mail / Browser providers, and **Security** (enable/disable login, change password, lock now, recovery key) |
| Access Menu | Editable program + web-link shortcuts |
| Net Explorer | **Firefox Portable launcher** — opens URLs in a bundled Firefox (you supply the payload in `resources/firefox/`; an **"Open the Firefox folder"** button takes you straight there); bookmark bar + save-URL-to-case retained |
| Mail | IMAP/SMTP client (imapflow + nodemailer) with provider presets + app-password guidance, encrypted credentials, synthesized "You have mail" alert |
| DialTerm | SSH / Telnet / FTP client (ssh2 + xterm.js) with a 90s dial-up handshake animation; key-based auth preferred; passwords encrypted at rest; plaintext-protocol warnings |
| EyeSpy | Authorized camera streams — manual URL entry **and bulk import** (CSV/JSON/URL-list) of your own/public feeds (HLS / MJPEG / HTTP refresh; RTSP requires a local ffmpeg→HLS bridge). **No discovery / scanning / brute-force code paths exist** |
| AI Assistant | Pluggable Ollama (local, default model `qwen3-abliterated:4b`) / OpenAI-compatible providers, with an in-app **"Set up local AI"** wizard; **saved-conversation memory**; case context opt-in per message; API keys encrypted. **Offline voice conversation** — push-to-talk + hands-free, **on-device Vosk** STT (model operator-supplied in `resources/vosk/`) and on-device **TTS** for replies; **STFU** stops generation. TTS has a bundled offline **Piper** neural-voice engine (selectable alongside OS voices; zero egress) |
| **Chat** *(beta)* | Opt-in **Tor-only P2P chat** — invite-link **1:1** with a PQ-hybrid X25519 + ML-KEM-1024 handshake (no hosting, loopback-only sockets), **file attachments** (hash-verified, encrypted quarantine + explicit save), **small groups** (client-side fan-out), and **case-aware sharing** from the case module. The handshake (first-contact **and** reconnect) is **formally verified internally** — symbolic (ProVerif) + computational (CryptoVerif, 12/12 models "all queries proved") — and internally adversarially reviewed. It is **not** independently audited and **not** FIPS-validated; those two external gates remain outstanding. Off by default. Bundled SHA-256-verified Tor (`resources/tor/` via `scripts/fetch-tor.mjs`) |

## Releases & changelog

The current build is **v3.15.0** (first stable line since v3.6.x). Each release page carries its own notes + SHA-256.

- **v3.15.0** — **CCTV cameras on the GeoINT map.** A toggleable CCTV camera layer: "CCTV cameras (N)" drops clustered camera pins (Win98 count badges that split into pins as you zoom) for every catalogued camera with coordinates; clicking a pin opens a small draggable window playing the feed (reuses the EyeSpy player; max 8 windows, re-click re-focuses). Reads the EyeSpy library directly, off by default, renders without enabling the GeoINT network (playback is the same direct view EyeSpy does). Plus two GeoINT polish fixes: the map popup ✕ is sized to the window title-bar button, and the left command rail collapses to a thin strip (« / ») to give the map full width. Pure view over local data — no telemetry, no new network path, no CSP change. 1099 automated tests; typecheck clean.
- **v3.14.4** — **EyeSpy import: `stream_url` key + nested `coordinates`.** GhostExodus's coordinate-bearing CCTV scrapes (insecam/TfL "by country" dumps) imported zero cameras because each leaf used a `stream_url` key and a nested `coordinates: {latitude, longitude}` block the importer didn't recognize. The importer now accepts `stream_url` and reads lat/lon from a nested `coordinates` object (flat `lat`/`lon` win when both present). Verified against the real files: 0 → 2,555 cameras (2,469 with coordinates), all filed under their country. Unblocks the CCTV-pins-on-GeoINT-map feature. Main-process parser change only. 1076 automated tests; typecheck clean.
- **v3.14.3** — **EyeSpy "All Cameras" finder polish.** A GhostExodus field batch: a **⊟ Collapse all** button, an **even 50/50 split** between the location tree and the feed list, the camera-feed **right-click menu clamps above the taskbar** (its bottom items stay reachable on long lists), and **larger finder text**. Renderer-only; no backend/data change. 1071 automated tests; typecheck clean.
- **v3.14.2** — **Chat-verification wording corrected to match the formal record.** v3.14.1 mistakenly described the CryptoVerif computational proof as "in progress"; the internal formal kit in fact reproduces **12/12 CryptoVerif models "all queries proved"** (CryptoVerif 2.12) plus ProVerif 4/5, with a three-pass internal adversarial review. The README and the in-app Chat info panel now read: **formally verified internally (symbolic ProVerif + computational CryptoVerif), internally adversarially reviewed; not independently audited and not FIPS-validated** (the two remaining external gates). The chat's EXPERIMENTAL banner stays off — its removal is supported by the reproduced proofs.
- **v3.14.1** — **Docs: chat-verification wording (superseded by v3.14.2).** Intended to correct the chat wording but under-stated the CryptoVerif proof state; v3.14.2 fixes it. No code changes; app identical to v3.14.0.
- **v3.14.0** — **First stable release of the 3.14 line.** Promotes `beta.21` to a production build with no code changes — the full GeoINT command-center redesign, EyeSpy finder + bulk-import (incl. nested geo-tree JSON), Mail copy/paste + background poller, the Tor P2P chat, and the GhostExodus field-test fixes (beta.1 → beta.21) are all folded in and field-tested. 1071 automated tests; typecheck clean. See the per-beta entries below for the detailed feature history.
- **v3.14.0-beta.21** — **EyeSpy bulk-import: nested geo-tree JSON + documented format.** The feed importer now walks a nested `Country → Region → City → [urls]` JSON tree and files every leaf under the finder tree, so a large scraped dump imports fully categorized in one pass (verified on a 1,644-feed / 65-country list). New `docs/EYESPY_IMPORT_FORMAT.md` documents all accepted shapes (flat JSON array, nested tree, header CSV, URL list); the Import button tooltip links to it.
- **v3.14.0-beta.20** — **EyeSpy right-click menu fix.** The camera-feed context menu now clamps fully into the window, so its bottom items (**Set location…**, **Delete**) are reachable even when right-clicking a feed low in a long list (previously they fell below the window edge). Follow-up to beta.19.
- **v3.14.0-beta.19** — **GhostExodus field-test batch.** **GeoINT:** the right command stack no longer overflows the window edge (clipping the Live-News Add-stream controls), and map "blips" no longer stack overlapping ✕ close buttons — one popup open at a time. **EyeSpy:** the **➕ Add new feed** tile is a real, reliably-clickable button and every empty tile now opens the Add form. **Mail:** message text is selectable/copyable and an app-wide right-click **Cut / Copy / Paste / Select All** menu was added (local clipboard only — no egress, no telemetry).
- **v3.14.0-beta.18** — **"You've got mail" chime fixed.** The default chime was a 192 kHz WAV the renderer couldn't decode (silent since beta.12) — re-encoded to standard 44.1 kHz PCM, and installs holding the old file are auto-repaired on launch. Command-rail scrollbar clipping re-fixed via right padding (more reliable than `scrollbar-gutter`).
- **v3.14.0-beta.17** — Boot-splash caption overlap fixed; GeoINT command-rail scrollbar overlap fixed; added the missing **Settings → Mail → "Check for new mail in the background"** toggle so the new-mail chime fires with the Mail window closed.
- **v3.14.0-beta.16** — **Copyright-safe brand art.** All theme images (wallpaper, boot/login splash, logo, app icon) redrawn with the custom "G" hexagon mark instead of the Microsoft Windows flag. Login/lock screen now uses the boot "Welcome" splash as its backdrop.
- **v3.14.0-beta.15** — Boot splash caption shortened to "Starting…" (the name is already in the splash art). Art/text only.
- **v3.14.0-beta.14** — **New boot/login splash + default wallpaper** (Ghost Intel 98 brand art). Art only; no code changes from beta.13.
- **v3.14.0-beta.13** — **New Ghost Intel 98 app icon + logo** (window/installer/Start-button icon and the in-app logo). Brand art only; no code changes from beta.12.
- **v3.14.0-beta.12** — **Renamed to Ghost Intel 98.** Product/display name, window titles, installer, and
  shortcuts are now Ghost Intel 98 (new app identity `com.ghostintel.ghostintel98`). On first launch the app
  automatically migrates your existing data directory forward, so cases, settings, sticky notes, and the
  encrypted vault are preserved. No feature changes vs. beta.11. **~1064 tests.**

- **v3.14.0-beta.11** — **GhostExodus field-fix batch.** **GeoINT:** an offline starfield space background
  behind the 3D globe, translucent-dark map popups (with the close button no longer overlapping the title),
  and a responsive 3-column layout so the left controls stop clipping on a non-maximized window. **EyeSpy:**
  camera tiles + the double-click expanded view now fill the frame (centered, contained) instead of
  letterboxing; **YouTube** is a supported camera kind (sandboxed youtube-nocookie); and the wall "Add new
  feed" tile now places the feed onto the wall instead of targeting the last-selected slot. **Mail:** adds a
  **Reply** button (it previously had only Forward); the "You've got mail" chime now fires from inside the
  app on new mail (de-duped against the background poller), and the chime is **user-replaceable** — Settings
  → Sound → *Change chime* opens a sounds folder where you drop in your own `.wav`. Default chime refreshed.
  Post-build code hygiene: removed the now-dead Leaflet map fallback (the 3D globe has been the only map
  since beta.10). **~1064 tests.**
- **v3.14.0-beta.10** — **GeoINT reimagine + beta.9 field feedback.** A big two-part release. **GeoINT** is
  reimagined as a 3D command center: a **MapLibre globe** (default; flat Leaflet map retained as an in-app
  fallback), a command-center rail (Global Threat View / Monitored Situations / Visual Imagery / Situation
  Feed), and **live threat layers** (USGS, GDACS, GDELT-DOC, war-tracker, ReliefWeb, UCDP free/no-key; NASA
  FIRMS / gdeltcloud / UCDP keyed via the OS keyring; CISA KEV advisory sidebar) — each honestly labeled by
  authority + attribution and all behind the off-by-default GeoINT network gate. Adds a **JSON Feed** source
  type + feed images and a **Live News** panel (HLS + sandboxed YouTube). **DialTerm** gains an opt-in,
  native-dialog-gated **local shell** (cmd/PowerShell; backend ships feature-flagged) + custom host ports.
  **Mail** fixes the "You've got mail" chime and adds an opt-in **background mail poller** (chime + Win98
  toast with the window closed). **EyeSpy** removes the 3×3 cap (scrollable, column-configurable wall) +
  **Refresh tiles**. **My Cases / shell**: persistent (default-collapsed) category state, Share/Import moved
  beneath New/Rename, and Journal Jots / GeoINT / Markets / Jukebox moved to the programs menu. A combined
  red-team pass (4 reviews) fixed a local-shell enable-bypass, a cross-origin redirect credential leak, a
  shell session-id validator, an EyeSpy wall-persistence truncation, and an RSS coordinate-integrity gap.
  **~1057 tests.**
- **v3.14.0-beta.9** — **GeoINT geo-XML formats + Mail actions.** **GeoINT** gains three new feed types:
  **KML** (Point placemarks, coordinate-range guarded), **GPX** (waypoints via `@_lat`/`@_lon` attributes),
  and a generic **XML (custom)** source whose dot-path field map (itemsPath / lat / lon + optional title /
  summary / link / date) turns any structured XML feed into map pins — with prototype-pollution-safe path
  walking and gazetteer geocoder fallback when coordinates are absent. **Mail** gains a per-message action
  row: **Star (★)** toggles the IMAP `\Flagged` flag and persists in the inbox list; **Forward** opens
  Compose pre-filled with `Fwd:` subject + quoted body; **Delete** moves the message to the server's Trash
  folder (special-use `\Trash` detected first, then common names, never permanent); **Print** opens the
  native OS dialog with a clean, XSS-escaped plaintext rendering (the HTML body is intentionally not used).
  All four actions are IPC-validated (uid sanitisation + flag allowlist). **879 tests.**
- **v3.14.0-beta.8** — **GhostExodus beta.7 field-test fixes.** **Mail retrieval** now fetches the **newest**
  messages by IMAP sequence instead of the oldest-unseen slice — a full inbox of unread alerts no longer
  buries a just-arrived message below the cap (the "can send but can't receive" report). **EyeSpy** gains a
  **Detect format** button: it probes a pasted camera URL, identifies the real format, and rewrites a bare
  viewer-page URL to the actual MJPEG/JPEG/HLS endpoint so the feed plays inline (a bounded, user-triggered,
  concurrency-capped direct request to the camera host — the same egress as viewing it; it deliberately
  reaches LAN cameras). **GeoINT** recovery now also **resets the saved GeoINT settings** — the one poisoned
  state that survived both reinstall and cache-purge — and the error screen **surfaces the real exception
  on-device** (no telemetry) so a stuck map can be diagnosed rather than guessed. The new egress probe
  cleared an adversarial red-team (concurrency cap, redirect/deadline bounds). **845 tests.**
- **v3.14.0-beta.7** — **GhostExodus beta.6 field-test punch-list.** **GeoINT** is crash-proof with a way
  out: a bad/oversized source (e.g. a FIRMS GeoJSON with an unreplaced `{MAP_KEY}`) can no longer take the
  map down, an **error boundary** + a **Purge cache** button recover a poisoned state that used to survive
  reinstall, markers cap at 1,500 with a count banner, default tiles are Google road tiles, and the **Play
  Story** transport floats over the map. **Mail's Send** button is always reachable (dialogs scroll, action
  row pinned) and the silent refresh is now **30s**. **Bookmarks** cards **auto-fit their links** again (the
  accidental height-freeze is gone). **EyeSpy** gains a **Webpage** kind that opens a camera viewer page in
  the bundled Firefox, and its toolbars no longer scroll off. **Cases** gain **categories** (collapsible
  grouped sections, right-click to move). Built subagent-driven; the GeoINT hardening and the webpage kind
  each cleared an adversarial red-team — which caught the first crash-fix wrapping the wrong layer (a
  call-stack overflow above the error boundary) and an iframe approach that would have holed the renderer
  CSP the plugin trust model depends on. **810 tests.**
- **v3.14.0-beta.6** — **GeoINT intelligence map + EyeSpy Wall Setup + Mail notifications.** GeoINT becomes
  an intelligence map: the offline gazetteer grew **250 country names → ~61.7k cities** so city articles
  **auto-pin** (the fix for "feeds not showing"), markers are **colored by category** and sized by severity,
  events corroborated by **≥2 sources** glow, a **timeline** plays events over time, **story mode** walks a
  set as a shareable briefing, and search drops a 📌. Built TDD with an adversarial pass that caught a
  geocoder that mislocated common-word prose (fixed: English-dictionary blocklist + capitalization gate +
  self-validating guard) and an O(n²) corroboration freeze (fixed: spatial bucketing). EyeSpy gains a
  **Wall Setup** dialog (configure New by Country/State/City, import a CCTV file into that category, rename
  that actually works); Mail gains **silent auto-refresh + a new-mail audio notification**. Plus an internal
  security-hardening pass on the not-yet-shipped offensive-egress capability. `Places © GeoNames (CC-BY)`.
  **801 tests.**
- **v3.14.0-beta.5** — **GeoINT map fix.** The GeoINT map no longer flashes a "ghost box" in the centre or
  catches when you click-drag to pan. Both were one bug: the event list was rebuilt as a fresh array every
  render, so the marker layer cleared+rebuilt on every pan frame and the "recenter on the focused event"
  step drove a recenter→re-render→rebuild **loop** (re-opening the focused popup in the centre). Fixed by
  memoizing the list and splitting the recenter into its own focus-only effect. No change to GeoINT's data,
  sources, or network gate — purely render wiring. **712 tests.**
- **v3.14.0-beta.4** — **EyeSpy redesign: finder + curated 3×3 wall.** Replaces the auto-filling grid (which
  flooded when pointed at a large archive) with two surfaces — a **finder** (Countries/Cities tabs, global
  search, **flag + count** per node, a feed list whose rows **right-click** to *Add to active square / Play /
  Edit / Set location / Delete*) and a **curated 3×3 wall** of nine slots you build deliberately (click a
  square active → right-click a feed to drop it in; the empty slot is the "＋ Add new feed" tile; an honest
  "as of <time>" header; × to clear). **Named walls** persist (save/open/rename/delete); the two redundant
  import buttons collapse into **one contextual Import** ("Import to London…" when a node's selected);
  **Set location** files a bare archive into the tree. Built TDD with an adversarial review pass (fixed a
  wall-save race, a Cities-tab filter that silently showed all cameras, and ghost slots from deleted feeds).
  Also a source-hygiene fix: control-stripping regexes in `validate.ts` + two test files used raw control
  bytes (read as binary, broke text tooling) — now escapes, with a CI guard. No discovery/scanning. **712 tests.**
- **v3.14.0-beta.3** — **EyeSpy location grid.** EyeSpy becomes a location-organised camera wall: a
  **Country → State/Region → City** sidebar tree with rolled-up per-node camera counts (variable depth —
  UK Country→City, US Country→State→City; location-less cameras bucket under "Ungeocoded"), a **search box**
  over tree + grid, and a **live tile grid** for the selected node — tiles stream live but are **capped at 9
  concurrent** and lazy-mounted (over-cap/off-screen tiles show a click-to-play poster; the cap also bounds
  connections over Tor). **"Import here"** stamps a selected location onto geo-less feeds; a per-tile **×**
  deletes a stream. Built TDD with an adversarial review pass (fixed a decoder leak, a stale-selection-after-
  import bug, and a geo-name delimiter corruption before merge). No discovery/scanning. **704 tests.**
- **v3.14.0-beta.2** — **Build-fix re-release of beta.1: the packaged app now launches.** beta.1 crashed at
  boot (`ERR_REQUIRE_ESM`) because the new ESM-only chat-crypto module (`@noble/ciphers`) was being
  `require()`'d from the CommonJS main bundle; it is now inlined (added to electron-vite's
  `externalizeDepsPlugin` exclude list). Feature set unchanged from beta.1; every beta.1 fix — including the
  chat invite-accept fix it couldn't boot to deliver — is now exercisable on a real install. **690 tests.**
- **v3.14.0-beta.1** — **Dogfooding punch-list.** New **Journal Jots** app (4-digit-PIN-locked personal
  journal, entries vault-encrypted at rest, kept out of the Briefcase); **chat invite-accept fix** (message
  encryption moved to a runtime-independent cipher implementation, clearing an "Unknown cipher" failure on
  packaged builds — algorithm/wire format unchanged); **Piper TTS static fix** (synth to a seekable temp file
  so the WAV headers are correct — no more static over the voice); **EyeSpy** purge-all + edit-a-stream +
  **geo-aware CSV import** (city/lat/lon/country/source); **Jukebox** default size + collapse toggle;
  **DialTerm** drops the dialpad animation; **Mail** setup-dialog close fix; **Notepad 98** entry delete. **681 tests.**
- **v3.13.3-beta.1** — **New lightning boot splash + Win9x loading bar.** The startup screen is now the
  higher-resolution "Welcome Ghost Intel 98" lightning render (the prior grayscale logo was pixelated), with a
  Win9x-style scrolling blue-block loading bar and a *Starting Ghost Intel 98…* caption under it, then a fade to the
  login screen. Indeterminate by design (boot work is near-instant); respects `prefers-reduced-motion`.
  Purely presentational — everything from v3.13.2 carries forward. **505 tests.**
- **v3.13.2-beta.1** — **Reconnect hardening verified; chat leaves EXPERIMENTAL; Win98 boot splash.**
  Closes audit findings **HIGH-1** (reconnect could permanently strand a contact) and **MED-2** (reconnect
  had no formal model / no DoS pre-gate): reconnect now self-heals in-band (authenticated Reject + one
  retry), is DoS-gated by a per-contact keyed MAC (enforcement bootstrap + split/deduped rate-limiter) with
  a stable-per-epoch gate key, and is verified to first-contact standard — **ProVerif** symbolic
  (reconnect + Reject) + **CryptoVerif** computational (`mac_R` unforgeability), after three adversarial
  review passes. The **EXPERIMENTAL chat banner is removed** (handshake formally verified internally;
  external audit + FIPS the only unmet gates). Also: a **Win98 boot splash** before the login screen, a new
  blue **256-color default wallpaper**, a **Date/Time** desktop widget, and game renames (**Mine Detector**,
  **Ghost Space Ball**). **505 tests.**
- **v3.13.1-beta.1** — **Pinball playability fix + formal-verification milestone.** Corrected the pinball
  flipper geometry (v3.13.0 flippers overlapped → no drain gap); slingshots now hug the flippers and
  inlane/outlane guide rails replace the open sides. Separately, the **CryptoVerif** hybrid IND-of-RK
  proof landed (both legs: RK secret if **either** X25519 or ML-KEM holds) — key-schedule core only. **454 tests.**
- **v3.13.0-beta.1** — **Dogfooding features.** Clickable search results (jump to the exact note/file/case);
  **Chess vs computer** (pick side + Easy/Medium/Hard alpha-beta); **Pinball rebuilt** into a Space-Cadet-style
  table (power plunger, slingshots, drop targets, rank ladder, wormhole **multiball**, SFX); and **offline AI
  Case Memory** (opt-in local vector RAG over notes/files/entities/conversations, bundled embedding model,
  loopback-only, encrypted at rest). Chat handshake unchanged + still EXPERIMENTAL. **454 tests.**
- **v3.12.1-beta.1** — **Security patch (black-team remediation).** Fixes a **HIGH** one-time-prekey
  double-consume TOCTOU in the chat handshake (concurrent inbound replay could reuse a one-time prekey —
  a PQ-FS/replay regression; now reserve-on-lookup + release-on-abort, with a regression test), plus
  sidecar hardening (oversized-frame reject, wedged-helper kill, live SHA-256 verify-before-exec), helper
  secret-zeroize, serialized chat-enable, and corrected FIPS comments (the Windows helper is a non-FIPS
  build). Construction held up but stays EXPERIMENTAL / not formally verified. **435 tests.**
- **v3.12.0-beta.1** — **PQ hardening + games + case tooling.** Chat's ML-KEM leg → **ML-KEM-1024 via an
  AWS-LC native sidecar** (CNSA 2.0 / FIPS-203 cat 5), fail-closed behind `crypto.ts`; construction
  unchanged + still EXPERIMENTAL (Windows bundles a functional cross-built helper; FIPS module = CI
  follow-up). **Games:** Minesweeper, Chess (full legal-move engine), Win98 **Pinball**, under a new
  Access **"Games ▸"** submenu (off the desktop). **Case migration:** Copy Evidence / Zip Files / Export
  to Desktop / Import Case buttons. **ExifTool** attachment metadata (optional bundled binary). RTFM
  **Ten Nodes of Hacktivism** content, **whiteboard tile colours**, **chat first-run guide**. **434 tests.**
- **v3.11.1-beta.1** — **Fix: invisible checkboxes.** 98.css hides the native checkbox and redraws it
  via an `input + label` sibling element; Ghost Intel 98 nests the input inside its label, so the box never drew
  and every checkbox (Settings incl. the new Legacy sound pack toggle, GeoINT, Mail TLS, case tasks, …)
  rendered with no visible control — they toggled on a text-click but looked absent. One CSS rule in
  `98.overrides.css` restores a real, visible control app-wide. CSS-only. **429 tests.**
- **v3.11.0-beta.1** — **Optional Legacy sound pack + uninstall fix.** A new **Settings → Sound** toggle
  (off by default) swaps the startup chime and DialTerm dial-up for **AI-reworked recordings** of the
  classic Windows startup jingle + dial-up handshake — the only bundled audio in the app, and
  **derivative works** of their originals (shipped as a deliberate opt-in). When Legacy dial-up is on,
  the connection client's stepper/log pace to the clip length. **Fix:** the bundled `tor.exe` (P2P chat)
  could orphan on quit and lock the install dir, breaking the uninstaller — quit now blocks on teardown
  before exiting (already-stuck installs: end `tor.exe` in Task Manager, then uninstall). **429 tests.**
- **v3.10.0-beta.1** — **DialTerm dial-up client + authentic V-series handshake.** The connecting screen
  is now a familiar dial-up-*client* layout — **Ghost Intel 98 logo header**, a three-panel **DIAL → LINK → AUTH**
  stage stepper (walking "marcher" + ✓ on completed stages) and an AOL-style status caption — wrapped
  around the kept uplink **packet animation** + live negotiation log (Ghost Intel 98-branded; no third-party
  marks/mascot). The DialTerm connect **sound** is rebuilt to follow a real handshake: dial tone → DTMF →
  2100 Hz answer + V.8 "bong" → V.21 negotiation → echo-cancel → V.34 line-probe → scrambled-data roar,
  **beat-locked** to the animation (stepper, log, and audio advance together). Reproduced synthetically
  from functional telephony / V-series frequencies — **no sampled or copyrighted assets**. **429 tests.**
- **v3.9.1-beta.1** — **Look-and-feel pass.** New hand-drawn Windows-98-style **Notepad desktop icon**
  (teal spiral pad, matching the My Computer glyph). Reworked **sounds**, all still synthesized at
  runtime (no sampled assets): a warmer/more-synthetic power-on swell; a fuller DialTerm **dial-up
  handshake** whose tones are **beat-synced to the uplink connect animation** (each data chirp lands
  as a packet crosses the link; the negotiation log reveals on the same beat); and a new **hang-up**
  sound (a legacy handset dropped onto its cradle). **429 tests.**
- **v3.9.0-beta.1** — **Photo-embedding case reports + RTFM left-rail manual.** Case exports (Export… →
  HTML/PDF) now inline the case's **bio images** and **image attachments** as `data:` URIs (decrypted in
  main; 24 MiB total / 8 MiB per-image budget; skipped images footnoted) instead of listing names only.
  **RTFM (Help)** gained a sidebar — **Manual**, **OpChildSafety** (its own page now), **Hacktivist
  Ethos**, **OSINT** (the last two are live placeholders for forthcoming GhostExodus content). Everything
  from v3.8.0-beta.1 carries forward; chat handshake crypto **remains EXPERIMENTAL / unverified**. **429 tests.**
- **v3.8.0-beta.1** — **P2P chat Phases 2–4 + Piper neural TTS**. File **attachments** (chunked over the
  encrypted channel, whole-file SHA-256 verified before disk, encrypted quarantine + explicit save),
  **small groups** (client-side fan-out — *zero new cryptography*), and **case-aware sharing** (entity →
  text, attachment → file, straight into a chat). Plus an offline **Piper** neural TTS engine (bundled
  **public-domain** `en_US-ljspeech-high` voice; selectable alongside the OS voices; zero runtime
  egress). Each phase adversarially red-teamed + authorization-hardened. **Chat handshake crypto remains
  EXPERIMENTAL / unverified** (loud in-app banner). Bundled Tor + Piper fetched + SHA-256-verified at
  build. **424 tests.**
- **v3.7.0-beta.1** — **Experimental P2P chat (Tor), Phase 1**. Opt-in, invite-link **1:1** chat over
  Tor onion services with a PQ-hybrid X25519 + ML-KEM-768 handshake, forward-secret message ratchet,
  TOFU + safety-number trust, encrypt-at-rest history, loopback-only sockets (no firewall prompt).
  Bundled SHA-256-verified Tor. **Crypto EXPERIMENTAL — not formally verified.**
- **v3.6.8** — **OpChildSafety (RTFM)**. A new reference section in Help/RTFM with field guidance for
  grassroots child-protection / OSINT investigators: report CSAM lawfully through the proper channels
  (NCMEC, IWF, CEOP, HSI, ACCCE, Cybertip.ca, Europol IRU, INHOPE, NCA) **without** viewing,
  downloading, or mishandling material; evidence-handling do's and don'ts; terminal-browser tooling
  notes; and website-investigation steps. Static reference text — official reporting links open in the
  OS browser (deny-by-default window-open path), no new background egress. Contributed by GhostExodus.
- **v3.6.7** — **In-app exit** + **GeoINT layout**. The Access (Start) menu gains a **Shut Down…**
  entry (with a confirm) that quits the app cleanly via a new `system:quit` IPC → `app.quit()` (runs
  the existing before-quit cleanup: SSH drain, AI-stream cancel). Previously the only way out was the
  native title-bar X, which a Win98-style shell trains users not to look for — so there was effectively
  no discoverable exit. The **GeoINT** left column widened 340→380px so the View row (2D Map /
  Satellite / Street View / Labels) and event titles stop clipping. UI/IPC change; 254 tests.
- **v3.6.6** — **Warmer startup chime** + **TTS voice-picker fixes**. The launch sound is a revoiced,
  lower-register **original** synthesized power-on swell (F-major bed + slow arpeggio + soft bells; no
  sampled assets — it is *not* the Win9x recording). The on-device voice selector no longer **silently
  vanishes** when no eligible voice exists — it explains *why* (cloud voices are blocked by design;
  install Windows Natural voices) — and voice discovery is now **live** via a persistent
  `voiceschanged` subscription, so voices that populate after launch (or a newly installed voice pack)
  appear without a restart instead of being lost to the old one-shot fetch window. 254 tests (3 new).
- **v3.6.5** — **AI reads PDFs** + **resizable sticky notes**. PDF case attachments were rejected as
  binary; the assistant now extracts the PDF **text layer** through the same offline pdf.js engine the
  viewer uses (no OCR, no network) and includes it in case context under the existing remote-egress
  confirmation and per-item/total size caps — a scanned image-only PDF yields no text and is reported as
  such, not silently dropped. Sticky notes gain a **bottom-right resize grip**; the chosen size persists
  per note and is bounded by the main-process validator. 251 tests (8 new).
- **v3.6.4** — **PDF viewer fix**: the in-app Doc Viewer renders PDFs again. pdfjs-dist 5.x calls
  `Map.prototype.getOrInsertComputed()` during render — a TC39 method Electron 33's Chromium 130
  doesn't ship — so render threw and the viewer blanked; v3.6.4 adds a spec-faithful polyfill (Map +
  WeakMap) in both the renderer and pdf.js worker realms, guarded to no-op once Chromium ships it.
  Renderer-only. 243 tests (5 new).
- **v3.6.3** — **Desktop polish**: the **Ghost Intel 98 flame** image is the default wallpaper (desktop + lock
  screen); desktop icons flow as a single **vertical left-edge column**; **My Cases** uses an authentic
  Win95 **My Computer** icon (pixel-art SVG); and the **New note / Hide notes** bar is a **draggable**
  widget with a grip handle, defaulted to bottom-centre so it no longer covers the window minimise/close
  buttons (position remembered). Renderer/UI only — no IPC, egress, or crypto touched. 238 tests.
- **v3.6.2** — **Solitaire (Klondike)**: green-felt card game with full drag-and-drop (move a card and the
  run beneath it), build foundations A→K, double-click to a foundation, Draw 1/3, and the iconic
  bouncing-card **win cascade**. Self-contained — no network, storage, or data. In the Access menu. 238 tests.
- **v3.6.1** — **Briefcase** (standalone text notes not tied to a case, with a 💼 target in Notepad 98's
  selector); **GeoINT** street/place-name **Labels** overlay (Esri reference layers, gated, no new egress
  domain) + a tile **Reset** + the default OSM URL shown as a placeholder; **Shred** moved to the
  bottom-right corner. Red-team: fixed a save/read UUID-validation mismatch in the Briefcase + AI-conversation
  stores. 232 tests.
- **v3.6.0** — **Renamed from Ghost Access 98** with automatic data migration from the old
  install. New: **Sticky Notes** desktop layer; **AI conversation memory** (saved-chat sidebar) + right-click
  copy + default `qwen3-abliterated:4b`; **GeoINT Street View** + custom-tile **Load** button + **2D Map**
  relabel + map-resize fix; **Markets** first-run tutorial. Fixes: **minimize no longer wipes state**
  (Jukebox keeps playing, AI/Notepad preserved), **Mail** (provider presets, STARTTLS,
  always-closable Compose), **My Cases** rename + cross-case identity-leak fix, **Calendar** off-by-one +
  right-click delete, **Jukebox** double-pause, **Bookmarks** auto-scale, Net Explorer **"Open the Firefox
  folder"** button. Pre-release red-team (0 Critical; all High/Medium fixed). 228 tests.
- **v3.5.0** — **Markets module** (offline-first market overview, off by default); **GeoINT** Street/Satellite toggle, place search, 5-min auto-refresh, layout fix; **Bookmarks** vertically resizable; **Jukebox** restyled to the Win98 CD Player; **encrypted media plays in-app**. Pre-release red-team — DNS-aware SSRF guard, fetch timeout/size caps. 218 tests.
- **v3.4.x** — **offline voice conversation** in the AI Assistant: push-to-talk + hands-free, on-device **Vosk** STT + on-device TTS replies, mic paused while the AI speaks. Dedicated voice red-team (0 Critical). Plus Jukebox transport/icons, GeoINT discoverability, responsive STFU, PDF/wallpaper/copy fixes. *Vosk model is operator-supplied — drop a `model.tar.gz` in `resources/vosk/`.*
- **v3.3.0** — **Bookmarks** dashboard (offline start.me, `.ghostbookmarks` share), **AI offline text-to-speech** + **STFU**, **Net Explorer → Firefox Portable** launcher, live-testing fixes. **Two red-team rounds: 0 Critical.** *Firefox payload is operator-supplied — drop it in `resources/firefox/`.*
- **v3.2.x** — Jukebox media player, EyeSpy bulk feed import, GeoINT dashboard + case integration, with red-team security fixes (SSRF guard, save-to-case validation, `.m3u`/stream-URL hardening).
- **v3.1.0** — turnkey local-AI "Set up local AI" wizard (detect/reuse Ollama → pull a model → auto-configure).
- **v3.0.0** — major consolidated release: optional **encrypt-at-rest login**, in-app **document viewer**, cross-case **entity registry**, **bio photos**, auto-emitting **timeline**, **PDF/HTML/CSV exports**, cross-case **search**, a **whiteboard** canvas, **Telnet + FTP** in DialTerm, **backup/restore** + single-case `.ga98case` sharing, image wallpaper, and the Net Explorer fix.

### Security review

Every feature release goes through an adversarial red-team pass; the standing bar is **0 Critical**, with
all High/Medium findings fixed and regression-tested. Highlights across the suite: TTS no-cloud is
*enforced* (cloud voices fail closed); media streaming is path-confined and revoked on vault lock; outbound
fetches (market/geoint/favicon) reject hosts that *resolve* to loopback/private/metadata and are
timeout/size-capped; the GeoINT Street View embed loads Google imagery **only on explicit action while the
GeoINT network is on**, nothing third-party loads until you open it, and a Firefox fallback covers blocked
framing; the v3.6.0 data migration commits only when every file copies (no partial-copy data loss). See
[`SECURITY.md`](SECURITY.md).

## Build from source

You only need this section if you want to modify the code or build the installer yourself. For just running the app, use the installer link above.

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **pnpm 9+** (`npm install -g pnpm`)
- For producing the Windows installer from Linux: **Wine** (used by `electron-builder` for icon work)

### Setup

```bash
git clone https://github.com/Obsidian-Circuit-LLC/ghost-intel-98.git
cd dcs98
pnpm install
```

> If you have an SSH key registered with GitHub, `git clone git@github.com:Obsidian-Circuit-LLC/ghost-intel-98.git` also works. The HTTPS form above requires no key setup.

## Run (development)

```bash
pnpm dev
```

This starts the Vite dev server (HMR) and the Electron main process.

## Build

```bash
pnpm build        # type-check + bundle main / preload / renderer
pnpm test         # vitest suite (1064 tests as of v3.14.0-beta.18)
pnpm package      # platform installer for the current host
pnpm package:win  # cross-build Windows NSIS installer
```

Output lands in `release/`.

## Data location

Ghost Intel 98 stores all user data under your OS userData directory in a `GhostAccess98/` folder
(the inner folder name is kept stable across the rename so existing data resolves unchanged). Locations:

- Windows: `%APPDATA%\Ghost Intel 98\GhostAccess98\`
- macOS: `~/Library/Application Support/Ghost Intel 98/GhostAccess98/`
- Linux: `~/.config/Ghost Intel 98/GhostAccess98/`

On first launch after upgrading from **Ghost Access 98**, the app copies your old data
(`%APPDATA%\Ghost Access 98\…`) into the new location — it **copies, never moves**, leaving the old data
intact as a safety net, and only marks the migration done if every file copied.

Within that folder you'll find `settings.json`, a `cases/` directory (one folder per case — each with its attachments, notes, bio-images, entity links, whiteboard, timeline, and **saved GeoINT events**), a global `entities.json` registry, `streams.json` (EyeSpy feeds), `media-library.json` + `geoint-sources.json` (Jukebox / GeoINT config), `bookmarks-board.json` (Bookmarks dashboard), `sticky-notes.json`, `ai-conversations.json`, `shred/` (soft-deleted items), `reminders.global.json`, `alarms.json`, and `secrets.enc` (Electron `safeStorage`-encrypted credentials for Mail / SSH / AI).

When **login is enabled**, an `auth.json` appears (the scrypt-wrapped data key and recovery wrap — safe in the clear) and every case-data file on disk becomes AES-256-GCM ciphertext (prefixed with a `GA98ENC1` magic header). `settings.json` stays plaintext so the lock screen can render your theme/wallpaper before you unlock. Deleting the whole `GhostAccess98/` folder resets all state; if login was enabled, that also discards the encrypted data permanently (there is no key escrow).

## Privacy and network behaviour

- **No telemetry. No analytics. No background phone-home.**
- All network egress is initiated by an explicit user action and, for the newer modules, gated behind an explicit off-by-default toggle:
  - **Sticky Notes**, **Bookmarks** (storage), **Jukebox** (local files), and **My Cases** touch the network never.
  - **Markets** and **GeoINT** fetch nothing until you enable their network toggle; outbound hosts are restricted to public addresses (no loopback/private/metadata SSRF) on add, on import, and on every redirect hop, with fetch timeouts and response-size caps.
  - **GeoINT Street View** loads Google's street imagery only when you open it while the GeoINT network is on; an "Open in Firefox" fallback covers blocked framing.
  - **AI voice** is fully on-device: speech-to-text uses **Vosk** (WASM, in-app — never the browser's cloud recognizer), the model is served locally, and replies use on-device OS voices only (cloud voices refused).
  - Net Explorer hands URLs to a bundled Firefox (a separate process). Mail, DialTerm, EyeSpy, and the AI Assistant act only on hosts/credentials you supply.
- Credentials live in `secrets.enc`, encrypted via Electron's built-in OS-level `safeStorage`. Plaintext credentials are never written to disk.
- **Optional encrypt-at-rest**: enable login to encrypt all case data with AES-256-GCM behind a master password. See [`SECURITY.md`](SECURITY.md) for the full model, the backup trust boundary, and how to report a vulnerability.

## License

[MIT](LICENSE) — © 2026 Obsidian Circuit.

## Acknowledgements

- [98.css](https://jdan.github.io/98.css/) by Jordan Scales (MIT) for the retro CSS primitives.
- [Leaflet](https://leafletjs.com/) (BSD-2) for the GeoINT map; tile imagery comes from the tile server **you** configure (e.g. OpenStreetMap, subject to its tile-usage policy). Street View imagery is Google's, loaded only on explicit action.
- [music-metadata](https://github.com/borewit/music-metadata) (MIT) for Jukebox tag reading, [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0) for HLS, [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) for the PDF viewer, [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT) for GeoINT feed parsing, and [world-countries](https://github.com/mledoze/countries) (ODbL) for the offline gazetteer.
- Audio chrome (clicks, boot swell, hang-up, DTMF, and the default dial-up handshake) is synthesized at runtime via the Web Audio API. The **optional Legacy sound pack** (off by default; Settings → Sound) is the one exception: it bundles two AI-reworked recordings of the classic dial-up handshake and Windows startup jingle, which are **derivative works of their respective originals** — they play only if you opt in.
- Text-to-speech uses the OS's own voices via the Web Speech API (no bundled voices, on-device only).
- Offline speech-to-text uses [Vosk](https://alphacephei.com/vosk/) via [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache-2.0, WASM). The speech model is **not** vendored in this repo and is supplied by the operator (`resources/vosk/model.tar.gz`); verify the model's license before bundling it in a published installer.
- The Net Explorer launcher targets [Firefox Portable](https://www.mozilla.org/firefox/) (Mozilla, MPL-2.0). The Firefox payload is **not** vendored in this repo and is supplied by the operator; bundling/redistributing it must follow Mozilla's trademark and distribution policy.
