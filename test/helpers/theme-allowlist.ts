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
  //   Every entry names a SPECIFIC content-intrinsic reason: a named always-dark
  //   module console (self-consistent in both themes), a named decorative device
  //   skin (jukebox WMP shell, sticky-note paper, dialup CRT), a content data
  //   colour (status dots, map links, graph node kinds), or a classic-parity
  //   value kept + re-routed for amethyst via a [data-ga98-theme=amethyst]
  //   override. No entry is a bare light BACKGROUND on a chrome/panel selector —
  //   those are themed, not allow-listed (blanket "theme-tolerant chrome"
  //   justifications were removed and their literals routed to dark tokens).
  '#00000030',  // jukebox WMP-shell inset bevel (translucent black lower edge)
  '#00000055',  // sticky-note & swatch hairline border (translucent black; decorative)
  '#00000066',  // desktop-card sunken frame border (translucent black bevel)
  '#000040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0000cc',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#0006',  // stream-test status dot border (translucent black)
  '#00188f',  // bookmark-manager link text: classic navy link, amethyst via .ga98-bm-link-open override
  '#021502',  // dialup-client CRT node face (self-consistent dark-green console)
  '#040010',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#05070e',  // .ga98-geo-map globe backdrop (self-consistent dark, both themes)
  '#052805',  // dialup-client "done" stage panel (dark-green console)
  '#060d1c',  // Reports dark intelligence hero tile (self-consistent dark, both themes)
  '#07070f',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#070710',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#080',  // reminders highlight-flash yellow (content-intrinsic)
  '#0a0814',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0a0a1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0a0a2a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#0a0acc',  // bookmark-manager link hover text (classic blue link)
  '#0a1030',  // self-consistent dark X-collector console (#0a0a14)
  '#0a1428',  // Reports dark intelligence hero backdrop (self-consistent dark)
  '#0a1a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a1a3a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a2a0a',  // self-consistent dark X-collector console (#0a0a14)
  '#0a2f0a',  // dialup-client link-progress track (dark-green console)
  '#0a3a0a',  // dialup-client logo/divider border (dark-green console)
  '#0a7d28',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#0b1a0b',  // calculator terminal chip fill (self-consistent dark-green)
  '#0b1a2b',  // Jukebox Now-Playing LCD panel (self-consistent dark)
  '#0c1a33',  // Reports dark hero tile hover (self-consistent dark)
  '#0d0518',  // Invoices ledger-canvas gradient stop (self-consistent dark-purple)
  '#0d0a1e',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0d0d1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0e0a1a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#0f1a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#0f2a0f',  // self-consistent dark X-collector console (#0a0a14)
  '#10141c',  // self-consistent dark GhostScrape console (#0a0a14)
  '#10233a',  // Jukebox equalizer LCD panel (self-consistent dark)
  '#1084d0',  // classic --ga98-accent value in decorative titlebar/stripe gradient stops
  '#111',  // EyeSpy dark video-wall tile (always-dark surface)
  '#111124',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#12081f',  // Invoices dark-purple module workspace (self-consistent dark)
  '#12124a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#12162200',  // self-consistent dark GhostScrape console (#0a0a14)
  '#141119',  // investigation-graph dark canvas island
  '#14182400',  // self-consistent dark GhostScrape console (#0a0a14)
  '#14182a',  // self-consistent dark GhostScrape console (#0a0a14)
  '#14294d',  // Reports dark hero dot-grid pattern (self-consistent dark)
  '#15092a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#17324f',  // Jukebox format/kbps badge fill (self-consistent dark)
  '#1a0808',  // self-consistent dark X-collector console (#0a0a14)
  '#1a0f2a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1a0f2e',  // Invoices dark-purple module base (self-consistent dark)
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
  '#1d4d1d',  // dialup-client CRT node border (dark-green console)
  '#1e0f33',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#1f5f1f',  // dialup-client CRT glow/text-shadow (dark-green console)
  '#200808',  // self-consistent dark SOCMINT console (#0a0a14)
  '#200a0a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#202840',  // self-consistent dark X-collector console (#0a0a14)
  '#22304a',  // self-consistent dark GhostScrape console (#0a0a14)
  '#241539',  // Invoices dark-purple panel/button (self-consistent dark)
  '#27364d',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#2a0808',  // self-consistent dark X-collector console (#0a0a14)
  '#2a0e0e',  // self-consistent dark SOCMINT console (#0a0a14)
  '#2a0f0f',  // self-consistent dark X-collector console (#0a0a14)
  '#2a0f40',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a1040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a1418',  // --ga98-status-error-tint value (error-fill literal, matches token)
  '#2a1a00',  // self-consistent dark X-collector console (#0a0a14)
  '#2a2040',  // self-consistent dark X-collector console (#0a0a14)
  '#2a2050',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a2408',  // self-consistent dark GhostScrape console (#0a0a14)
  '#2a2733',  // amethyst-block design literal (98.overrides dark skin)
  '#2a2f3c',  // self-consistent dark GhostScrape console (#0a0a14)
  '#2a3060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a3555',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#2a4664',  // Jukebox LCD inset border (self-consistent dark)
  '#2a4a7a',  // Reports dark hero tile border (self-consistent dark)
  '#2a5080',  // self-consistent dark X-collector console (#0a0a14)
  '#2a6a2a',  // self-consistent dark X-collector console (#0a0a14)
  '#2f2',  // dialup-client packet/glow green + stream-test ok dot (content-intrinsic green)
  '#2f5578',  // Jukebox badge border (self-consistent dark)
  '#304060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#333',  // investigation-graph dark canvas island
  '#3fbf7f',  // investigation-graph node-kind fill: doc (content-intrinsic data colour)
  '#4aa3ff',  // investigation-graph node-kind fill: fact (content-intrinsic data colour)
  '#9aa5b1',  // investigation-graph node-kind fill: default/unknown (content-intrinsic data colour)
  '#b07cf0',  // investigation-graph node-kind fill: entity (content-intrinsic data colour)
  '#333355',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#33ccff',  // Reports dark hero title text (cyan on dark hero)
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
  '#3c3',  // stream-test "ok" status dot (content-intrinsic green)
  '#3d1a5c',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#3d6a3d',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#400000',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#404070',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#404870',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4060a0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4499ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#4a3568',  // amethyst --ga98-select-bg value (selection fill on dark skin)
  '#4a7aad',  // self-consistent dark X-collector console (#0a0a14)
  '#4da6ff',  // Reports dark hero tile hover border (self-consistent dark)
  '#5050c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#5a3aa8',  // Invoices dark-purple border accent (self-consistent dark)
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
  '#667',  // EyeSpy dark video-wall tile (always-dark surface)
  '#6a5a85',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6a5a8a',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6a6a20',  // self-consistent dark SOCMINT console (#0a0a14)
  '#6f7cc4',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#6f7f9c',  // Jukebox WMP-shell frame border (metallic device skin)
  '#6f9bff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#700',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#7070a0',  // self-consistent dark X-collector console (#0a0a14)
  '#7090c0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#777',  // EyeSpy dark video-wall tile (always-dark surface)
  '#7a2020',  // self-consistent dark X-collector console (#0a0a14)
  '#7a3030',  // self-consistent dark X-collector console (#0a0a14)
  '#7a5000',  // self-consistent dark X-collector console (#0a0a14)
  '#7a6aa0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#7c4dff',  // Invoices dark-purple focus/border accent (self-consistent dark)
  '#7d3a3a',  // self-consistent dark SOCMINT console (#0a0a14)
  '#7d5a1a',  // self-consistent dark X-collector console (#0a0a14)
  '#7d5aad',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#7dff7d',  // calculator terminal chip text (self-consistent dark-green)
  '#7fbfff',  // sticky-note "blue" swatch/paper (content-intrinsic note colour)
  '#7fd4ff',  // Reports dark hero subtitle text (cyan on dark hero)
  '#803000',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#806090',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#8080a0',  // self-consistent dark X-collector console (#0a0a14)
  '#8090b0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#80a0d8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#80b0e8',  // self-consistent dark X-collector console (#0a0a14)
  '#80c0ff',  // self-consistent dark X-collector console (#0a0a14)
  '#80d880',  // self-consistent dark X-collector console (#0a0a14)
  '#888',  // --ga98-dim-faint value + calendar-muted day number (classic; amethyst via grid override) + PDF-viewer backdrop
  '#8890a8',  // self-consistent dark GhostScrape console (#0a0a14)
  '#8a7000',  // self-consistent dark X-collector console (#0a0a14)
  '#8b2020',  // self-consistent dark SOCMINT console (#0a0a14)
  '#8ec5ff',  // GeoINT map popup link text (map content)
  '#8fa0bd',  // Jukebox WMP-shell metallic gradient/inset border (device skin)
  '#8fd0ff',  // Jukebox badge text (self-consistent dark)
  '#8fe08f',  // sticky-note "green" swatch (content-intrinsic note colour)
  '#9090c0',  // self-consistent dark X-collector console (#0a0a14)
  '#90b0d0',  // self-consistent dark X-collector console (#0a0a14)
  '#90e890',  // self-consistent dark SOCMINT console (#0a0a14)
  '#999',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#9a86c4',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#9db8d8',  // Jukebox LCD secondary text (self-consistent dark)
  '#9fb0c8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#9fb6d6',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#a080c0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#a090c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#a0a0c0',  // Searchlight .sl-sweep-btn-active classic grey face (parity); amethyst via searchlight.css .sl-sweep-btn override (1486-1499)
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
  '#b0b0b0',  // --ga98-hairline value + Reports toolbar pressed face (classic; amethyst via report override)
  '#b0b6c8',  // self-consistent dark GhostScrape console (#0a0a14)
  '#b8860b',  // Reports Recent "draft" status amber (classic; amethyst via status-warning override)
  '#b8c8b8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#b9c6dc',  // Jukebox WMP-shell metallic gradient mid-stop (device skin)
  '#bb66ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c06060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c08040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c0a0a0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#c0a0e8',  // self-consistent dark SOCMINT console (#0a0a14)
  '#c0c8d8',  // retro-terminal sunken well bevel (decorative Win98 well)
  '#c33',  // stream-test "fail" status dot (content-intrinsic red)
  '#c8a000',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#c8a0e0',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8a860',  // self-consistent dark GhostScrape console (#0a0a14)
  '#c8b8e8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8b8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8c0d8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#c8d0e8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#cc3',  // stream-test "testing" status dot (content-intrinsic amber)
  '#cc3030',  // self-consistent dark SOCMINT console (#0a0a14)
  '#cc4040',  // self-consistent dark X-collector console (#0a0a14)
  '#ccc',  // EyeSpy dark video-wall tile (always-dark surface)
  '#cde',  // EyeSpy dark video-wall tile (always-dark surface)
  '#cfd8dc',  // whiteboard node-card bevel (content-intrinsic)
  '#cfe0ff',  // self-consistent dark GhostScrape console (#0a0a14)
  '#cfe3ff',  // Jukebox LCD primary text (self-consistent dark)
  '#cfe4ff',  // Reports dark hero tile label (self-consistent dark)
  '#d0e0ff',  // self-consistent dark X-collector console (#0a0a14)
  '#d0e8ff',  // self-consistent dark X-collector console (#0a0a14)
  '#d33',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#d3e8ff',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#d4a017',  // mail flagged-star amber glyph (content-intrinsic)
  '#d4d0c8',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d4e3fc',  // classic dropzone hot-fill (amethyst via .ga98-dropzone override)
  '#d8c8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d8d880',  // self-consistent dark SOCMINT console (#0a0a14)
  '#d8d8d8',  // light row/tab/link hover + mkt table divider: classic value, amethyst-overridden to dark
  '#d8e8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#d8f5d8',  // sticky-note "green" paper (content-intrinsic note colour)
  '#d8ffd8',  // self-consistent dark X-collector console (#0a0a14)
  '#ddaa00',  // self-consistent dark X-collector console (#0a0a14)
  '#ddd',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#dfdfdf',  // --ga98-track value + Reports Recent row border (classic; amethyst via Recent override)
  '#dfe7f2',  // Jukebox WMP-shell metallic gradient top-stop + stations drawer (device skin)
  '#e0e4f0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#e8b0b0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8c080',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8c0c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8d0a0',  // self-consistent dark X-collector console (#0a0a14)
  '#e8d8ff',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#e8e8ff',  // self-consistent dark SOCMINT console (#0a0a14)
  '#e8eef7',  // Reports Recent row hover (classic light; amethyst via Recent override)
  '#e8eeff',  // dialup-client brand readout text (light on dark-green console)
  '#e8f0ff',  // my-documents selection highlight (light unit)
  '#e9e1f5',  // Searchlight .sl-sweep-input classic light field bg (parity); amethyst via searchlight.css .sl-sweep-input override (1486-1499)
  '#eaf4ff',  // Jukebox Now-Playing title text (light on dark LCD)
  '#ece6f7',  // Invoices dark-purple body text (self-consistent dark)
  '#ee3030',  // self-consistent dark X-collector console (#0a0a14)
  '#eecc30',  // self-consistent dark GhostScrape console (#0a0a14)
  '#eee',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#eef3fb',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#f0a0a0',  // self-consistent dark X-collector console (#0a0a14)
  '#f0b0b0',  // self-consistent dark X-collector console (#0a0a14)
  '#f0c0c0',  // self-consistent dark SOCMINT console (#0a0a14)
  '#f0d8b0',  // minds-eye sepia vision-card (content-intrinsic)
  '#f0e0b0',  // self-consistent dark GhostScrape console (#0a0a14)
  '#f3eefb',  // Searchlight .sl-sweep-input:focus classic light field bg (parity); amethyst via searchlight.css :focus override (1486-1499)
  '#f4f0ff',  // AI-assistant learned/markdown island: classic value (t8/dim-covered)
  '#f4f4f4',  // classic idle fill (dropzone/calendar-muted/--ga98-inset-panel); amethyst via overrides
  '#ff5566',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff6060',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff6b6b',  // --ga98-pw-vweak value + calculator error text (bright red on dark)
  '#ff8040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ff8080',  // self-consistent dark X-collector console (#0a0a14)
  '#ff8fc7',  // sticky-note "pink" swatch (content-intrinsic note colour)
  '#ff9090',  // self-consistent dark SOCMINT console (#0a0a14)
  '#ffa040',  // self-consistent dark Searchlight console (bg #0a0a14 in both themes)
  '#ffcc80',  // self-consistent dark X-collector console (#0a0a14)
  '#ffd0d0',  // self-consistent dark X-collector console (#0a0a14)
  '#ffd6ea',  // sticky-note "pink" paper (content-intrinsic note colour)
  '#ffd8d8',  // self-consistent dark X-collector console (#0a0a14)
  '#ffdd80',  // self-consistent dark GhostScrape console (#0a0a14)
  '#ffe',  // calendar drag-create hover affordance (classic; amethyst via grid override)
  '#ffe080',  // self-consistent dark X-collector console (#0a0a14)
  '#ffe600',  // sticky-note "yellow" swatch (content-intrinsic note colour)
  '#ffecec',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#ffee80',  // self-consistent dark X-collector console (#0a0a14)
  '#fff8e0',  // chat unit: classic value, amethyst via .ga98-t8-* override
  '#fff9b1',  // sticky-note "yellow" paper (content-intrinsic note colour)
  '#ffff00',  // reminders highlight-flash yellow (content-intrinsic)
  '#ffffff66',  // desktop-card dashed border (translucent white; decorative)
  '#ffffff80',  // desktop-card placeholder glyph (translucent white; decorative)
  '#ffffffcc',  // jukebox WMP-shell inset bevel (translucent white top edge)
  'navy',  // jukebox/stations active-row selection fill (navy = classic --ga98-blue)
];

