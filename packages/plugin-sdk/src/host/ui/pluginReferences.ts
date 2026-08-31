import type { PluginContributionRef, PluginReference } from '../../identity.js';

// Kept internal for the current generated host barrel until the governance
// owner rematerializes it from `index.public.ts`.
export type QualifiedPluginContributionReference = PluginContributionRef;

/** Qualifies a caller-local contribution reference without resolving it. */
export function qualifyPluginContributionReference(
    reference: PluginReference,
    callerPluginId: string,
): PluginContributionRef {
    return typeof reference === 'string'
        ? { pluginId: callerPluginId, localId: reference }
        : { pluginId: reference.pluginId, localId: reference.localId };
}
