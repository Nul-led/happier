import * as React from 'react';
import {
    parseSavedSecretCatalogReferenceV1,
    type SavedSecret,
    type SavedSecretCatalogEntryV1,
} from '@happier-dev/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Modal } from '@/modal';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    promotePersonalSavedSecretResource,
    setSavedSecretResourceGrants,
} from '@/sync/ops/settings/savedSecretResourceOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';
import { t } from '@/text';
import { SavedSecretGrantPicker, type SavedSecretGrantDraft } from './SavedSecretGrantPicker';

/**
 * Who a Saved Secret reaches — for a secret that is already shared, and for one
 * that is still personal and is being shared for the first time.
 *
 * Promotion is irreversible: it rewrites the Account-settings reference and
 * seals the value into a Home-side resource, and nothing demotes it again. So
 * the two cases are one editor rather than two: recipients are chosen first,
 * and the single write that follows carries them. Backing out of a personal
 * target leaves a personal secret.
 */
export type SavedSecretAccessTarget =
    | Readonly<{ kind: 'shared'; entry: SavedSecretCatalogEntryV1 }>
    | Readonly<{ kind: 'personal'; secret: SavedSecret; expectedSettingsVersion: number }>;

function draftFromTarget(target: SavedSecretAccessTarget): SavedSecretGrantDraft {
    const audience = target.kind === 'shared' ? target.entry.audience : null;
    return {
        accounts: new Set(audience?.accounts.map((account) => account.accountId) ?? []),
        teams: new Set(audience?.teams.map((team) => team.teamId) ?? []),
        groups: new Set(audience?.groups.map((group) => group.groupId) ?? []),
    };
}

