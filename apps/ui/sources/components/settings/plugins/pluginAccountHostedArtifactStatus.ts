export type PluginAccountHostedArtifactStatus =
    | 'unavailable'
    | 'unsupported'
    | 'unsupportedHosted'
    | 'notOptedIn'
    | 'disabledHosted'
    | 'publicationPending'
    | 'hosted';

/** One presentation classification over Availability-owned Account facts. */
export function classifyPluginAccountHostedArtifactStatus(input: Readonly<{
    hostingCapability: Readonly<{ enabled: boolean }>;
    intent: Readonly<{
        pluginId: string;
        desiredVersion: string | null;
        offlineUiHosting: 'enabled' | 'disabled';
    }> | null;
    release: Readonly<{
        ref: Readonly<{ pluginId: string; version: string }>;
        uiSlots: readonly unknown[];
        packageAssetArchive: Readonly<{ resources: readonly unknown[] }>;
    }> | null;
    uiArtifacts: readonly unknown[];
    packageAssets: readonly unknown[];
}>): PluginAccountHostedArtifactStatus {
    if (
        !input.intent
        || !input.intent.desiredVersion
        || !input.release
        || input.release.ref.pluginId !== input.intent.pluginId
        || input.release.ref.version !== input.intent.desiredVersion
        || (input.release.uiSlots.length === 0 && input.release.packageAssetArchive.resources.length === 0)
    ) return 'unavailable';
    const hostedCount = input.uiArtifacts.length + input.packageAssets.length;
    if (!input.hostingCapability.enabled) {
        return hostedCount > 0 ? 'unsupportedHosted' : 'unsupported';
    }
    if (input.intent.offlineUiHosting !== 'enabled') {
        return hostedCount > 0 ? 'disabledHosted' : 'notOptedIn';
    }
    return input.uiArtifacts.length === input.release.uiSlots.length
        && input.packageAssets.length === (input.release.packageAssetArchive.resources.length > 0 ? 1 : 0)
        ? 'hosted'
        : 'publicationPending';
}
