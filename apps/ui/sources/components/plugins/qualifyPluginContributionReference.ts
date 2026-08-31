import type {
    PluginContributionRef,
    PluginReference,
} from '@happier-dev/plugin-sdk';

/** Binds a caller-local reference without resolving a contributed resource. */
export function qualifyPluginContributionReference(
    reference: PluginReference,
    callerPluginId: string,
): PluginContributionRef {
    return typeof reference === 'string'
        ? { pluginId: callerPluginId, localId: reference }
        : reference;
}
