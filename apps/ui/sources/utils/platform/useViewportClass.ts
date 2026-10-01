import * as React from 'react';
import { Dimensions } from 'react-native';

import { resolveViewportClass, type ViewportClass } from './viewportClass';

/** The window's viewport class right now, for decisions taken outside render (opening a surface). */
export function readViewportClass(): ViewportClass {
    const window = Dimensions?.get?.('window');
    if (!window) return 'medium';
    return resolveViewportClass({ width: window.width, height: window.height });
}

function subscribeToViewport(onChange: () => void): () => void {
    const subscription = Dimensions?.addEventListener?.('change', onChange);
    return () => subscription?.remove?.();
}

/**
 * The window's viewport class (`compact` is a phone-sized window), re-rendering only when the class
 * changes rather than on every resize step, so controls that recompose for phones can read it cheaply.
 */
export function useViewportClass(): ViewportClass {
    return React.useSyncExternalStore(subscribeToViewport, readViewportClass, readViewportClass);
}
