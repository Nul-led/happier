import { afterEach, describe, expect, it } from 'vitest';

import { mountThroughReactNativeWebAsync, type RnwMount } from '../../rnwMount.testSupport.js';
import { HappierSpinner, resolveHappierSpinnerPresentation, resolveHappierWebSpinnerPresentation } from './Spinner.js';

describe('shared web-spinner presentation', () => {
  it('keeps a reduced-motion spinner visible while removing its continuous animation', () => {
    const presentation = resolveHappierWebSpinnerPresentation({
      animating: true,
      animationEnabled: true,
      color: 'red',
      reducedMotion: true,
      size: 12,
    });

    expect(presentation?.style).toMatchObject({
      width: 12,
      height: 12,
      borderColor: 'red',
      opacity: 1,
    });
    expect(presentation?.style.animationName).toBeUndefined();
    expect(presentation?.style.animationIterationCount).toBeUndefined();
    expect(presentation?.style.willChange).toBeUndefined();
  });

  it('uses the small-spinner stepped timing and hides a stopped hidden spinner', () => {
    expect(resolveHappierWebSpinnerPresentation({
      animating: false,
      hidesWhenStopped: true,
    })).toBeNull();

    const presentation = resolveHappierWebSpinnerPresentation({
      animating: true,
      animationEnabled: true,
      size: 'small',
    });

    expect(presentation?.style.animationName).toBe('happierActivitySpinnerSpin');
    expect(presentation?.style.animationTimingFunction).toBe('steps(6, end)');
  });
});

describe('shared spinner presentation (dot styles)', () => {
  const base = { platform: 'web', defaultColor: 'theme-secondary' } as const;

  it('draws the H wave by default in a self-centred square box', () => {
    const presentation = resolveHappierSpinnerPresentation({ ...base, size: 12 });

    expect(presentation?.kind).toBe('dots');
    if (presentation?.kind !== 'dots') throw new Error('expected dots');
    expect(presentation.accessibilityRole).toBe('progressbar');
    expect(presentation.style).toEqual({ width: 12, height: 12, alignSelf: 'center', overflow: 'hidden' });
    expect(presentation.dots).toEqual({ styleId: 'wave', size: 12, motion: 'animate', ink: { color: 'theme-secondary' } });
  });

  it('draws the chosen style, and the wave for an id it does not know', () => {
    const radar = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'radar' });
    const retired = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'retiredStyle' });

    expect(radar?.kind === 'dots' ? radar.dots?.styleId : null).toBe('radar');
    expect(retired?.kind === 'dots' ? retired.dots?.styleId : null).toBe('wave');
  });

  it('keeps the classic ring as its own choice on each platform', () => {
    const web = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'classicRing', size: 12, color: 'red' });
    expect(web?.kind).toBe('webRing');
    expect(web?.kind === 'webRing' ? web.style.animationName : null).toBe('happierActivitySpinnerSpin');

    const native = resolveHappierSpinnerPresentation({ ...base, platform: 'native', indicatorStyle: 'classicRing', reducedMotion: true });
    expect(native).toEqual({ kind: 'nativeRing', color: 'theme-secondary', animating: false, hidesWhenStopped: false });
  });

  it('holds the still H when paused, and breathes it under reduced motion', () => {
    const paused = resolveHappierSpinnerPresentation({ ...base, animationEnabled: false });
    const stoppedButShown = resolveHappierSpinnerPresentation({ ...base, animating: false, hidesWhenStopped: false });
    const reduced = resolveHappierSpinnerPresentation({ ...base, reducedMotion: true });

    expect(paused?.kind === 'dots' ? paused.dots?.motion : null).toBe('still');
    expect(stoppedButShown?.kind === 'dots' ? stoppedButShown.dots?.motion : null).toBe('still');
    expect(reduced?.kind === 'dots' ? reduced.dots?.motion : null).toBe('breathe');
  });

  it('renders nothing on web but keeps the layout box on native when stopped and hidden', () => {
    expect(resolveHappierSpinnerPresentation({ ...base, animating: false })).toBeNull();
    const native = resolveHappierSpinnerPresentation({ ...base, platform: 'native', animating: false, size: 18 });
    expect(native?.kind).toBe('dots');
    expect(native?.kind === 'dots' ? native.dots : undefined).toBeNull();
    expect(native?.style).toMatchObject({ width: 18, height: 18 });
  });

  it('colors aurora with the theme accents, but an explicit color wins so the mark stays legible on tinted buttons', () => {
    const accents = ['accent-indigo', 'accent-purple', 'accent-orange'] as const;
    const themed = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'aurora', auroraAccents: accents });
    const tinted = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'aurora', auroraAccents: accents, color: 'white' });
    const noAccents = resolveHappierSpinnerPresentation({ ...base, indicatorStyle: 'aurora' });

    expect(themed?.kind === 'dots' ? themed.dots?.ink : null).toEqual({ aurora: accents });
    expect(tinted?.kind === 'dots' ? tinted.dots?.ink : null).toEqual({ color: 'white' });
    expect(noAccents?.kind === 'dots' ? noAccents.dots?.ink : null).toEqual({ color: 'theme-secondary' });
  });
});

