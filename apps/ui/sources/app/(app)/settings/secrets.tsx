import React from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { parseSavedSecretCatalogReferenceV1, type SavedSecretCatalogCorruptEntryV1, type SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';

import { SecretsList } from '@/components/secrets/SecretsList';
import { SavedSecretAccessEditor } from '@/components/secrets/SavedSecretAccessEditor';
import { SavedSecretCreateEditor } from '@/components/secrets/SavedSecretCreateEditor';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { useSavedSecretCatalog } from '@/components/secrets/useSavedSecretCatalog';
import { Modal } from '@/modal';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { useAccountSettingsScope } from '@/sync/store/settingsWriters';
import { useSettingsVersion } from '@/sync/store/hooks';
import {
    deleteSavedSecretResource,
    repairCustodiedSavedSecretResourceEnvelopesBestEffort,
    updateSavedSecretResource,
} from '@/sync/ops/settings/savedSecretResourceOperations';
import type { SavedSecret } from '@/sync/domains/settings/savedSecretTypes';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

export default React.memo(function SecretsSettingsScreen() {
    const router = useRouter();
    const catalog = useSavedSecretCatalog();
    const scope = useAccountSettingsScope();
    const settingsVersion = useSettingsVersion();
    const scopeKey = scope ? `${scope.serverId}:${scope.accountId}` : null;
    const currentScopeKey = React.useRef(scopeKey);
    currentScopeKey.current = scopeKey;
    // The secret whose recipients are being chosen. Nothing is written while it
    // is set: promotion is irreversible, so it carries the chosen grants and
    // happens once, on save.
    const [sharingPersonal, setSharingPersonal] = React.useState<SavedSecret | null>(null);
    const [creatingShared, setCreatingShared] = React.useState(false);
    const [sharedMutationPending, setSharedMutationPending] = React.useState(false);
    const [accessSelection, setAccessSelection] = React.useState<Readonly<{ scopeKey: string; ref: string }> | null>(null);
    const accessEntry = accessSelection === null || accessSelection.scopeKey !== scopeKey
        ? null
        : catalog.sharedEntries.find((entry) => entry.ref === accessSelection.ref) ?? null;
    const approval = useActionApprovalContinuation({
        scopeKey: scopeKey ?? 'unbound:saved-secrets',
        serverId: scope?.serverId ?? '',
        onExecuted: () => { void catalog.reload().catch(() => undefined); },
    });
    const approvalId = approval.approvalId;

    React.useEffect(() => {
        setSharingPersonal(null);
        setSharedMutationPending(false);
    }, [scopeKey]);

    // Recipients this Account custodies can be waiting on an envelope no
    // mutation is coming to write: they became E2EE-ready, or rotated their
    // content key, after the last grant change. Opening Saved Secrets is the
    // moment the custodian is present to close that, so prepare what is owed
    // here. Nothing is mutated and nothing is shown: the sweep either has
    // work and does it, or asks the census once and stops.
    useFocusEffect(React.useCallback(() => {
        const encryption = getSyncSingleton().encryption;
        if (!scope || !encryption || !catalog.sharedEnabled) return;
        void repairCustodiedSavedSecretResourceEnvelopesBestEffort({
            scope,
            decryptDataKeyEnvelope: (encryptedDataKey) => encryption.decryptEncryptionKey(encryptedDataKey, scope),
        }).catch(() => undefined);
    }, [catalog.sharedEnabled, scope]));

    const updateResource = React.useCallback(async (
        entry: SavedSecretCatalogEntryV1,
        update: Readonly<{ nextName?: string; nextValue?: string }>,
    ) => {
        const parsed = parseSavedSecretCatalogReferenceV1(entry.ref);
        const encryption = getSyncSingleton().encryption;
        if (!scope || parsed?.kind !== 'shared_resource' || entry.revision === null) return;
        if (sharedMutationPending || approval.approvalPending) return;
        const requestedScopeKey = scopeKey;
        setSharedMutationPending(true);
        try {
        const finish = async () => {
            if (currentScopeKey.current !== requestedScopeKey) return;
            setSharedMutationPending(false);
            await catalog.reload();
        };
        const result = await updateSavedSecretResource({
            scope,
            resourceId: parsed.id,
            expectedRevision: entry.revision,
            ...update,
            decryptDataKeyEnvelope: (value) => encryption
                ? encryption.decryptEncryptionKey(value, scope)
                : Promise.resolve(null),
            onApprovalSucceeded: finish,
            onApprovalFailed: () => {
                if (currentScopeKey.current !== requestedScopeKey) return;
                setSharedMutationPending(false);
                Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
            },
        });
        if (currentScopeKey.current !== requestedScopeKey) return;
        setSharedMutationPending(false);
        if (!result.ok) {
            if (result.reason === 'outcome_unknown') await catalog.reload().catch(() => {});
            Modal.alert(t('common.error'), result.reason === 'outcome_unknown'
                ? t('secrets.catalog.outcomeUnknown')
                : t('secrets.catalog.operationFailed'));
            return;
        }
        await catalog.reload();
        } catch (cause) {
            if (currentScopeKey.current !== requestedScopeKey) return;
            if (isTeamActionApprovalPendingError(cause)) {
                approval.requestApproval(cause.registration);
                return;
            }
            setSharedMutationPending(false);
            Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
        }
    }, [approval, catalog, scope, scopeKey, sharedMutationPending]);

    const renameShared = React.useCallback(async (entry: SavedSecretCatalogEntryV1) => {
        const nextName = await Modal.prompt(t('secrets.prompts.renameTitle'), undefined, {
            defaultValue: entry.name ?? '', placeholder: t('secrets.placeholders.nameExample'),
        });
        const normalized = nextName?.trim();
        if (!normalized || normalized === entry.name) return;
        await updateResource(entry, { nextName: normalized });
    }, [updateResource]);

    const rotateShared = React.useCallback(async (entry: SavedSecretCatalogEntryV1) => {
        const nextValue = await Modal.prompt(t('secrets.prompts.replaceValueTitle'), undefined, {
            placeholder: t('secrets.placeholders.valueExample'), inputType: 'secure-text',
        });
        if (nextValue === null || nextValue.length === 0) return;
        await updateResource(entry, { nextValue });
    }, [updateResource]);

    const removeShared = React.useCallback(async (entry: SavedSecretCatalogEntryV1) => {
        const parsed = parseSavedSecretCatalogReferenceV1(entry.ref);
        if (!scope || parsed?.kind !== 'shared_resource' || entry.revision === null) return;
        if (sharedMutationPending || approval.approvalPending) return;
        const confirmed = await Modal.confirm(
            t('secrets.prompts.deleteTitle'),
            t('secrets.prompts.deleteConfirm', { name: entry.name ?? t('secrets.catalog.unavailableName') }),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed) return;
        const requestedScopeKey = scopeKey;
        setSharedMutationPending(true);
        try {
        const result = await deleteSavedSecretResource({
            scope, resourceId: parsed.id, expectedRevision: entry.revision, confirmedByPresentUser: true,
            onApprovalSucceeded: async () => {
                if (currentScopeKey.current !== requestedScopeKey) return;
                setSharedMutationPending(false);
                await catalog.reload();
            },
            onApprovalFailed: () => {
                if (currentScopeKey.current !== requestedScopeKey) return;
                setSharedMutationPending(false);
                Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
            },
        });
        if (currentScopeKey.current !== requestedScopeKey) return;
        setSharedMutationPending(false);
        if (!result.ok) {
            if (result.reason === 'outcome_unknown') await catalog.reload().catch(() => {});
            Modal.alert(t('common.error'), result.reason === 'outcome_unknown'
                ? t('secrets.catalog.outcomeUnknown')
                : t('secrets.catalog.operationFailed'));
        } else await catalog.reload();
        } catch (cause) {
            if (currentScopeKey.current !== requestedScopeKey) return;
            if (isTeamActionApprovalPendingError(cause)) {
                approval.requestApproval(cause.registration);
                return;
            }
            setSharedMutationPending(false);
            Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
        }
    }, [approval, catalog, scope, scopeKey, sharedMutationPending]);

    const removeCorruptShared = React.useCallback(async (
        entry: Extract<SavedSecretCatalogCorruptEntryV1, { relationship: 'owner' }>,
    ) => {
        if (sharedMutationPending || approval.approvalPending) return;
        const confirmed = await Modal.confirm(
            t('secrets.prompts.deleteTitle'),
            t('secrets.prompts.deleteConfirm', { name: t('secrets.catalog.unavailableName') }),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
        );
        if (!confirmed) return;
        setSharedMutationPending(true);
        try {
            const deleted = await catalog.deleteCorruptResource(entry);
            if (!deleted) Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) {
                approval.requestApproval(cause.registration);
                return;
            }
            Modal.alert(t('common.error'), t('secrets.catalog.operationFailed'));
        } finally {
            setSharedMutationPending(false);
        }
    }, [approval, catalog, sharedMutationPending]);

    if (catalog.sharedEnabled && scope && settingsVersion !== null && sharingPersonal) {
        return (
            <SavedSecretAccessEditor
                key={`${scope.serverId}:${scope.accountId}:personal:${sharingPersonal.id}`}
                target={{ kind: 'personal', secret: sharingPersonal, expectedSettingsVersion: settingsVersion }}
                scope={scope}
                onClose={() => setSharingPersonal(null)}
                onSaved={catalog.reload}
                approvalPending={approval.approvalPending}
                approvalId={approvalId}
                requestApproval={approval.requestApproval}
                onOpenApproval={approvalId ? () => router.push(
                    `/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(scope.serverId)}`,
                ) : undefined}
            />
        );
    }

    if (catalog.sharedEnabled && scope && creatingShared) {
        return (
            <SavedSecretCreateEditor
                scope={scope}
                approvalPending={approval.approvalPending}
                approvalId={approvalId}
                requestApproval={approval.requestApproval}
                onOpenApproval={approvalId ? () => router.push(
                    `/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(scope.serverId)}`,
                ) : undefined}
                onCancel={() => setCreatingShared(false)}
                onCreated={async (resourceRef) => {
                    await catalog.reload();
                    setCreatingShared(false);
                    setAccessSelection({ scopeKey: `${scope.serverId}:${scope.accountId}`, ref: resourceRef });
                }}
            />
        );
    }

    if (catalog.sharedEnabled && scope && accessEntry) {
        return (
            <SavedSecretAccessEditor
                key={`${scope.serverId}:${scope.accountId}:${accessEntry.ref}`}
                target={{ kind: 'shared', entry: accessEntry }}
                scope={scope}
                onClose={() => setAccessSelection(null)}
                onSaved={catalog.reload}
                approvalPending={approval.approvalPending}
                approvalId={approvalId}
                requestApproval={approval.requestApproval}
                onOpenApproval={approvalId ? () => router.push(
                    `/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(scope.serverId)}`,
                ) : undefined}
            />
        );
    }

    return (
        <SecretsList
            secrets={catalog.personalSecrets}
            sharedEntries={catalog.sharedEntries}
            corruptEntries={catalog.corruptEntries}
            resolveSharedReference={catalog.resolveReference}
            sharedCatalogStale={catalog.status === 'error' || (catalog.status === 'ready' && catalog.stale)}
            onRetrySharedCatalog={catalog.sharedEnabled || catalog.collisionMigrationStatus === 'failed'
                ? () => { void catalog.reload().catch(() => {}); }
                : undefined}
            onCreatePersonal={catalog.personalMutations.create}
            onRenamePersonal={catalog.personalMutations.rename}
            onRotatePersonal={catalog.personalMutations.rotate}
            onDeletePersonal={catalog.personalMutations.delete}
            allowAdd
            allowEdit
            onCreateShared={catalog.sharedEnabled && scope ? () => setCreatingShared(true) : undefined}
            onSharePersonal={catalog.sharedEnabled && scope && settingsVersion !== null ? (secret) => setSharingPersonal(secret) : undefined}
            sharingPersonalId={sharingPersonal?.id ?? null}
            sharedMutationsDisabled={sharedMutationPending || approval.approvalPending}
            sharedApprovalId={catalog.sharedEnabled ? approvalId : null}
            onOpenSharedApproval={catalog.sharedEnabled && approvalId && scope ? () => router.push(
                `/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(scope.serverId)}`,
            ) : undefined}
            onRenameShared={catalog.sharedEnabled ? (entry) => { void renameShared(entry); } : undefined}
            onRotateShared={catalog.sharedEnabled ? (entry) => { void rotateShared(entry); } : undefined}
            onManageAccessShared={catalog.sharedEnabled && scopeKey ? (entry) => setAccessSelection({ scopeKey, ref: entry.ref }) : undefined}
            onDeleteShared={catalog.sharedEnabled ? (entry) => { void removeShared(entry); } : undefined}
            onDeleteCorruptShared={catalog.sharedEnabled ? (entry) => { void removeCorruptShared(entry); } : undefined}
        />
    );
});
