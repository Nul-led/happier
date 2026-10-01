import * as React from 'react';

import {
  buildDotSpinnerFilmstripSvg,
  buildDotSpinnerStillSvg,
  getDotSpinnerFrames,
  type DotSpinnerInk,
} from './dotSpinnerFrames.js';
import { HAPPIER_SPINNER_BREATH_ANIMATION, HAPPIER_SPINNER_FILMSTRIP_ANIMATION } from './spinnerKeyframes.js';
import type { DotSpinnerStyleId } from './spinnerStyles.js';

const FILMSTRIP_ANIMATION_NAME = HAPPIER_SPINNER_FILMSTRIP_ANIMATION;
const BREATH_ANIMATION_NAME = HAPPIER_SPINNER_BREATH_ANIMATION;
const FRAME_SHEET_ATTRIBUTE = 'data-happier-activity-spinner';

const useInsertionEffectSafe: typeof React.useEffect =
  typeof React.useInsertionEffect === 'function' ? React.useInsertionEffect : React.useLayoutEffect;

/**
 * One `<style>` rule per style × ink × pose, shared by every copy on the page. The frame sheet is a
 * ≈20 KB SVG; putting it in each spinner's inline style would copy it into every DOM node. The
 * document itself is the registry (an id lookup), so a sheet removed from the page is re-added by the
 * next spinner that needs it, and the SVG is only built when it is missing.
 */
function injectFrameSheet(key: string, buildSvg: () => string): void {
  if (typeof document === 'undefined') return;
  const id = `happier-activity-spinner-${key}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent =
    `[${FRAME_SHEET_ATTRIBUTE}="${key}"]{display:block;height:100%;` +
    `background:url("data:image/svg+xml,${encodeURIComponent(buildSvg())}") 0 0/100% 100% no-repeat}`;
  document.head.appendChild(style);
}

function hashInk(ink: DotSpinnerInk): string {
  const source = 'color' in ink ? ink.color : ink.aurora.join('|');
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/**
 * Pins the strip's animation to the document timeline's origin, so every spinner on the page steps
 * on the same frames however far apart they mounted. Unsynced copies each make the compositor draw
 * on their own step boundaries: measured, the same 1000 strips cost ≈56% CPU synced and ≈82% not.
 */
function alignToDocumentClock(element: HTMLElement | null): void {
  if (!element || typeof element.getAnimations !== 'function') return;
  for (const animation of element.getAnimations()) {
    animation.startTime = 0;
  }
}

/**
 * The web dots: a strip of pre-drawn frames clipped by the host box and stepped by one transform
 * animation, or the still H (breathing under reduced motion).
 */
export function DotSpinnerWeb(props: Readonly<{
  styleId: DotSpinnerStyleId;
  ink: DotSpinnerInk;
  motion: 'animate' | 'still' | 'breathe';
}>) {
  const { styleId, ink, motion } = props;
  const frames = getDotSpinnerFrames(styleId);
  const animate = motion === 'animate';
  const key = `${styleId}-${animate ? 'strip' : 'still'}-${hashInk(ink)}`;
  const stripRef = React.useRef<HTMLSpanElement | null>(null);

  useInsertionEffectSafe(() => {
    injectFrameSheet(key, () => (animate ? buildDotSpinnerFilmstripSvg(frames, ink) : buildDotSpinnerStillSvg(frames, ink)));
  }, [animate, frames, ink, key]);

  React.useLayoutEffect(() => {
    if (animate) alignToDocumentClock(stripRef.current);
  }, [animate, key]);

  const style = animate
    ? {
      width: `${frames.frameCount * 100}%`,
      animationName: FILMSTRIP_ANIMATION_NAME,
      animationDuration: `${frames.cycleMs}ms`,
      animationTimingFunction: `steps(${frames.frameCount}, end)`,
      animationIterationCount: 'infinite',
    }
    : motion === 'breathe'
      ? {
        width: '100%',
        animationName: BREATH_ANIMATION_NAME,
        animationDuration: '1200ms',
        animationDirection: 'alternate',
        animationIterationCount: 'infinite',
        animationTimingFunction: 'ease-in-out',
      }
      : { width: '100%' };

  return React.createElement('span', { [FRAME_SHEET_ATTRIBUTE]: key, ref: stripRef, style });
}
