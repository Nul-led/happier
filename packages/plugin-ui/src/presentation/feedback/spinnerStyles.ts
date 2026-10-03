/**
 * The loading-indicator styles, as data.
 *
 * Every id except `classicRing` is a dot style: the H of Happier on a 3 × 3 grid, both stems plus
 * the centre dot as the crossbar (the top and bottom centre cells stay empty). A dot style is only a
 * cycle length and a function that says how bright each dot is at a moment in that cycle.
 * `dotSpinnerFrames.ts` samples it into a frame table that both platforms render, so adding a style
 * never adds a renderer. `classicRing` keeps the original rotating ring.
 */
export const HAPPIER_SPINNER_STYLE_IDS = [
  'wave',
  'handwritten',
  'buildAndRelease',
  'relay',
  'twinStems',
  'slowBreath',
  'starfield',
  'sweep',
  'radar',
  'ripple',
  'aurora',
  'classicRing',
] as const;

export type HappierSpinnerStyleId = (typeof HAPPIER_SPINNER_STYLE_IDS)[number];

export const DEFAULT_HAPPIER_SPINNER_STYLE_ID = 'wave' satisfies HappierSpinnerStyleId;

const HAPPIER_SPINNER_STYLE_ID_SET: ReadonlySet<string> = new Set(HAPPIER_SPINNER_STYLE_IDS);

export function isHappierSpinnerStyleId(value: unknown): value is HappierSpinnerStyleId {
  return typeof value === 'string' && HAPPIER_SPINNER_STYLE_ID_SET.has(value);
}

/** An id this build does not know (written by a newer build, or since removed) draws the default. */
export function normalizeHappierSpinnerStyleId(value: unknown): HappierSpinnerStyleId {
  return isHappierSpinnerStyleId(value) ? value : DEFAULT_HAPPIER_SPINNER_STYLE_ID;
}

export type DotSpinnerStyleId = Exclude<HappierSpinnerStyleId, 'classicRing'>;

export type HDotId = 'TL' | 'ML' | 'BL' | 'MC' | 'TR' | 'MR' | 'BR';

export type HDot = Readonly<{ id: HDotId; col: 0 | 1 | 2; row: 0 | 1 | 2 }>;

/** Fixed order; a dot's index here is its column in every frame table. */
export const H_DOTS: readonly HDot[] = [
  { id: 'TL', col: 0, row: 0 },
  { id: 'ML', col: 0, row: 1 },
  { id: 'BL', col: 0, row: 2 },
  { id: 'MC', col: 1, row: 1 },
  { id: 'TR', col: 2, row: 0 },
  { id: 'MR', col: 2, row: 1 },
  { id: 'BR', col: 2, row: 2 },
];

export type DotSpinnerStyle = Readonly<{
  cycleMs: number;
  /** `aurora` dots also carry a hue position that renderers map onto theme accent colors. */
  ink: 'mono' | 'aurora';
  opacity: (dot: HDot, tMs: number) => number;
  hue?: (dot: HDot, tMs: number) => number;
}>;

/** Ink on an idle dot. The Grok reference measured 23%; 20% keeps the H legible without competing. */
export const DOT_REST_OPACITY = 0.2;

type Envelope = Readonly<{ stops: readonly (readonly [at: number, opacity: number])[]; easeInOut?: boolean }>;

const R = DOT_REST_OPACITY;
/** Fast attack, short plateau, soft tail, rest: the reference envelope (≈370 ms lit at a 1.3 s cycle). */
const PULSE: Envelope = { stops: [[0, R], [0.05, 1], [0.18, 0.88], [0.28, R], [1, R]] };
const HOLD: Envelope = { stops: [[0, R], [0.05, 1], [0.6, 1], [0.72, R], [1, R]] };
const BUILD: Envelope = { stops: [[0, R], [0.04, 1], [0.58, 1], [0.7, R], [1, R]] };
const TIGHT: Envelope = { stops: [[0, R], [0.04, 1], [0.12, 0.5], [0.24, R], [1, R]] };
const TWINKLE: Envelope = { stops: [[0, R], [0.08, 1], [0.34, R], [1, R]] };
const BREATHE: Envelope = { stops: [[0, R], [0.5, 1], [1, R]], easeInOut: true };

function sampleEnvelope(envelope: Envelope, x: number): number {
  const { stops } = envelope;
  for (let i = 1; i < stops.length; i++) {
    const [b, vb] = stops[i]!;
    if (x > b) continue;
    const [a, va] = stops[i - 1]!;
    const linear = b === a ? 1 : (x - a) / (b - a);
    const k = envelope.easeInOut ? linear * linear * (3 - 2 * linear) : linear;
    return va + (vb - va) * k;
  }
  return stops[stops.length - 1]![1];
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1;
}

/** 0 at the bottom-left foot, 1 at the top-right corner. */
function diagonal(dot: HDot): number {
  return (dot.col + (2 - dot.row)) / 4;
}

