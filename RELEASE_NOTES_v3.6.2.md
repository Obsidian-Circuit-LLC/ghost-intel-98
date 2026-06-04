# Dead Cyber Society 98 — v3.6.2

**Solitaire.** Because it's Windows 98.

## What's new

- **Solitaire (Klondike) — new game.** Green felt, drag-and-drop cards, build the foundations
  A→K by suit, and the **bouncing-card win cascade** when you clear the board.
  - **Draw 1 / Draw 3** toggle, **New game**, move counter and timer.
  - **Drag** a card (and the ordered run beneath it) between columns; **double-click** a card to
    send it straight to a foundation if it's legal.
  - Click the stock to draw; click the empty stock to recycle the waste.
  - It's a self-contained game — **no network, no storage, no data**. Pure offline fun.
  - Find it in the **Access menu** (Start) → **Solitaire**.

## Verification

- `typecheck` clean · **238 tests** (the Klondike rules — deal, stacking, foundations, win — are
  unit-tested with a deterministic shuffle) · production build OK · headless boot smoke clean.
- The interactive drag-drop and the win animation are best verified by playing a hand on Windows.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.2.exe` (124,452,271 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `5a4de263983b349f7f37ab90039574c34bf1d22f0b6eb92672673108c5462617`
