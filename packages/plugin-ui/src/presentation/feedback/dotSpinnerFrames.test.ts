import { describe, expect, it } from 'vitest';

import {
  buildDotSpinnerFilmstripSvg,
  buildDotSpinnerStillSvg,
  DOT_SPINNER_FRAMES_PER_SECOND,
  getDotSpinnerFrames,
  readDotSeries,
  resolveAuroraBlend,
  unwrapHueSeries,
} from './dotSpinnerFrames.js';
import {
  DOT_SPINNER_STYLES,
  H_DOTS,
  HAPPIER_SPINNER_STYLE_IDS,
  normalizeHappierSpinnerStyleId,
  type DotSpinnerStyleId,
} from './spinnerStyles.js';

const DOT_STYLE_IDS = HAPPIER_SPINNER_STYLE_IDS.filter((id): id is DotSpinnerStyleId => id !== 'classicRing');

function dotSeries(styleId: DotSpinnerStyleId, dotId: string): number[] {
  const frames = getDotSpinnerFrames(styleId);
  return readDotSeries(frames.opacity, H_DOTS.findIndex((dot) => dot.id === dotId), frames.frameCount);
}

describe('dot spinner frames', () => {
  it('gives every selectable dot style a style definition', () => {
    expect(Object.keys(DOT_SPINNER_STYLES).sort()).toEqual([...DOT_STYLE_IDS].sort());
  });

  it('draws the wave for an id this build does not know', () => {
    expect(normalizeHappierSpinnerStyleId('radar')).toBe('radar');
    expect(normalizeHappierSpinnerStyleId('retiredStyle')).toBe('wave');
    expect(normalizeHappierSpinnerStyleId(undefined)).toBe('wave');
  });

  it.each(DOT_STYLE_IDS)('%s plays at the shared frame rate, loops without a seam, and visibly moves', (styleId) => {
    const style = DOT_SPINNER_STYLES[styleId];
    const frames = getDotSpinnerFrames(styleId);

    expect(frames.frameCount).toBe(Math.round((style.cycleMs * DOT_SPINNER_FRAMES_PER_SECOND) / 1000));
    expect(frames.opacity).toHaveLength(frames.frameCount * H_DOTS.length);
    expect(frames.opacity.every((value) => value >= 0 && value <= 1)).toBe(true);

    for (const dot of H_DOTS) {
      expect(style.opacity(dot, style.cycleMs)).toBeCloseTo(style.opacity(dot, 0), 5);
      if (style.hue) expect(style.hue(dot, style.cycleMs) % 1).toBeCloseTo(style.hue(dot, 0) % 1, 5);
    }

    const signal = frames.hue ?? frames.opacity;
    const swing = Math.max(...H_DOTS.map((_, i) => {
      const series = readDotSeries(signal, i, frames.frameCount);
      return Math.max(...series) - Math.min(...series);
    }));
    expect(swing).toBeGreaterThan(0.5);
  });

  it('lights the wave from the bottom-left foot to the top-right corner', () => {
    const peakFrame = (dotId: string) => {
      const series = dotSeries('wave', dotId);
      return series.indexOf(Math.max(...series));
    };

    expect(peakFrame('BL')).toBeLessThan(peakFrame('ML'));
    expect(peakFrame('ML')).toBeLessThan(peakFrame('TL'));
    expect(peakFrame('TL')).toBe(peakFrame('MC'));
    expect(peakFrame('MC')).toBe(peakFrame('BR'));
    expect(peakFrame('BR')).toBeLessThan(peakFrame('MR'));
    expect(peakFrame('MR')).toBeLessThan(peakFrame('TR'));
  });

  it('draws every frame of a strip in the requested ink', () => {
    const frames = getDotSpinnerFrames('wave');
    const svg = buildDotSpinnerFilmstripSvg(frames, { color: '#123456' });

    expect(svg).toContain(`viewBox="0 0 ${frames.frameCount * 3} 3"`);
    expect(svg).toContain('fill="#123456"');
    expect(svg.match(/<circle /g)).toHaveLength(frames.frameCount * H_DOTS.length);
    expect(buildDotSpinnerStillSvg(frames, { color: '#123456' }).match(/<circle /g)).toHaveLength(H_DOTS.length);
  });

  it('blends aurora dots across the three accent colors and keeps color values out of the markup syntax', () => {
    expect(resolveAuroraBlend(0)).toEqual({ from: 0, to: 1, mix: 0 });
    expect(resolveAuroraBlend(0.5)).toEqual({ from: 1, to: 2, mix: 0.5 });
    expect(resolveAuroraBlend(0.9)).toEqual({ from: 2, to: 0, mix: 0.7 });

    const svg = buildDotSpinnerFilmstripSvg(getDotSpinnerFrames('aurora'), { aurora: ['#111111', 'rgb(1, 2, 3)', '"><x'] });
    expect(svg).toContain('fill="#111111"');
    expect(svg).toContain('fill="rgb(1, 2, 3)"');
    expect(svg).not.toContain('"><x');
  });

  it('removes hue wraps so neighbouring frames never sweep the long way round the gradient', () => {
    expect(unwrapHueSeries([0.1, 0.02, 0.95, 0.9])).toEqual([0.1, 0.02, -0.05, -0.1].map((value) => expect.closeTo(value, 5)));

    const frames = getDotSpinnerFrames('aurora');
    for (let i = 0; i < H_DOTS.length; i++) {
      const series = unwrapHueSeries(readDotSeries(frames.hue!, i, frames.frameCount));
      for (let frame = 1; frame < series.length; frame++) {
        expect(Math.abs(series[frame]! - series[frame - 1]!)).toBeLessThan(0.1);
      }
    }
  });
});