// ── Paper-background SELECTOR SCOPE (closes the value-only guard blind spot) ───────────────────
// THEME_COLOR_ALLOWLIST is value-only + global, so any selector could paint one of the base light
// "paper" literals below as a BACKGROUND fill and inherit the exemption WITHOUT its own review.
// A real light chrome ISLAND therefore rode the paper literal silently (e.g. `.ga98-calc-hist-list`
// — a white <ul> whose rows inherited --ga98-text → unreadable light-on-white under amethyst) and
// still passed the guard. To make "the guard cannot be passed by allow-listing a real island"
// actually enforced, these literals are SELECTOR-SCOPED when they appear in a CSS `background*`
// value: the enclosing selector MUST match a reviewed entry in PAPER_SURFACE_ALLOW, otherwise the
// site is a straggler even though the literal is in THEME_COLOR_ALLOWLIST.
//
// Deliberately NARROW: this scoping applies ONLY to hex paper literals used in a CSS background
// declaration whose value has no var(--token, …) (a token-driven background is themed by the token,
// so the literal is only a fallback). Foreground / border uses of the same literals, keyword colours,
// and TSX inline styles keep the global value behaviour — the demonstrated failure mode was a CSS
// chrome surface, and an inline-style content colour cannot carry a [data-ga98-theme] override.
export const PAPER_BG_LITERALS: readonly string[] = [
  '#fff',
  '#ffffff',
  '#c0c0c0',
  '#f4f4f4',
  '#f0f0f0',
];

