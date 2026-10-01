import { useEffect, useInsertionEffect, useLayoutEffect } from 'react';
import { Platform } from 'react-native';

/** The web ring's turn. */
export const HAPPIER_SPINNER_SPIN_ANIMATION = 'happierActivitySpinnerSpin';
/** Steps a strip of pre-drawn dot frames across its clip. */
export const HAPPIER_SPINNER_FILMSTRIP_ANIMATION = 'happierActivitySpinnerFilmstrip';
/** Reduced motion: the still H fades gently instead of moving. */
export const HAPPIER_SPINNER_BREATH_ANIMATION = 'happierActivitySpinnerBreath';

const KEYFRAMES_STYLE_ID = 'happier-spinner-keyframes';

const KEYFRAMES_CSS =
  `@keyframes ${HAPPIER_SPINNER_SPIN_ANIMATION}{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}` +
  `@keyframes ${HAPPIER_SPINNER_FILMSTRIP_ANIMATION}{to{transform:translateX(-100%)}}` +
  `@keyframes ${HAPPIER_SPINNER_BREATH_ANIMATION}{from{opacity:1}to{opacity:0.45}}`;

const useInsertionEffectSafe: typeof useEffect =
  typeof useInsertionEffect === 'function' ? useInsertionEffect : useLayoutEffect;

/**
 * Defines the spinner keyframes in the current document, once. The web spinners name these
 * animations, and plugin-ui runs in documents the core app's stylesheet never reaches (a standalone
 * RNW mount), so the owner of the names also owns their definitions. The document is the registry:
 * a removed sheet is re-added by the next spinner.
 */
export function useHappierSpinnerKeyframes(): void {
  useInsertionEffectSafe(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = KEYFRAMES_STYLE_ID;
    style.textContent = KEYFRAMES_CSS;
    document.head.appendChild(style);
  }, []);
}