describe('HappierSpinner on web (dot styles)', () => {
  let mount: RnwMount | null = null;

  afterEach(() => {
    mount?.unmount();
    mount = null;
    for (const node of document.head.querySelectorAll('style[id^="happier-activity-spinner-"]')) node.remove();
  });

  function strip(): HTMLElement {
    const node = mount!.container.querySelector<HTMLElement>('[data-happier-activity-spinner]');
    if (!node) throw new Error('Expected the frame strip');
    return node;
  }

  function frameSheetFor(node: HTMLElement): string {
    const key = node.getAttribute('data-happier-activity-spinner');
    const rule = [...document.head.querySelectorAll('style')].map((style) => style.textContent ?? '').find((css) => css.includes(`"${key}"`));
    const payload = rule?.match(/data:image\/svg\+xml,([^")]+)/)?.[1];
    if (!payload) throw new Error(`Expected a frame-sheet rule for ${key}`);
    return decodeURIComponent(payload);
  }

  it('steps a strip of pre-drawn frames with one transform animation, sharing one sheet per style and ink', async () => {
    mount = await mountThroughReactNativeWebAsync(
      <>
        <HappierSpinner size={12} color="red" testID="a" />
        <HappierSpinner size={20} color="red" testID="b" />
      </>,
    );

    const strips = [...mount.container.querySelectorAll<HTMLElement>('[data-happier-activity-spinner]')];
    expect(strips).toHaveLength(2);
    expect(strips[0]!.getAttribute('data-happier-activity-spinner')).toBe(strips[1]!.getAttribute('data-happier-activity-spinner'));
    expect(document.head.querySelectorAll('style[id^="happier-activity-spinner-"]')).toHaveLength(1);
    expect(strips[0]!.style.animationName).toBe('happierActivitySpinnerFilmstrip');
    expect(strips[0]!.style.animationDuration).toBe('1300ms');
    expect(strips[0]!.style.animationTimingFunction).toBe('steps(39, end)');
    expect(strips[0]!.style.width).toBe('3900%');
    expect(frameSheetFor(strips[0]!)).toContain('fill="red"');
  });

  it('holds the still H without scheduling any animation when ambient motion is paused', async () => {
    mount = await mountThroughReactNativeWebAsync(<HappierSpinner size={12} color="red" animationEnabled={false} />);

    expect(strip().style.animationName).toBe('');
    expect(frameSheetFor(strip())).toContain('fill-opacity="0.85"');
  });

  it('replaces the travelling light with a slow breath of the still H under reduced motion', async () => {
    mount = await mountThroughReactNativeWebAsync(<HappierSpinner size={12} color="red" reducedMotion />);

    expect(strip().style.animationName).toBe('happierActivitySpinnerBreath');
    expect(frameSheetFor(strip())).toContain('fill-opacity="0.85"');
  });
});
