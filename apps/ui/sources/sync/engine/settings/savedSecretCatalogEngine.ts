import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { readSavedSecretCatalog } from '@/sync/api/account/apiSavedSecretCatalog';
import { createScopedSnapshotLoader, type ScopedLoadTarget } from '@/sync/engine/scope/scopedSnapshotLoader';
import { materializeSavedSecretResources } from '@/sync/engine/settings/materializeSavedSecretResources';
import {
    applySavedSecretCatalogFailure,
    applySavedSecretCatalogPage,
    beginSavedSecretCatalogLoad,
    getSavedSecretCatalogSnapshot,
    invalidateSavedSecretCatalog,
    invalidateSavedSecretCatalogsForServer,
} from '@/sync/store/settings/savedSecretCatalogSnapshot';

type Target = ScopedLoadTarget & Readonly<{ scope: ServerAccountScope }>;

const targetFor = (scope: ServerAccountScope): Target => ({
    key: `saved-secrets:${scope.serverId.length}:${scope.serverId}${scope.accountId.length}:${scope.accountId}`,
    serverId: scope.serverId,
    scope,
});

const loader = createScopedSnapshotLoader<Target>({
    load: async ({ scope }, context) => {
        beginSavedSecretCatalogLoad(scope);
        const outcome = await readSavedSecretCatalog(scope);
        if (outcome.ok) {
            try {
                const { getSyncSingleton } = await import('@/sync/runtime/getSyncSingleton');
                const encryption = getSyncSingleton().encryption;
                const materialized = await materializeSavedSecretResources({
                    resources: outcome.resources,
                    decryptDataKeyEnvelope: async (encryptedDataKey) => {
                        if (!encryption) return null;
                        return encryption.decryptEncryptionKey(encryptedDataKey, {
                            serverId: scope.serverId,
                            accountId: scope.accountId,
                        });
                    },
                });
                applySavedSecretCatalogPage({
                    scope,
                    entries: materialized.entries,
                    corruptEntries: materialized.corruptEntries,
                    materializedSecrets: materialized.materializedSecrets,
                    observedAt: Date.now(),
                    current: context.isCurrent(),
                });
                return;
            } catch (error) {
                applySavedSecretCatalogFailure({
                    scope,
                    error: { kind: 'invalid', retryable: false },
                });
                throw error;
            }
        }
        applySavedSecretCatalogFailure({
            scope,
            error: {
                kind: outcome.failure.kind === 'conflict' || outcome.failure.kind === 'outcome_unknown'
                    ? 'unknown'
                    : outcome.failure.kind,
                retryable: outcome.failure.retryable,
                code: outcome.failure.code,
            },
        });
        throw new Error(`Saved Secret material catalog read failed: ${outcome.failure.kind}`);
    },
    shouldLoadOnObserve: ({ scope }) => {
        const snapshot = getSavedSecretCatalogSnapshot(scope);
        return !snapshot || snapshot.stale || (snapshot.data === null && snapshot.status !== 'loading');
    },
    invalidateServer: invalidateSavedSecretCatalogsForServer,
    invalidateTarget: ({ scope }) => invalidateSavedSecretCatalog(scope),
});

export function observeSavedSecretCatalog(scope: ServerAccountScope): () => void {
    return loader.observe(targetFor(scope));
}

export function refreshSavedSecretCatalog(scope: ServerAccountScope): Promise<void> {
    return loader.refresh(targetFor(scope));
}

export function invalidateSavedSecretCatalogProjection(scope: ServerAccountScope): Promise<void> {
    return loader.invalidate(targetFor(scope));
}

export function resetSavedSecretCatalogEngineForTests(): void {
    loader.resetForTests();
}
