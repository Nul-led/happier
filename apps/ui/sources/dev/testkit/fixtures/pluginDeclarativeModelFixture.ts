import {
    buildQualifiedPluginContributionKey,
    createPluginContributionIdentity,
    normalizePluginDeclarativeDocumentV1,
    PluginDeclarativeProjectedModelV1Schema,
} from '@happier-dev/protocol';

/** Build a static fixture through the real document normalizer and wire schema. */
export function createPluginDeclarativeModelFixture(input: Readonly<{
    pluginId: string;
    localId: string;
    generation: string;
    document: Parameters<typeof normalizePluginDeclarativeDocumentV1>[0]['document'];
}>) {
    const identity = createPluginContributionIdentity({ pluginId: input.pluginId, localId: input.localId });
    const normalized = normalizePluginDeclarativeDocumentV1({
        pluginId: input.pluginId,
        generation: input.generation,
        actions: [],
        document: input.document,
    });
    return PluginDeclarativeProjectedModelV1Schema.parse({
        identity: {
            ...identity,
            qualifiedId: buildQualifiedPluginContributionKey(identity),
            generation: input.generation,
        },
        visible: true,
        requiredHostMethods: [],
        declarativeInventory: { actions: [], destinations: [], settings: [], uiQueries: [] },
        root: normalized.root,
    });
}