export interface PaperSurface {
  /** Substring matched against the enclosing CSS selector text. Grouped selectors are one string,
   *  so a fragment matches any member of the group. */
  readonly selector: string;
  readonly note: string;
}

// Every entry is REVIEWED: the selector is EITHER content-paper (intentionally light in BOTH themes
// — the page/canvas the user reads or draws on) OR classic-parity chrome that carries a named
// [data-ga98-theme='amethyst'] override (so it is not light-on-light under the skin). A NEW light
// chrome surface will NOT match any fragment and so fails the guard until it is tokenised, given an
// amethyst override, or added here with justification — which is the point.
export const PAPER_SURFACE_ALLOW: readonly PaperSurface[] = [
  // ── content-paper — intentionally white in both themes ──────────────────────────────────────
  { selector: '.ga98-sticky', note: 'sticky-note paper + swatch (content-intrinsic note colour)' },
  { selector: '.ga98-card-face', note: 'memory-match card face (content paper)' },
  { selector: '.ga98-sig-canvas', note: 'signature drawing canvas (white content paper)' },
  { selector: '.ga98-invoice-logo-box', note: 'invoice logo drop-well (white paper for pasted image)' },
  { selector: '.ga98-invoice-sig-box', note: 'invoice signature drop-well (white paper)' },
  { selector: '.ga98-invoice-preview', note: 'invoice document preview (white printed paper)' },
  { selector: '.ga98-docviewer-surface', note: 'document viewer paper (amethyst override present)' },
  { selector: '.ga98-report', note: 'Report module: classic-parity Win98 chrome, fully amethyst-overridden (theme.css Reports-amethyst block); content-paper .ga98-report-page/-doc-table stay white by design' },
  { selector: '.ga98-journal-blocks', note: 'Journal Jots block-editor page — content-paper, intentionally white in BOTH themes like .ga98-report-page: it hosts the reused Reports TextBlock/ImageBlock which render print-oriented dark text, legible only on a light page (a dark surface would make the reused blocks dark-on-dark)' },
  // ── classic-parity chrome — each carries a [data-ga98-theme=amethyst] override ──────────────
  { selector: '.ga98-dropzone', note: 'amethyst override at theme.css .ga98-dropzone' },
  { selector: '.ga98-grid-calendar', note: 'amethyst override at theme.css .ga98-grid-calendar > div[…]' },
  { selector: '.ga98-calc-hist-list', note: 'calculator history list — classic #fff, amethyst dark-inset override at theme.css' },
  // ── readable classic-chrome islands — explicit dark text on the rule, or a globally themed form
  //    element; dark-on-light, never light-on-light ────────────────────────────────────────────
  { selector: 'textarea.ga98-text', note: 'textarea — globally amethyst-themed (98.overrides textarea rule)' },
  { selector: '.ga98-cdp-field', note: 'coordinate-entry field — input, globally amethyst-themed' },
  { selector: '.ga98-cal-swatch-clear', note: 'calendar swatch-clear button — explicit color:#000 (readable)' },
  { selector: '.ga98-file-button', note: 'file-picker button — explicit color:#000 (readable)' },
  { selector: '.ga98-geo-map-placeholder', note: 'map-unavailable placeholder — explicit color:#555 (readable)' },
  // ── module chrome — each carries a module-local [data-ga98-theme=amethyst] override ─────────
  { selector: '.sl-sweep-btn', note: 'Searchlight sweep button — amethyst override in searchlight.css' },
  { selector: '.sl-graph-toolbar', note: 'Searchlight graph toolbar — amethyst override in searchlight.css' },
  { selector: '.sm-tabs', note: 'SOCMINT tabs — amethyst override in socmint.css' },
  { selector: '.sm-btn', note: 'SOCMINT button — amethyst override in socmint.css' },
  { selector: '.run-panel__feed', note: 'investigation run feed — amethyst override in investigation.css' },
];
