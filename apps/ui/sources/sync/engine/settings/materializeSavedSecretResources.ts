import {
    openSavedSecretResourceStoredContentV1,
    type SavedSecretCatalogCorruptEntryV1,
    type SavedSecretCatalogEntryV1,
    type SavedSecretResourceMaterialV1,
} from '@happier-dev/protocol';

import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';

type HealthySavedSecretResourceMaterialV1 = Extract<
    SavedSecretResourceMaterialV1,
    Readonly<{ resourceId: string }>
>;

function isHealthySavedSecretResourceMaterialV1(
    resource: SavedSecretResourceMaterialV1,
): resource is HealthySavedSecretResourceMaterialV1 {
    return 'resourceId' in resource;
}

export async function materializeSavedSecretResources(params: Readonly<{
    resources: readonly SavedSecretResourceMaterialV1[];
    decryptDataKeyEnvelope: (encryptedDataKey: string) => Promise<Uint8Array | null>;
}>): Promise<Readonly<{
    entries: readonly SavedSecretCatalogEntryV1[];
    corruptEntries: readonly SavedSecretCatalogCorruptEntryV1[];
    materializedSecrets: readonly SavedSecret[];
}>> {
    const entries: SavedSecretCatalogEntryV1[] = [];
    const corruptEntries: SavedSecretCatalogCorruptEntryV1[] = [];
    const materialized: SavedSecret[] = [];
    for (const resource of params.resources) {
        // Corrupt rows expose only row-local repair metadata and deliberately
        // have no canonical Saved Secret reference. They cannot enter the
        // reference/material catalog, but must not hide independent rows.
        if (!isHealthySavedSecretResourceMaterialV1(resource)) {
            corruptEntries.push(resource.entry);
            continue;
        }
        if (resource.entry.materialStatus !== 'ready') {
            entries.push(resource.entry);
            continue;
        }

        try {
            if (!resource.storedContent) throw new Error('Ready Saved Secret resource omitted content');
            const content = resource.encryptionMode === 'plain'
                ? openSavedSecretResourceStoredContentV1({
                    resourceId: resource.resourceId,
                    mode: 'plain',
                    storedContent: resource.storedContent,
                })
                : await (async () => {
                    if (!resource.recipientEnvelope) return null;
                    const dataKey = await params.decryptDataKeyEnvelope(resource.recipientEnvelope.encryptedDataKey);
                    if (!dataKey) return null;
                    try {
                        return openSavedSecretResourceStoredContentV1({
                            resourceId: resource.resourceId,
                            mode: 'e2ee',
                            storedContent: resource.storedContent,
                            resourceDataKey: dataKey,
                        });
                    } finally {
                        dataKey.fill(0);
                    }
                })();
            if (!content) throw new Error('Saved Secret resource material authentication failed');

            entries.push(resource.entry);
            materialized.push(Object.freeze({
                id: resource.entry.ref,
                name: content.name,
                kind: content.kind,
                encryptedValue: Object.freeze({ _isSecretValue: true, value: content.value }),
                createdAt: 0,
                updatedAt: resource.entry.revision ?? 0,
            }) satisfies SavedSecret);
        } catch {
            entries.push(Object.freeze({
                ...resource.entry,
                materialStatus: 'temporarily_unavailable',
                capabilities: Object.freeze({ ...resource.entry.capabilities, use: false }),
            }));
        }
    }
    return Object.freeze({
        entries: Object.freeze(entries),
        corruptEntries: Object.freeze(corruptEntries),
        materializedSecrets: Object.freeze(materialized),
    });
}