function staggered(params: Readonly<{
  cycleMs: number;
  stepMs: number;
  envelope: Envelope;
  rank: (dot: HDot) => number | null;
}>): DotSpinnerStyle {
  const { cycleMs, stepMs, envelope, rank } = params;
  return {
    cycleMs,
    ink: 'mono',
    opacity: (dot, tMs) => {
      const k = rank(dot);
      if (k === null) return R;
      return sampleEnvelope(envelope, wrap01((tMs - k * stepMs) / cycleMs));
    },
  };
}

function byId(ranks: Partial<Record<HDotId, number>>): (dot: HDot) => number | null {
  return (dot) => ranks[dot.id] ?? null;
}

const diagonalRank = (dot: HDot) => diagonal(dot) * 4;

/** A comet with a soft leading edge and a longer trailing tail, given how far a dot sits behind the head. */
function comet(behindHead: number, tail: number, lead: number): number {
  if (behindHead < 0) {
    return behindHead > -lead ? R + (1 - R) * (1 + behindHead / lead) : R;
  }
  return behindHead <= tail ? R + (1 - R) * Math.pow(1 - behindHead / tail, 1.5) : R;
}

/** Starfield loops every 2.4 s; each dot's own cycle divides it so the loop is seamless. */
const STARFIELD_LOOP_MS = 2400;
const STARFIELD_TRACKS: Readonly<Record<HDotId, readonly [cycleMs: number, delayMs: number]>> = {
  TL: [1200, 0],
  ML: [2400, 400],
  BL: [800, 300],
  MC: [1200, 700],
  TR: [2400, 1500],
  MR: [600, 100],
  BR: [800, 650],
};

const SWEEP_ACTIVE_FRACTION = 0.72;
const RIPPLE_ACTIVE_FRACTION = 0.7;

export const DOT_SPINNER_STYLES: Readonly<Record<DotSpinnerStyleId, DotSpinnerStyle>> = {
  wave: staggered({ cycleMs: 1300, stepMs: 110, envelope: PULSE, rank: diagonalRank }),
  handwritten: staggered({
    cycleMs: 1500,
    stepMs: 90,
    envelope: HOLD,
    rank: byId({ TL: 0, ML: 1, BL: 2, MC: 3.4, TR: 4.8, MR: 5.8, BR: 6.8 }),
  }),
  buildAndRelease: staggered({ cycleMs: 1700, stepMs: 95, envelope: BUILD, rank: diagonalRank }),
  relay: staggered({
    cycleMs: 1200,
    stepMs: 95,
    envelope: TIGHT,
    rank: byId({ BL: 0, ML: 1, MC: 2, MR: 3, TR: 4 }),
  }),
  twinStems: staggered({
    cycleMs: 1300,
    stepMs: 130,
    envelope: PULSE,
    rank: byId({ BL: 0, BR: 0, ML: 1, MR: 1, MC: 1.5, TL: 2, TR: 2 }),
  }),
  slowBreath: staggered({ cycleMs: 2400, stepMs: 70, envelope: BREATHE, rank: diagonalRank }),
  starfield: {
    cycleMs: STARFIELD_LOOP_MS,
    ink: 'mono',
    opacity: (dot, tMs) => {
      const [cycleMs, delayMs] = STARFIELD_TRACKS[dot.id];
      return sampleEnvelope(TWINKLE, wrap01((tMs - delayMs) / cycleMs));
    },
  },
  sweep: {
    cycleMs: 1300,
    ink: 'mono',
    opacity: (dot, tMs) => {
      const p = wrap01(tMs / 1300);
      const head = p < SWEEP_ACTIVE_FRACTION ? -0.1 + (p / SWEEP_ACTIVE_FRACTION) * 1.7 : 2;
      return comet(head - diagonal(dot), 0.55, 0.08);
    },
  },
  radar: {
    cycleMs: 1100,
    ink: 'mono',
    opacity: (dot, tMs) => {
      if (dot.col === 1 && dot.row === 1) return 0.55;
      const angle = wrap01(Math.atan2(dot.col - 1, 1 - dot.row) / (2 * Math.PI));
      const behind = wrap01(tMs / 1100 - angle);
      return comet(behind > 0.96 ? behind - 1 : behind, 0.5, 0.04);
    },
  },
  ripple: {
    cycleMs: 1500,
    ink: 'mono',
    opacity: (dot, tMs) => {
      const p = Math.min(1, wrap01(tMs / 1500) / RIPPLE_ACTIVE_FRACTION);
      const ring = (1 - Math.pow(1 - p, 3)) * 1.45 - 0.1;
      const radius = Math.hypot(dot.col - 1, dot.row - 1) / Math.SQRT2;
      return R + (1 - R) * Math.max(0, 1 - Math.abs(radius - ring) / 0.3);
    },
  },
  aurora: {
    cycleMs: 2600,
    ink: 'aurora',
    opacity: () => 0.92,
    hue: (dot, tMs) => wrap01(diagonal(dot) * 0.6 - tMs / 2600),
  },
};
