// test/helpers/theme-allowlist.ts
//
// Content-intrinsic / classic-parity colour literals that the quiet-amethyst
// no-straggler guard (test/theme-no-straggler.test.ts) treats as EXEMPT.
//
// Copied verbatim from docs/superpowers/plans/quiet-amethyst-audit.md ##
// THEME_COLOR_ALLOWLIST (Tasks 6-8), then extended by Task 9 (see the tail of
// the array). An entry belongs here only when the literal is one of:
//   - TRUE content-intrinsic colour (game board/piece, map data layer, chart
//     series, flag, syntax highlight, self-consistent always-dark console), OR
//   - a classic-parity literal deliberately KEPT as the classic value and
//     re-routed for amethyst via a [data-ga98-theme=amethyst] CSS override.
// Dim UI chrome text is NOT exempt: it routes through the --ga98-dim-* /
// --ga98-text-dim tokens instead (parity-exact classic, light on amethyst).
//
// This is the single source of truth the guard imports; keep it in sync with
// the plan section if the plan is ever regenerated.

export const THEME_COLOR_ALLOWLIST: readonly string[] = [
  '#000',
  '#000000',
  '#000080',
  '#0000ff',
  '#003300',
  '#006000',
  '#008000',
  '#008080',
  '#00b4ff',
  '#00e5ff',
  '#00ff88',
  '#060',
  '#0a0a14',
  '#0a0c1c',
  '#0a0e22',
  '#0a0f1a',
  '#0d7d8c',
  '#0f7f96',
  '#111820',
  '#161a3a',
  '#16406b',
  '#16a085',
  '#1a0a2e',
  '#1a232c',
  '#1a6fff',
  '#1ba7b8',
  '#222',
  '#2980b9',
  '#2a2a2a',
  '#2a2f55',
  '#2b6cb0',
  '#2c7',
  '#2e8b57',
  '#2f4f4f',
  '#31708f',
  '#33d033',
  '#37474f',
  '#37a9c2',
  '#3a4a5a',
  '#3b6ea5',
  '#3df2ff',
  '#404040',
  '#444',
  '#44aaff',
  '#555',
  '#5a5a5a',
  '#5a5f72',
  '#5ad1ff',
  '#5d4037',
  '#6b6b6b',
  '#7a3ba5',
  '#7c2',
  '#7cfc7c',
  '#7f8c8d',
  '#7fc97f',
  '#800000',
  '#800080',
  '#808000',
  '#808080',
  '#80ccff',
  '#8a6d3b',
  '#8a8a8a',
  '#8aa0a8',
  '#8e44ad',
  '#900',
  '#9a9a9a',
  '#9aa0b5',
  '#9dff6b',
  '#9e9e9e',
  '#a00',
  '#aaaaaa',
  '#b23b3b',
  '#b44fff',
  '#b58863',
  '#bdbdbd',
  '#bdeef9',
  '#bfe0bf',
  '#c00',
  '#c0392b',
  '#c05000',
  '#c06bff',
  '#c07a1f',
  '#c0c0c0',
  '#c7c7c7',
  '#cfcfcf',
  '#cfd8e0',
  '#cfe4ef',
  '#d8d1ba',
  '#d8d8e0',
  '#d9a83f',
  '#dfe6ec',
  '#e0457b',
  '#e06060',
  '#e0a030',
  '#e33',
  '#e57373',
  '#e67e22',
  '#e80',
  '#e8c766',
  '#e8e8f0',
  '#ec0',
  '#f00',
  '#f0c467',
  '#f0d9b5',
  '#f0f0f0',
  '#f2d98a',
  '#f6d67e',
  '#fbe6ac',
  '#fdfdfd',
  '#fee',
  '#ff0000',
  '#ff3344',
  '#ff3377',
  '#ff5050',
  '#ff6644',
  '#ff6bd0',
  '#ff8800',
  '#ff8a3d',
  '#ffaa00',
  '#ffcc00',
  '#ffd1e3',
  '#ffd54f',
  '#ffd700',
  '#ffe14d',
  '#fff',
  '#ffffff',
  'black',
  'rgba(0,0,0,0.28)',
  'rgba(0,0,0,0.6)',
  'rgba(0,0,0,0.65)',
  'rgba(0,128,0,0.7)',
  'rgba(100,60,180,0.07)',
  'rgba(200,220,255,0.8)',
  'rgba(255,50,50,0.3)',
  'rgba(255,50,50,0.8)',
  'rgba(26,111,255,0.25)',
  'rgba(26,111,255,0.5)',
  'rgba(26,111,255,0.6)',
  'rgba(5,5,20,0.95)',
  'teal',
  'white',
  '#30405a',
  '#5a6480',
  '#d8a83a',
  '#ff4444',
  '#ffc800',
  'rgba(0,0,0,0.8)',
  '#11161f',
  '#141a26',
  '#1b2230',
  '#1c2330',
  '#2a3344',
  '#4a5468',
  '#5a7fb0',
  '#6b7688',
  '#8a96a8',
  '#8fb7e0',
  '#9ad',
  '#cdd6e4',
  '#e6edf6',
  '#e88',
  'rgba(0,0,0,.5)',
  'rgba(93,58,125,0.15)',
  'rgba(255,255,255,.7)',
  'rgba(0,0,0,.4)',
  'rgba(0,0,0,0.3)',
  '#047a32',
  '#101010',
  '#c00000',
  '#1a3fa0',
  '#2a5fd0',
  '#aaffaa',
  'rgba(0,0,0,0.35)',
  'rgba(255,255,255,0.85)',
  // ── Task 9 additions: reviewed intentional literals (guard exemption b) ──────
  //   Genuine dark-on-dark dim TEXT was routed to --ga98-dim-* / status / t8
  //   tokens instead; the entries below are self-consistent dark consoles,
  //   content-intrinsic surfaces, Task-8 classic-values-with-t8-override, and
  //   theme-tolerant island/decorative literals confirmed to stay legible.
  '#00000030',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#00000055',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#00000066',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#000040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0000aa',  // help link/error-tint (content-intrinsic)
  '#0000cc',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#0006',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#00188f',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#021502',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#040010',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#05070e',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#052805',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#060d1c',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#07070f',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#070710',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#080',  // reminders highlight-flash yellow (content-intrinsic)
  '#0a0814',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0a0a1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0a0a2a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#0a0acc',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0a1030',  // self-consistent dark X-collector console (#0a0a14)
  '#0a1428',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0a1a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a1a3a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a2a0a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a2f0a',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0a3a0a',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0a7d28',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#0b1a0b',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0b1a2b',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0c1a33',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0d0518',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#0d0a1e',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0d0d1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0e0a1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0f1a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#0f2a0f',  // self-consistent dark X-collector console (#0a0a14)
  '#10141c',  // self-consistent dark GhostScrape console (#0a0a14)
  '#10233a',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#1084d0',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#111',  // EyeSpy dark video-wall tile (always-dark surface)
  '#111124',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#12081f',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#12124a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#12162200',  // self-consistent dark GhostScrape console (#0a0a14)
  '#141119',  // investigation-graph dark canvas island
  '#14182400',  // self-consistent dark GhostScrape console (#0a0a14)
  '#14182a',  // self-consistent dark GhostScrape console (#0a0a14)
  '#14294d',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#15092a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#17324f',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#1a0808',  // self-consistent dark X-collector console (#0a0a14)
  '#1a0f2a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1a0f2e',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#1a1000',  // self-consistent dark X-collector console (#0a0a14)
  '#1a1040',  // self-consistent dark SOCMINT console (#0a0a14)
  '#1a1200',  // self-consistent dark X-collector console (#0a0a14)
  '#1a1236',  // self-consistent dark X-collector console (#0a0a14)
  '#1a1430',  // self-consistent dark X-collector console (#0a0a14)
  '#1a1535',  // self-consistent dark X-collector console (#0a0a14)
  '#1a1830',  // self-consistent dark SOCMINT console (#0a0a14)
  '#1a1a0a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#1a1a1a',  // EyeSpy dark video-wall tile (always-dark surface)
  '#1a1a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#1a2030',  // self-consistent dark X-collector console (#0a0a14)
  '#1a2040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1a2a3a',  // self-consistent dark X-collector console (#0a0a14)
  '#1a2a3c',  // self-consistent dark X-collector console (#0a0a14)
  '#1a3a1a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#1a3a6a',  // self-consistent dark X-collector console (#0a0a14)
  '#1a4a1a',  // self-consistent dark X-collector console (#0a0a14)
  '#1a5fff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1c2030',  // self-consistent dark GhostScrape console (#0a0a14)
  '#1d4d1d',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#1e0f33',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1f5f1f',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#200808',  // self-consistent dark SOCMINT console (#0a0a14)
  '#200a0a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#202840',  // self-consistent dark X-collector console (#0a0a14)
  '#22304a',  // self-consistent dark GhostScrape console (#0a0a14)
  '#241539',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#27364d',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#2a0808',  // self-consistent dark X-collector console (#0a0a14)
  '#2a0e0e',  // self-consistent dark SOCMINT console (#0a0a14)
  '#2a0f0f',  // self-consistent dark X-collector console (#0a0a14)
  '#2a0f40',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a1040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a1418',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#2a1a00',  // self-consistent dark X-collector console (#0a0a14)
  '#2a2040',  // self-consistent dark X-collector console (#0a0a14)
  '#2a2050',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a2408',  // self-consistent dark GhostScrape console (#0a0a14)
  '#2a2733',  // amethyst-block design literal (98.overrides dark skin)
  '#2a2f3c',  // self-consistent dark GhostScrape console (#0a0a14)
  '#2a3060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a3555',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a4664',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#2a4a7a',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#2a5080',  // self-consistent dark X-collector console (#0a0a14)
  '#2a6a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#2f2',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#2f5578',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#304060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#333',  // investigation-graph dark canvas island
  '#333355',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#33ccff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#343a4c',  // self-consistent dark GhostScrape console (#0a0a14)
  '#3a1a1a',  // self-consistent dark X-collector console (#0a0a14)
  '#3a2060',  // self-consistent dark SOCMINT console (#0a0a14)
  '#3a2a1a',  // minds-eye sepia vision-card (content-intrinsic)
  '#3a3060',  // self-consistent dark X-collector console (#0a0a14)
  '#3a3080',  // self-consistent dark SOCMINT console (#0a0a14)
  '#3a3644',  // amethyst-block design literal (98.overrides dark skin)
  '#3a3648',  // amethyst-block design literal (98.overrides dark skin)
  '#3a3a5a',  // self-consistent dark X-collector console (#0a0a14)
  '#3a3a6a',  // self-consistent dark X-collector console (#0a0a14)
  '#3a5a8a',  // self-consistent dark GhostScrape console (#0a0a14)
  '#3a6a3a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#3a7a3a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#3c3',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#3d1a5c',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#3d6a3d',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#400000',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#400080',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#404070',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#404870',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4060a0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4499ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4a3568',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#4a7aad',  // self-consistent dark X-collector console (#0a0a14)
  '#4da6ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#5050c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#5a3aa8',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#5a4000',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#5a4020',  // minds-eye sepia vision-card (content-intrinsic)
  '#5aad5a',  // self-consistent dark X-collector console (#0a0a14)
  '#5c1a1a',  // self-consistent dark X-collector console (#0a0a14)
  '#5d3a7d',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#606060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6060c0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6070a0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6080c0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6090c0',  // self-consistent dark X-collector console (#0a0a14)
  '#6090d0',  // self-consistent dark X-collector console (#0a0a14)
  '#666',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#667',  // EyeSpy dark video-wall tile (always-dark surface)
  '#6a5a85',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6a5a8a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6a6a20',  // self-consistent dark SOCMINT console (#0a0a14)
  '#6f7cc4',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6f7f9c',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#6f9bff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#700',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#7070a0',  // self-consistent dark X-collector console (#0a0a14)
  '#7090c0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#777',  // EyeSpy dark video-wall tile (always-dark surface)
  '#7a2020',  // self-consistent dark X-collector console (#0a0a14)
  '#7a3030',  // self-consistent dark X-collector console (#0a0a14)
  '#7a5000',  // self-consistent dark X-collector console (#0a0a14)
  '#7a6aa0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#7c4dff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#7d3a3a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#7d5a1a',  // self-consistent dark X-collector console (#0a0a14)
  '#7d5aad',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#7dff7d',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#7fbfff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#7fd4ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#803000',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#806090',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#8080a0',  // self-consistent dark X-collector console (#0a0a14)
  '#8090b0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#80a0d8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#80b0e8',  // self-consistent dark X-collector console (#0a0a14)
  '#80c0ff',  // self-consistent dark X-collector console (#0a0a14)
  '#80d880',  // self-consistent dark X-collector console (#0a0a14)
  '#888',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#8890a8',  // self-consistent dark GhostScrape console (#0a0a14)
  '#8a7000',  // self-consistent dark X-collector console (#0a0a14)
  '#8b2020',  // self-consistent dark SOCMINT console (#0a0a14)
  '#8ec5ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#8fa0bd',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#8fd0ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#8fe08f',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#9090c0',  // self-consistent dark X-collector console (#0a0a14)
  '#90b0d0',  // self-consistent dark X-collector console (#0a0a14)
  '#90e890',  // self-consistent dark SOCMINT console (#0a0a14)
  '#999',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#9a86c4',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#9db8d8',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#9fb0c8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#9fb6d6',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#a080c0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#a090c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#a0a0c0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#a0a0d0',  // self-consistent dark X-collector console (#0a0a14)
  '#a0aac0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#a0c8ff',  // self-consistent dark GhostScrape console (#0a0a14)
  '#a0d0ff',  // self-consistent dark X-collector console (#0a0a14)
  '#a33',  // hostinfo: classic value, amethyst via .ga98-t8-err-text override
  '#aa2020',  // self-consistent dark X-collector console (#0a0a14)
  '#aa8820',  // self-consistent dark GhostScrape console (#0a0a14)
  '#aaaa30',  // self-consistent dark SOCMINT console (#0a0a14)
  '#ad4a4a',  // self-consistent dark X-collector console (#0a0a14)
  '#ad5a5a',  // self-consistent dark X-collector console (#0a0a14)
  '#b0b0b0',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#b0b6c8',  // self-consistent dark GhostScrape console (#0a0a14)
  '#b8860b',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#b8c8b8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#b9c6dc',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#bb66ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c06060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c08040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c0a0a0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#c0a0e8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#c0c8d8',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#c33',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#c8a000',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#c8a0e0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8a860',  // self-consistent dark GhostScrape console (#0a0a14)
  '#c8b8e8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8b8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8c0d8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8d0e8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#cc3',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#cc3030',  // self-consistent dark SOCMINT console (#0a0a14)
  '#cc4040',  // self-consistent dark X-collector console (#0a0a14)
  '#ccc',  // EyeSpy dark video-wall tile (always-dark surface)
  '#cde',  // EyeSpy dark video-wall tile (always-dark surface)
  '#cfd8dc',  // whiteboard node-card bevel (content-intrinsic)
  '#cfe0ff',  // self-consistent dark GhostScrape console (#0a0a14)
  '#cfe3ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#cfe4ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#d0d0d0',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#d0e0ff',  // self-consistent dark X-collector console (#0a0a14)
  '#d0e8ff',  // self-consistent dark X-collector console (#0a0a14)
  '#d33',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#d3e8ff',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#d4a017',  // mail flagged-star amber glyph (content-intrinsic)
  '#d4d0c8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d4e3fc',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#d8c8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d8d880',  // self-consistent dark SOCMINT console (#0a0a14)
  '#d8d8d8',  // self-consistent dark X-collector console (#0a0a14)
  '#d8e8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d8f5d8',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#d8ffd8',  // self-consistent dark X-collector console (#0a0a14)
  '#ddaa00',  // self-consistent dark X-collector console (#0a0a14)
  '#ddd',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#dfdfdf',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#dfe7f2',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#e0e4f0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#e8b0b0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8c080',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8c0c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8d0a0',  // self-consistent dark X-collector console (#0a0a14)
  '#e8d8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#e8e8ff',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8eef7',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#e8eeff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#e8f0ff',  // my-documents selection highlight (light unit)
  '#e9e1f5',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#eaf4ff',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ece6f7',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ee3030',  // self-consistent dark X-collector console (#0a0a14)
  '#eecc30',  // self-consistent dark GhostScrape console (#0a0a14)
  '#eee',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#eef3fb',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#f0a0a0',  // self-consistent dark X-collector console (#0a0a14)
  '#f0b0b0',  // self-consistent dark X-collector console (#0a0a14)
  '#f0c0c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#f0d8b0',  // minds-eye sepia vision-card (content-intrinsic)
  '#f0e0b0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#f3eefb',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#f4f0ff',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#f4f4f4',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ff5566',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff6060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff6b6b',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ff8040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff8080',  // self-consistent dark X-collector console (#0a0a14)
  '#ff8fc7',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ff9090',  // self-consistent dark SOCMINT console (#0a0a14)
  '#ffa040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ffcc80',  // self-consistent dark X-collector console (#0a0a14)
  '#ffd0d0',  // self-consistent dark X-collector console (#0a0a14)
  '#ffd6ea',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffd8d8',  // self-consistent dark X-collector console (#0a0a14)
  '#ffdd80',  // self-consistent dark GhostScrape console (#0a0a14)
  '#ffe',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffe080',  // self-consistent dark X-collector console (#0a0a14)
  '#ffe600',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffecec',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#ffee80',  // self-consistent dark X-collector console (#0a0a14)
  '#fff8e0',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#fff9b1',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffff00',  // reminders highlight-flash yellow (content-intrinsic)
  '#ffffff66',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffffff80',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  '#ffffffcc',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
  'navy',  // theme.css self-consistent island / decorative gradient / theme-tolerant chrome
];
