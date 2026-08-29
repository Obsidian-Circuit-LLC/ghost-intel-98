# Ghost Intel 98 — v3.74.2

**Hotfix: the standalone X Listening Station couldn't actually do anything, its banner was missing, and the case panel was crumpling.**

## Connect does something now

You were right that clicking Connect did nothing — and the error you photographed said it exactly: *"Rejected IPC from an untrusted sender frame."*

The app only lets its own page talk to the engine, which is deliberate: the collector opens real X pages in a hidden browser, and a page like that must never be able to send commands to the app. When I gave your station its own window last release, I gave it its own page — and forgot to tell that check the new page is also ours. So the window drew perfectly and every single button was refused. Connect, sweeps, everything.

Your page is on the list now. I kept it to exactly two page names rather than "anything local", because that check is one of the things standing between a scraped web page and your case data.

## Your banner is back

The masthead asks for your CYBERVS DOMINATVS artwork, and I'd embedded your *code* without ever shipping your *image* — so it fell back to showing the alt text. Your original is in, converted for size (2.6 MB → 155 KB, same dimensions), and it now sits where both the in-app module and the standalone window can find it.

## Case Manager stops crumpling, and Attachments moved

You asked for Attachments to go below Bio images because it eats the space and the panel crumples at the default window size. Both were the same mistake of mine: when I added the case photo beside Identity, the container I wrapped it in accidentally closed *after* Attachments instead of after Identity — so Identity and Attachments were being laid out side by side as a pair. Maximised, that just looked a bit odd. At the default size they overlapped into each other, which is the crumpling you saw.

Attachments is now full width, below Bio images, where you wanted it.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.74.2.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `06ea3bb96cd4af0231f661ff1556d0fdf7b35b92c8ee73cb52ffc462965e1983`
- **Size:** `945,174,412 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.74.2**.

> Once it's in: open the station from the menu, hit **Connect / Reopen X**, and the dedicated Chromium window should come up for you to log in. If it still doesn't, the error banner at the top of the SYSTEM tab is the thing to send me — that's what pinned this one in a single look.
