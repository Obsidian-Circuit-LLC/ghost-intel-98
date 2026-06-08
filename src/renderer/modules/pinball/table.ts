/**
 * Space-Cadet-style table: static geometry + dynamic playfield elements (bumpers, slingshots, drop
 * targets, rollover lanes, a ramp sensor, a wormhole lock) and the rank ladder. Geometry only — the
 * physics live in ./physics and the game loop in ./PinballModule. Canvas coords, y down (down-screen
 * is "downhill" on the raked table). Tuned by construction; feel needs an interactive pass.
 */
import type { Seg, V } from './physics';

export const W = 420;
export const H = 760;
export const BALL_R = 8;
export const BOTTOM_DRAIN = H + 16;

export const LEFT_PIVOT: V = { x: 150, y: 676 };
export const RIGHT_PIVOT: V = { x: 236, y: 676 };
export const FLIP_LEN = 62;
// Rest angles point the flippers slightly up-and-inward; active angles swing them up.
export const REST_ANG_L = 0.42, UP_ANG_L = -0.46;
export const REST_ANG_R = Math.PI - 0.42, UP_ANG_R = Math.PI + 0.46;

// Launch lane (far right), where the plunger fires the ball up and over into the playfield.
export const LANE_X = 386;
export const LANE_BALL_Y = 690;

/** Static walls (zero-width segments). */
export const WALLS: Seg[] = [
  { a: { x: 14, y: 130 }, b: { x: 14, y: 540 } },     // left wall
  { a: { x: 14, y: 540 }, b: { x: 120, y: 706 } },    // lower-left funnel → left flipper
  { a: { x: 14, y: 130 }, b: { x: 80, y: 56 } },      // top-left arch
  { a: { x: 80, y: 56 }, b: { x: 300, y: 48 } },      // top
  { a: { x: 300, y: 48 }, b: { x: 372, y: 120 } },    // top-right arch
  { a: { x: 372, y: 150 }, b: { x: 372, y: 700 } },   // launch-lane divider
  { a: { x: 372, y: 540 }, b: { x: 264, y: 706 } },   // lower-right funnel → right flipper
  { a: { x: 402, y: 80 }, b: { x: 402, y: 710 } },    // launch-lane outer wall
  { a: { x: 402, y: 80 }, b: { x: 360, y: 58 } },     // lane top cap
  { a: { x: 360, y: 58 }, b: { x: 312, y: 96 } }      // one-way deflector: launched ball curls left into play
];

export interface Bumper { p: V; r: number; score: number; kick: number }
export const BUMPERS: Bumper[] = [
  { p: { x: 150, y: 222 }, r: 20, score: 100, kick: 4.6 },
  { p: { x: 224, y: 182 }, r: 20, score: 100, kick: 4.6 },
  { p: { x: 298, y: 232 }, r: 18, score: 150, kick: 5.0 }
];

export interface Sling { a: V; b: V; kick: number; score: number }
export const SLINGS: Sling[] = [
  { a: { x: 96, y: 612 }, b: { x: 150, y: 650 }, kick: 6.2, score: 50 },   // left slingshot
  { a: { x: 290, y: 612 }, b: { x: 236, y: 650 }, kick: 6.2, score: 50 }   // right slingshot
];

export interface DropTarget { seg: Seg; score: number }
export const DROP_TARGETS: DropTarget[] = [
  { seg: { a: { x: 70, y: 300 }, b: { x: 70, y: 330 } }, score: 500 },
  { seg: { a: { x: 70, y: 335 }, b: { x: 70, y: 365 } }, score: 500 },
  { seg: { a: { x: 70, y: 370 }, b: { x: 70, y: 400 } }, score: 500 }
];
export const DROP_BANK_BONUS = 5000;

export interface Lane { p: V; r: number; score: number }
export const LANES: Lane[] = [
  { p: { x: 120, y: 82 }, r: 11, score: 1000 },
  { p: { x: 190, y: 76 }, r: 11, score: 1000 },
  { p: { x: 260, y: 82 }, r: 11, score: 1000 }
];

/** Ramp sensor: rolling through it scores and gives the ball an upward-left kick (feeds a combo). */
export const RAMP = { p: { x: 332, y: 150 } as V, r: 15, score: 2500 };
/** Wormhole lock: captures the ball; first lock holds, second arms multiball. */
export const WORMHOLE = { p: { x: 60, y: 198 } as V, r: 13 };

export const RANKS = [
  'Cadet', 'Ensign', 'Lieutenant', 'Lt. Commander', 'Commander',
  'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral', 'Fleet Admiral'
] as const;

/** Mutable per-game playfield state (what's lit / knocked down). */
export interface PlayfieldState {
  dropUp: boolean[];   // drop targets still standing
  lanesLit: boolean[]; // rollover lanes completed this set
  rank: number;        // index into RANKS
  locked: number;      // balls currently captured in the wormhole
}
export function makePlayfield(): PlayfieldState {
  return {
    dropUp: DROP_TARGETS.map(() => true),
    lanesLit: LANES.map(() => false),
    rank: 0,
    locked: 0
  };
}

/** A flipper segment from a pivot at a given angle. */
export function flipperSeg(pivot: V, ang: number): Seg {
  return { a: pivot, b: { x: pivot.x + Math.cos(ang) * FLIP_LEN, y: pivot.y + Math.sin(ang) * FLIP_LEN } };
}
