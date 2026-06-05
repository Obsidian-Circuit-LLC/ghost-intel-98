# Dead Cyber Society 98 — v3.6.8

**OpChildSafety — child-safety reporting guidance in RTFM.**

## What's new

- **OpChildSafety section in RTFM (Help).** A new reference section aimed at grassroots
  child-protection / OSINT investigators. It covers how to report CSAM **lawfully through the proper
  channels — without viewing, downloading, screenshotting, or searching for the material** — and the
  do's and don'ts of handling and submitting a report so evidence isn't tainted and real cases aren't
  buried under noise.

  It includes:
  - An introduction on working *through* recognised NGOs / reporting bodies rather than as a lone
    vigilante, and on submitting clear, factual reports (usernames, URLs, timestamps, platform) and
    letting trained investigators take it from there.
  - A prominent **do-not-view / do-not-download** warning.
  - "What not to do" and "How to avoid tainting evidence" checklists.
  - A note to use terminal, text-only browsers (e.g. `w3m`, `lynx`) that don't view or cache images.
  - Website-investigation steps (registrar / host abuse contacts via WHOIS).
  - A directory of reporting organisations with their official links and phone numbers: **NCMEC,
    IWF, CEOP, HSI, ACCCE, Cybertip.ca, Europol IRU, INHOPE, NCA.**

## Notes

- **Reference text only.** Nothing here fetches or processes any media. The reporting-organisation
  links open in your **OS browser** via the existing deny-by-default window-open path (only http(s)
  URLs are allowed out; everything else is dropped) — there is no new background network egress.
- Open it from **Access → RTFM**, in the **OpChildSafety — child-safety reporting** section.
- Contributed by **GhostExodus**.
- Static content change only — no IPC, encryption, or networking code touched.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.8.exe` (124,486,327 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `e5b62e3605a2605e18507b6e467d98162f51e0b161a24e1cd8da964d279c09da`
