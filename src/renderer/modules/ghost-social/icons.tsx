/**
 * Ghost Social Media Manager (hardened GI98 port) — self-contained inline-SVG icon set.
 *
 * His source used `lucide-react`, which is NOT a GI98 dependency (adding a heavy icon package
 * for one module violates the in-tree/determinism constraint). These are small hand-drawn inline
 * SVGs — `stroke="currentColor"`, so they inherit the teal-console colour tokens with no colour
 * literals of their own (no-straggler safe: inline <svg> payloads are exempt anyway). Only the
 * glyphs his UI actually references are provided; each takes an optional `size`.
 */
import type { SVGProps } from 'react';

type P = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function S({ size = 18, children, ...rest }: P & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Plus = (p: P): JSX.Element => <S {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></S>;
export const Settings = (p: P): JSX.Element => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></S>;
export const Lock = (p: P): JSX.Element => <S {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></S>;
export const Send = (p: P): JSX.Element => <S {...p}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></S>;
export const Inbox = (p: P): JSX.Element => <S {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></S>;
export const History = (p: P): JSX.Element => <S {...p}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></S>;
export const ChevronDown = (p: P): JSX.Element => <S {...p}><polyline points="6 9 12 15 18 9" /></S>;
export const Trash2 = (p: P): JSX.Element => <S {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></S>;
export const Edit3 = (p: P): JSX.Element => <S {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></S>;
export const ArrowLeft = (p: P): JSX.Element => <S {...p}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></S>;
export const ArrowRight = (p: P): JSX.Element => <S {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></S>;
export const RotateCw = (p: P): JSX.Element => <S {...p}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></S>;
export const Home = (p: P): JSX.Element => <S {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></S>;
export const ExternalLink = (p: P): JSX.Element => <S {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></S>;
export const Image = (p: P): JSX.Element => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></S>;
export const Video = (p: P): JSX.Element => <S {...p}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></S>;
export const MessageSquare = (p: P): JSX.Element => <S {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></S>;
export const Search = (p: P): JSX.Element => <S {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></S>;
export const X = (p: P): JSX.Element => <S {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></S>;
export const ShieldCheck = (p: P): JSX.Element => <S {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></S>;
export const ShieldAlert = (p: P): JSX.Element => <S {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12" y2="16" /></S>;
export const ShieldOff = (p: P): JSX.Element => <S {...p}><path d="M19.7 14a6.9 6.9 0 0 0 .3-2V5l-8-3-3.2 1.2" /><path d="M4.7 4.7 4 5v7c0 6 8 10 8 10a13 13 0 0 0 5-2.8" /><line x1="2" y1="2" x2="22" y2="22" /></S>;
export const KeyRound = (p: P): JSX.Element => <S {...p}><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15 19 4" /><path d="m18 5 2 2" /><path d="m15 8 2 2" /></S>;
export const Save = (p: P): JSX.Element => <S {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></S>;
export const LayoutDashboard = (p: P): JSX.Element => <S {...p}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></S>;
export const RefreshCw = (p: P): JSX.Element => <S {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></S>;
export const Users = (p: P): JSX.Element => <S {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></S>;
export const UserPlus = (p: P): JSX.Element => <S {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></S>;
export const Pencil = (p: P): JSX.Element => <S {...p}><path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></S>;
export const GripVertical = (p: P): JSX.Element => <S {...p}><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></S>;
export const CalendarClock = (p: P): JSX.Element => <S {...p}><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><circle cx="17" cy="17" r="4" /><path d="M17 15.5V17l1 1" /></S>;
export const Play = (p: P): JSX.Element => <S {...p}><polygon points="5 3 19 12 5 21 5 3" /></S>;
export const Pause = (p: P): JSX.Element => <S {...p}><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></S>;
