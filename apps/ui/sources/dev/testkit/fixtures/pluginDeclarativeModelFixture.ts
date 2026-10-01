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
    occurrenceId: string;
    document: Parameters<typeof normalizePluginDeclarativeDocumentV1>[0]['document'];
}>) {
    const identity = createPluginContributionIdentity({ pluginId: input.pluginId, localId: input.localId });
    const normalized = normalizePluginDeclarativeDocumentV1({
        pluginId: input.pluginId,
        occurrenceId: input.occurrenceId,
        actions: [],
        document: input.document,
    });
    return PluginDeclarativeProjectedModelV1Schema.parse({
        identity: {
            ...identity,
            qualifiedId: buildQualifiedPluginContributionKey(identity),
            occurrenceId: input.occurrenceId,
        },
        visible: true,
        requiredHostMethods: [],
        declarativeInventory: { actions: [], destinations: [], settings: [], uiQueries: [] },
        root: normalized.root,
    });
}
