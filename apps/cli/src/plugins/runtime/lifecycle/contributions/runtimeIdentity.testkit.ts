import type { PluginSourceCustody } from '@/plugins/runtime/sourceAuthority';

export function createManagedPluginSourceCustody(
    immutableGenerationId: string,
    installSource: Extract<PluginSourceCustody, { kind: 'managed' }>['installSource'] = 'localPath',
): Extract<PluginSourceCustody, { kind: 'managed' }> {
    return {
        kind: 'managed',
        immutableGenerationId,
        installSource,
    };
}

export function createBundledFirstPartyPluginSourceCustody(
    versionRootId: string,
): Extract<PluginSourceCustody, { kind: 'bundled_first_party' }> {
    return {
        kind: 'bundled_first_party',
        packagedRuntime: {
            kind: 'cli_version_root',
            versionRootId,
        },
    };
}

export function createDevelopmentPluginSourceCustody(
    registeredRootId: string,
): Extract<PluginSourceCustody, { kind: 'development' }> {
    return {
        kind: 'development',
        registeredRootId,
    };
}

export function createManagedSourceCustodiesByPluginId(
    entries: ReadonlyMap<string, string>,
): ReadonlyMap<string, PluginSourceCustody> {
    return new Map(
        [...entries].map(([pluginId, immutableGenerationId]) => [
            pluginId,
            createManagedPluginSourceCustody(immutableGenerationId),
        ]),
    );
}