export const SavedSecretAccessEditor = React.memo(function SavedSecretAccessEditor(props: Readonly<{
    target: SavedSecretAccessTarget;
    scope: ServerAccountScope;
    onClose: () => void;
    onSaved: () => Promise<void>;
    approvalPending?: boolean;
    approvalId?: string | null;
    onOpenApproval?: () => void;
    requestApproval?: (registration: ActionApprovalRegistration) => void;
}>) {
    const target = props.target;
    const entry = target.kind === 'shared' ? target.entry : null;
    const parsed = entry === null ? null : parseSavedSecretCatalogReferenceV1(entry.ref);
    const [draft, setDraft] = React.useState(() => draftFromTarget(target));
    const [saving, setSaving] = React.useState(false);
    const [failure, setFailure] = React.useState<'changed' | 'unavailable' | 'failed' | 'outcome_unknown' | null>(null);
    const targetKey = entry === null
        ? `${props.scope.serverId}:${props.scope.accountId}:personal:${target.kind === 'personal' ? target.secret.id : ''}`
        : `${props.scope.serverId}:${props.scope.accountId}:${entry.ref}:${entry.revision ?? -1}`;
    const currentTargetKey = React.useRef(targetKey);
    currentTargetKey.current = targetKey;
    const targetMounted = React.useRef(false);

    React.useEffect(() => {
        targetMounted.current = true;
        return () => { targetMounted.current = false; };
    }, [targetKey]);

    React.useEffect(() => {
        setDraft(draftFromTarget(props.target));
        setSaving(false);
        setFailure(null);
    }, [targetKey]);

    if (entry !== null && (parsed?.kind !== 'shared_resource' || entry.revision === null || entry.encryptionMode === null)) {
        return (
            <ItemList>
                <ItemGroup footer={t('secrets.catalog.operationFailed')}>
                    <Item title={t('common.cancel')} onPress={props.onClose} showChevron={false} />
                </ItemGroup>
            </ItemList>
        );
    }

    return (
        <ItemList>
            {props.approvalId && props.onOpenApproval ? (
                <ItemGroup><Item testID="saved-secret-access-approval" title={t('approvals.title')}
                    subtitle={t('secrets.catalog.approvalPending')} accessibilityLiveRegion="polite"
                    onPress={props.onOpenApproval} showChevron={false} /></ItemGroup>
            ) : null}
            <SavedSecretGrantPicker
                scope={props.scope}
                draft={draft}
                onChange={setDraft}
                disabled={saving || props.approvalPending}
                retainedAudience={entry?.audience ?? undefined}
            />

            <ItemGroup footer={failure
                ? failure === 'outcome_unknown'
                    ? t('secrets.catalog.outcomeUnknown')
                    : t('secrets.catalog.operationFailed')
                : undefined}>
                <Item title={t('common.cancel')} disabled={saving || props.approvalPending} onPress={props.onClose} showChevron={false} />
                <Item
                    testID="saved-secret-access-save"
                    title={t('common.save')}
                    loading={saving || props.approvalPending}
                    disabled={saving || props.approvalPending}
                    onPress={async () => {
                        const requestedTargetKey = targetKey;
                        const currentGrantCount = (entry?.audience?.accounts.length ?? 0)
                            + (entry?.audience?.teams.length ?? 0)
                            + (entry?.audience?.groups.length ?? 0);
                        const nextGrantCount = draft.accounts.size + draft.teams.size + draft.groups.size;
                        // Sharing a personal secret is itself the first
                        // disclosure, so it is confirmed exactly like the first
                        // external grant on an already-shared one.
                        if ((currentGrantCount === 0 && nextGrantCount > 0) || target.kind === 'personal') {
                            const target = t('secrets.catalog.shareDisclosureTargetCount', { count: nextGrantCount });
                            const confirmed = await Modal.confirm(
                                t('secrets.catalog.shareDisclosureTitle'),
                                t('secrets.catalog.shareDisclosureBody'),
                                {
                                    cancelText: t('common.cancel'),
                                    confirmText: t('secrets.catalog.shareDisclosureConfirm', { target }),
                                },
                            );
                            if (!confirmed || currentTargetKey.current !== requestedTargetKey) return;
                        }
                        setSaving(true);
                        setFailure(null);
                        const encryption = getSyncSingleton().encryption;
                        try {
                        const finishApproved = async () => {
                            if (!targetMounted.current || currentTargetKey.current !== requestedTargetKey) return;
                            setSaving(false);
                            await props.onSaved();
                            if (targetMounted.current && currentTargetKey.current === requestedTargetKey) props.onClose();
                        };
                        const onApprovalFailed = () => {
                            if (!targetMounted.current || currentTargetKey.current !== requestedTargetKey) return;
                            setSaving(false);
                            setFailure('failed');
                        };
                        // One write either way: the personal target becomes a
                        // shared resource carrying these grants, and the shared
                        // one replaces its audience under its own revision fence.
                        const result = target.kind === 'personal'
                            ? await promotePersonalSavedSecretResource({
                                scope: props.scope,
                                expectedSettingsVersion: target.expectedSettingsVersion,
                                secret: target.secret,
                                accountGrants: [...draft.accounts],
                                teamGrants: [...draft.teams],
                                groupGrants: [...draft.groups],
                                onApprovalSucceeded: finishApproved,
                                onApprovalFailed,
                            })
                            : await setSavedSecretResourceGrants({
                                scope: props.scope,
                                resourceId: parsed!.id,
                                expectedRevision: entry!.revision!,
                                encryptionMode: entry!.encryptionMode!,
                                accountGrants: [...draft.accounts],
                                teamGrants: [...draft.teams],
                                groupGrants: [...draft.groups],
                                decryptDataKeyEnvelope: (value) => encryption
                                    ? encryption.decryptEncryptionKey(value, props.scope)
                                    : Promise.resolve(null),
                                onApprovalSucceeded: finishApproved,
                                onApprovalFailed,
                            });
                        if (!targetMounted.current || currentTargetKey.current !== requestedTargetKey) return;
                        setSaving(false);
                        if (!result.ok) {
                            setFailure(result.reason);
                            if (result.reason === 'outcome_unknown') {
                                await props.onSaved().catch(() => undefined);
                            }
                            return;
                        }
                        try {
                            await props.onSaved();
                        } catch {
                            if (targetMounted.current && currentTargetKey.current === requestedTargetKey) setFailure('failed');
                            return;
                        }
                        if (targetMounted.current && currentTargetKey.current === requestedTargetKey) props.onClose();
                        } catch (cause) {
                            if (!targetMounted.current || currentTargetKey.current !== requestedTargetKey) return;
                            if (isTeamActionApprovalPendingError(cause)) {
                                props.requestApproval?.(cause.registration);
                                return;
                            }
                            setSaving(false);
                            setFailure('failed');
                        }
                    }}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
});
