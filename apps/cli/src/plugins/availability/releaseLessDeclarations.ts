import type { PluginMachineMaterializationV1 } from '@happier-dev/protocol';

import type { CanonicalPluginManifest } from '@/plugins/manifest/types';
import type { PluginSourceCustody } from '@/plugins/runtime/sourceAuthority';

/**
 * One daemon-selected plugin's release-less Account declaration. Bundled
 * first-party and trusted development/drop-in plugins are selected by this
 * daemon, not by a portable Account release, so the host claims the Account
 * intent with this admitted manifest and reports this machine-bound
 * materialization for server currentness of its webhooks and Events.
 */
export type ReleaseLessPluginDeclaration = Readonly<{
    manifest: CanonicalPluginManifest;
    materializationId: string;
    /**
     * The machine materialization this runtime reports itself. Null when the
     * install registry already records and reports the plugin (a registered
     * development root).
     */
    runtimeMaterialization: Omit<
        PluginMachineMaterializationV1,
        'serverIdentityId' | 'machineId'
    > | null;
}>;

/**
 * Only the Account-scoped contributions the server gates on a declaration
 * make a plugin claim: Collections, webhooks, and Events.
 */
function declaresAccountScopedContributions(manifest: CanonicalPluginManifest): boolean {
    return manifest.contributes.accountCollections.length > 0
        || manifest.contributes.webhooks.length > 0
        || manifest.contributes.events.length > 0;
}

/** Stable per machine and plugin, so a CLI update keeps its webhook targets. */
function runtimeMaterializationId(pluginId: string): string {
    return `daemon-selected:${pluginId}`;
}

export function projectReleaseLessPluginDeclarations(input: Readonly<{
    activationTargets: readonly Readonly<{ pluginId: string; manifest: CanonicalPluginManifest }>[];
    sourceCustodiesByPluginId: ReadonlyMap<string, PluginSourceCustody>;
    registryMaterializationIdsByPluginId: Readonly<Record<string, string>>;
    observedAt: number;
}>): ReadonlyMap<string, ReleaseLessPluginDeclaration> {
    const declarations = new Map<string, ReleaseLessPluginDeclaration>();
    for (const target of input.activationTargets) {
        const custody = input.sourceCustodiesByPluginId.get(target.pluginId);
        if (!custody || custody.kind === 'managed') continue;
        if (!declaresAccountScopedContributions(target.manifest)) continue;
        const registryMaterializationId = input.registryMaterializationIdsByPluginId[target.pluginId];
        const materializationId = registryMaterializationId ?? runtimeMaterializationId(target.pluginId);
        declarations.set(target.pluginId, Object.freeze({
            manifest: target.manifest,
            materializationId,
            runtimeMaterialization: registryMaterializationId !== undefined
                ? null
                : Object.freeze({
                    materializationId,
                    pluginId: target.pluginId,
                    version: target.manifest.version,
                    sourceClass: custody.kind === 'bundled_first_party'
                        ? 'bundledFirstParty' as const
                        : 'localPath' as const,
                    portableRelease: false,
                    uiArtifacts: Object.freeze([]),
                    enabled: true,
                    trustState: 'trusted' as const,
                    observedAt: input.observedAt,
                }),
        }));
    }
    return declarations;
}
