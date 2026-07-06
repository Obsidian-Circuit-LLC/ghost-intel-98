# Ghost Intel 98 — v3.33.0

**My Documents can now open and export your files, a proper large-icons folder view, a compact Jukebox by default, and a clearnet toggle in Q — all from GhostExodus's field feedback on v3.32.0.**

## What's new

- **Open & Export in My Documents — the file manager is usable now.** v3.32.0 stored everything encrypted-at-rest but gave you no way to read it back: opening the on-disk file in Word/Acrobat showed **ciphertext** ("Word found unreadable content…"), because that's exactly what encrypt-at-rest puts on disk. Now the right-click menu has **Open** — it decrypts the file into a short-lived temp and launches it in your default app — and **Export…**, which writes one decrypted copy to a location you choose. The banner's promise ("open them here, not in Explorer") is finally true.

- **The vault stays encrypted; the plaintext is contained.** The store on disk is never rewritten to plaintext. The temp that **Open** creates is written **owner-only** (0600), lives in an app-dedicated folder, is **shredded (overwritten then deleted) when you quit**, and any straggler left by a crash is **overwrite-swept on the next launch** — so decrypted bytes never outlive the session. **Export refuses a destination inside My Documents**, so a plaintext copy can't accidentally land back among the ciphertext.

- **A large-icons folder view.** My Documents shows folders and files as a Win98 **large-icons grid** (double-click a file to Open it). The context menu is reordered — **New Folder** at the top, **Paste** directly under Cut — and gains **Open** and **Export…**, both files-only.

- **The Jukebox opens compact.** It now opens as the compact deck (transport + display) by default, with a caret to expand the file toolbar, Library, and Stations — and it **remembers** whichever you leave it in.

- **A clearnet toggle in Q.** A **Clearnet** checkbox sits in Q's chat toolbar, **off by default**. When on, a **Fallback / First** control decides how it's used: **Fallback** is today's behavior (Tor first; clearnet DuckDuckGo only if the Tor search returns nothing), **First** skips Tor and queries DuckDuckGo directly. Either way, every clearnet query prints the unmistakable **"⚠ your real IP is exposed"** warning in the chat. Clearnet stays **DuckDuckGo-only** — it can never route the SearXNG onion engine, and leaving the box unchecked keeps Q strictly Tor-only.

## Under the hood

- Built **subagent-driven**: five TDD tasks with per-task spec+quality review, then a **parallel adversarial whole-branch review** across correctness, security/egress, test-integrity, and simplification. Every candidate finding went through a **refute-by-default verification** pass; the confirmed ones were fixed before ship — the important one (the clearnet-first path had no integration coverage) was closed by extracting a single tested `decideWebSearchRoute()`; the verified minors folded in were the **export-into-vault refusal**, **owner-only + overwrite-swept Open temps**, and a **jukebox-persist race** (a rapid Viz toggle could revert your expand choice).
- **Security is the load-bearing surface.** Every path the file manager takes from the renderer is still fenced twice (segment validation at the IPC boundary **and** a realpath-confinement check in the store). The new Open/Export paths add: a folder-vs-file guard, a symlink-destination refusal on Export, the destination-outside-the-vault refusal, and the owner-only/shred/sweep temp lifecycle. Encrypt-at-rest is **not weakened**.
- **No new network egress**; no telemetry. The only clearnet path is the pre-existing DuckDuckGo one, still behind an off-by-default toggle.
- **3,093 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.33.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `9291e4c4164efdbad2840170ca65d6b5f88a9a37c921af72cab1d9073c89ec09`
- **Size:** 958,365,992 bytes (~958 MB).

*Everything from v3.32.0 (My Documents, Calendar/Reminders/Chat in the Access menu, the SearXNG-instance editor) and earlier carries forward.*
