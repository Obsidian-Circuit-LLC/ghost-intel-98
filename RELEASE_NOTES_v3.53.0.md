# Ghost Intel 98 — v3.53.0

**New tool: a no-frills PDF Signer — import a PDF, sign it, save it. Fully offline.**

From GhostExodus's request: there's no free, offline way to sign a PDF (a contract, a form) without an iPhone. Now there is one, built in.

## What's new

- **PDF Signer** (Access ▸ Organizer ▸ PDF Signer). Open a `.pdf`, **draw a signature with your mouse or upload an image of one** (the same signature pad as the invoice module), drag it where you want on the page and resize it on the corner, then **Sign & Save** a signed copy wherever you choose. That's it — no accounts, no upload, no network.

## How it works (and stays private)

- The PDF is rendered in-app with the same offline engine the document viewer uses; the signature is stamped into the real PDF with a bundled pure-JavaScript library (`pdf-lib`), so the **original text and pages are preserved** (it's not flattened to an image). The signed copy is written only where you point the save dialog.
- **Nothing leaves your machine** — no egress, no phone-home. The source PDF is read transiently and never stored in the vault.
- Safety: the imported PDF and signature image are size-capped (and the signature's decoded dimensions are bounded, not just its file size, so a malformed image can't exhaust memory); rotated PDFs are handled correctly so the signature lands where you placed it.

## Under the hood

- New main-process `signPdf` service (pure, honors page `/Rotate`), two IPC channels (`pdfsign:read`/`pdfsign:sign`), a single-page pdfjs renderer, and the module + Organizer entry. One new dependency: `pdf-lib` (MIT, pure-JS, offline — no native code, no network).
- Built subagent-driven over 6 TDD tasks with a parallel adversarial whole-branch review that caught + fixed four real issues before ship: ignored page rotation, an unbounded decoded-PNG size, an invisible 0×0 resize handle, and a half-covered placement test.
- **3,690 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.53.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `2fb61748dfeabd411987caee8da0128c7af190fb14f89997fc87ad352e5fcdff`
- **Size:** 963,045,869 bytes (~963 MB).

*Everything from v3.52.0 and earlier carries forward.*
