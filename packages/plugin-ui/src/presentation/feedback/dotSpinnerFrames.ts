import { DOT_SPINNER_STYLES, H_DOTS, type DotSpinnerStyleId } from './spinnerStyles.js';

/**
 * Dot styles are rendered as pre-sampled frames instead of animating each dot continuously.
 * Measured in headless Chromium with 1000 copies on screen: per-dot opacity animation at 60 fps
 * cost ≈113% CPU (the compositor thread ticks one animation per dot); the same wave as a 40-frame
 * strip stepped by one transform cost ≈56%. Cost scales with the frame rate (15 fps ≈29%, 46 fps
 * ≈74%), so 30 fps is a deliberate point: four times the old stepped ring's ≈7 fps, which read as
 * laggy, at half the per-dot cost.
 */
export const DOT_SPINNER_FRAMES_PER_SECOND = 30;

/** Every dot at this ink is the still pose: paused spinners and reduced motion. */
export const DOT_SPINNER_STILL_OPACITY = 0.85;

export type DotSpinnerFrames = Readonly<{
  styleId: DotSpinnerStyleId;
  cycleMs: number;
  frameCount: number;
  ink: 'mono' | 'aurora';
  /** `frameCount × H_DOTS.length`, frame-major. */
  opacity: readonly number[];
  /** Same layout as `opacity`; only for aurora. Position on the looping accent gradient, 0–1. */
  hue: readonly number[] | null;
}>;

const framesCache = new Map<DotSpinnerStyleId, DotSpinnerFrames>();

function round2(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function getDotSpinnerFrames(styleId: DotSpinnerStyleId): DotSpinnerFrames {
  const cached = framesCache.get(styleId);
  if (cached) return cached;

  const style = DOT_SPINNER_STYLES[styleId];
  const frameCount = Math.round((style.cycleMs * DOT_SPINNER_FRAMES_PER_SECOND) / 1000);
  const opacity: number[] = [];
  const hue: number[] | null = style.hue ? [] : null;
  for (let frame = 0; frame < frameCount; frame++) {
    const tMs = (frame * style.cycleMs) / frameCount;
    for (const dot of H_DOTS) {
      opacity.push(round2(style.opacity(dot, tMs)));
      if (hue && style.hue) hue.push(round2(style.hue(dot, tMs)));
    }
  }
  const frames: DotSpinnerFrames = { styleId, cycleMs: style.cycleMs, frameCount, ink: style.ink, opacity, hue };
  framesCache.set(styleId, frames);
  return frames;
}

/** One dot's column of a frame table, in frame order. */
export function readDotSeries(table: readonly number[], dotIndex: number, frameCount: number): number[] {
  const series: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) series.push(table[frame * H_DOTS.length + dotIndex]!);
  return series;
}

/**
 * A hue series with its wraps removed, so interpolating between neighbouring frames never sweeps
 * the long way round the gradient (0.98 → 0.01 would otherwise flash through every accent).
 */
export function unwrapHueSeries(series: readonly number[]): number[] {
  const unwrapped: number[] = [];
  for (const value of series) {
    const previous = unwrapped[unwrapped.length - 1];
    if (previous === undefined) {
      unwrapped.push(value);
      continue;
    }
    let next = value;
    while (next - previous > 0.5) next -= 1;
    while (previous - next > 0.5) next += 1;
    unwrapped.push(next);
  }
  return unwrapped;
}

/**
 * Where a hue position falls on the looping three-stop accent gradient: the two stop indices and how
 * far to blend from the first to the second. Renderers blend by painting stop `from` opaque and stop
 * `to` over it at `mix`, which is an exact linear blend for any CSS color without parsing it.
 */
export function resolveAuroraBlend(hue: number): Readonly<{ from: 0 | 1 | 2; to: 0 | 1 | 2; mix: number }> {
  const scaled = (((hue % 1) + 1) % 1) * 3;
  const from = (Math.floor(scaled) % 3) as 0 | 1 | 2;
  return { from, to: ((from + 1) % 3) as 0 | 1 | 2, mix: Math.round((scaled - Math.floor(scaled)) * 100) / 100 };
}

export type DotSpinnerInk = Readonly<{ color: string }> | Readonly<{ aurora: readonly [string, string, string] }>;

const DOT_RADIUS = 0.25;

function escapeAttribute(value: string): string {
  return value.replace(/[&"'<>]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function dotMarkup(cx: number, cy: number, opacity: number, ink: DotSpinnerInk, hue: number | null): string {
  if ('color' in ink || hue === null) {
    return `<circle cx="${cx}" cy="${cy}" r="${DOT_RADIUS}" fill-opacity="${opacity}"/>`;
  }
  const { from, to, mix } = resolveAuroraBlend(hue);
  const base = `<circle cx="${cx}" cy="${cy}" r="${DOT_RADIUS}" fill="${escapeAttribute(ink.aurora[from])}"/>`;
  const blend = mix > 0
    ? `<circle cx="${cx}" cy="${cy}" r="${DOT_RADIUS}" fill="${escapeAttribute(ink.aurora[to])}" fill-opacity="${mix}"/>`
    : '';
  return `<g opacity="${opacity}">${base}${blend}</g>`;
}

function svgDocument(width: number, ink: DotSpinnerInk, body: string): string {
  const fill = 'color' in ink ? ` fill="${escapeAttribute(ink.color)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 3" width="${width * 8}" height="24"${fill}>${body}</svg>`;
}

/** Every frame side by side, 3 units wide each; stepping a clip across it plays the animation. */
export function buildDotSpinnerFilmstripSvg(frames: DotSpinnerFrames, ink: DotSpinnerInk): string {
  let body = '';
  for (let frame = 0; frame < frames.frameCount; frame++) {
    for (let i = 0; i < H_DOTS.length; i++) {
      const dot = H_DOTS[i]!;
      const index = frame * H_DOTS.length + i;
      body += dotMarkup(frame * 3 + dot.col + 0.5, dot.row + 0.5, frames.opacity[index]!, ink, frames.hue?.[index] ?? null);
    }
  }
  return svgDocument(frames.frameCount * 3, ink, body);
}

export function buildDotSpinnerStillSvg(frames: DotSpinnerFrames, ink: DotSpinnerInk): string {
  let body = '';
  for (let i = 0; i < H_DOTS.length; i++) {
    const dot = H_DOTS[i]!;
    body += dotMarkup(dot.col + 0.5, dot.row + 0.5, DOT_SPINNER_STILL_OPACITY, ink, frames.hue?.[i] ?? null);
  }
  return svgDocument(3, ink, body);
}
