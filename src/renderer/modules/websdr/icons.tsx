/**
 * WebSDR Viewer — inline-SVG icon set (Phase 4).
 *
 * His source used `lucide-react`; GI98 does not carry that dependency (searchlight/socmint dropped
 * it — "icons are inline SVG or Unicode"). These are the small stroke glyphs his `App.tsx` used,
 * reimplemented as inline `<svg currentColor>` so they inherit the fixed-green console ink and are
 * exempt from the no-straggler guard (rule c: `<svg>…</svg>` payloads are skipped). One shared
 * wrapper keeps the stroke geometry uniform (lucide's 24-box, 2px stroke).
 */

import type { JSX } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  fill?: string;
}

function Svg({ size = 16, className, children, fill }: IconProps & { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconRadio = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2" />
    <path d="M4.93 19.07a10 10 0 0 1 0-14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48M19.07 4.93a10 10 0 0 1 0 14.14" />
  </Svg>
);
export const IconPlus = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconPencil = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></Svg>
);
export const IconTrash = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>
);
export const IconStar = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></Svg>
);
export const IconExternal = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>
);
export const IconActivity = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Svg>
);
export const IconSave = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8" /></Svg>
);
export const IconVolume = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></Svg>
);
export const IconVolumeMute = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M11 5 6 9H2v6h4l5 4V5ZM23 9l-6 6M17 9l6 6" /></Svg>
);
export const IconRefresh = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" /></Svg>
);
export const IconList = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>
);
export const IconBookmark = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></Svg>
);
export const IconSliders = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></Svg>
);
export const IconMenu = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M3 12h18M3 6h18M3 18h18" /></Svg>
);
export const IconChevronUp = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="m18 15-6-6-6 6" /></Svg>
);
export const IconChevronDown = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const IconEye = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconEyeOff = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22M9.88 9.88a3 3 0 0 0 4.24 4.24" /></Svg>
);
export const IconReset = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M3 2v6h6M3.05 13A9 9 0 1 0 6 5.3L3 8" /></Svg>
);
export const IconSettings = (p: IconProps): JSX.Element => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 8.6l.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 4.6a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 19.4 8.6l.06-.06a2 2 0 0 1 2.83 2.83Z" /></Svg>
);
export const IconAlert = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01" /></Svg>
);
export const IconFile = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M16 13H8M16 17H8M10 9H8" /></Svg>
);
export const IconX = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
);
export const IconArchive = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></Svg>
);
export const IconVideo = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="m23 7-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /></Svg>
);
export const IconSquare = (p: IconProps): JSX.Element => (
  <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="1" /></Svg>
);
export const IconDownload = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></Svg>
);
export const IconPlay = (p: IconProps): JSX.Element => (
  <Svg {...p} fill="currentColor"><path d="M5 3l14 9-14 9V3Z" /></Svg>
);
export const IconSearch = (p: IconProps): JSX.Element => (
  <Svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></Svg>
);
export const IconShield = (p: IconProps): JSX.Element => (
  <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></Svg>
);
