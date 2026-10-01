import { Platform } from 'react-native';
import { resolveHappierMinimumInteractiveTargetSize } from '@happier-dev/plugin-ui/environment';

import { isCoarsePrimaryPointerEnvironment } from '@/utils/platform/webMobileHeuristics';

/**
 * Core's compatibility name over the shared platform-policy owner. App code
 * still supplies its local `Platform.OS` fact; shared presentation reads the
 * equivalent fact from its environment provider.
 */
export function resolveMinimumInteractiveTargetSize(platform: string): 44 | 48 {
    return resolveHappierMinimumInteractiveTargetSize(platform);
}

let coarseWebPrimaryPointer: boolean | null = null;

/**
 * Whether the primary pointer is a finger: always on native, and on the web when the primary pointer
 * cannot hover (a phone or tablet browser). Controls take the platform touch floor only then; a
 * precise pointer keeps the dense desktop sizes. The web answer is read once: the primary pointer does
 * not change under a running app.
 */
export function isTouchPrimaryPointer(platform: string = Platform.OS): boolean {
    if (platform !== 'web') return true;
    if (coarseWebPrimaryPointer === null) coarseWebPrimaryPointer = isCoarsePrimaryPointerEnvironment();
    return coarseWebPrimaryPointer;
}

/** The touch floor a control takes on this device, or `null` under a precise pointer. */
export function resolveTouchTargetFloorPx(platform: string = Platform.OS): 44 | 48 | null {
    return isTouchPrimaryPointer(platform) ? resolveMinimumInteractiveTargetSize(platform) : null;
}
