import type { SessionCompanionAvailability } from './state/useSessionCompanionPreference';

/**
 * One responsive policy decides whether Companion gets a quiet dedicated
 * control or stays discoverable in the incumbent overflow menu. An untouched
 * empty preference should not spend scarce header width, but it must still
 * have a reachable first-use entry point.
 */
export function resolveSessionCompanionHeaderPlacement(input: Readonly<{
    availability: SessionCompanionAvailability;
    preferenceExists: boolean;
    visible: boolean;
    itemCount: number;
    headerActionsFolded: boolean;
}>): 'direct' | 'overflow' | null {
    if (input.availability !== 'ready') return null;
    if (input.headerActionsFolded) return 'overflow';
    if (!input.preferenceExists && !input.visible && input.itemCount === 0) return 'overflow';
    return 'direct';
}
