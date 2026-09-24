import * as React from 'react';
import {
    parseSavedSecretCatalogReferenceV1,
    type SavedSecret,
    type SavedSecretCatalogEntryV1,
    type SavedSecretResourceEnvelopeCensusRecipientV1,
} from '@happier-dev/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Modal } from '@/modal';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    promotePersonalSavedSecretResource,
    readSavedSecretResourceRecipientReadiness,
    repairApprovedSavedSecretResourceEnvelopesBestEffort,
    setSavedSecretResourceGrants,
} from '@/sync/ops/settings/savedSecretResourceOperations';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
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

/** What one recipient can do with an E2EE secret, in the owner's words. */
function recipientReadinessLabel(recipient: SavedSecretResourceEnvelopeCensusRecipientV1): string {
    if (recipient.readiness.status === 'available') {
        return recipient.envelopeStatus === 'prepared'
            ? t('secrets.catalog.status.ready')
            : t('secrets.catalog.status.preparing_encrypted_access');
    }
    switch (recipient.readiness.reason) {
        case 'plain_account': return t('secrets.catalog.recipientHomeManagedRequired');
        case 'encryption_setup_required': return t('secrets.catalog.recipientEncryptionSetupRequired');
        case 'encryption_inconsistent': return t('secrets.catalog.recipientEncryptionRepairRequired');
    }
}

type RecipientReadinessState =
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; revision: number; recipients: readonly SavedSecretResourceEnvelopeCensusRecipientV1[] }>
    | Readonly<{ status: 'error' }>;

/**
 * The owner's per-recipient view of one E2EE secret, read from the Home's
 * envelope census (plan 10.08 §0.5, §10.5, §13.4). A Home-managed secret has
 * no envelopes, so it asks nothing.
 */
function useSavedSecretRecipientReadiness(input: Readonly<{
    scope: ServerAccountScope;
    resourceId: string | null;
    /** The census belongs to one revision; a new revision is a new read. */
    revision: number | null;
}>): Readonly<{ state: RecipientReadinessState | null; reload: () => void }> {
    const [state, setState] = React.useState<RecipientReadinessState | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    const { serverId, accountId } = input.scope;
    React.useEffect(() => {
        if (input.resourceId === null) {
            setState(null);
            return;
        }
        let current = true;
        setState((previous) => previous?.status === 'ready' ? previous : { status: 'loading' });
        void readSavedSecretResourceRecipientReadiness({
            scope: { serverId, accountId },
            resourceId: input.resourceId,
        }).then((result) => {
            if (!current) return;
            setState(result.ok
                ? { status: 'ready', revision: result.revision, recipients: result.recipients }
                : { status: 'error' });
        }, () => {
            if (current) setState({ status: 'error' });
        });
        return () => { current = false; };
    }, [accountId, attempt, input.resourceId, input.revision, serverId]);
    const reload = React.useCallback(() => setAttempt((value) => value + 1), []);
    return { state, reload };
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
    /**
     * The owner's explicit, separately confirmed conversion to Home-managed
     * storage — the remedy for a recipient who cannot hold an envelope.
     * Absent where that direction is not allowed.
     */
    onMakeHomeManaged?: () => void;
}>) {
    const target = props.target;
    const entry = target.kind === 'shared' ? target.entry : null;
    const parsed = entry === null ? null : parseSavedSecretCatalogReferenceV1(entry.ref);
    const [draft, setDraft] = React.useState(() => draftFromTarget(target));
    const [saving, setSaving] = React.useState(false);
    const [failure, setFailure] = React.useState<'changed' | 'unavailable' | 'failed' | 'outcome_unknown' | null>(null);
    /**
     * Which revision an in-flight save was issued against. A response that
     * arrives after the row moved must not close the editor.
     */
    const targetKey = entry === null
        ? `${props.scope.serverId}:${props.scope.accountId}:personal:${target.kind === 'personal' ? target.secret.id : ''}`
        : `${props.scope.serverId}:${props.scope.accountId}:${entry.ref}:${entry.revision ?? -1}`;
    const currentTargetKey = React.useRef(targetKey);
    currentTargetKey.current = targetKey;
    /**
     * Which secret is being edited — not which version of it.
     *
     * The draft used to be reset on the fenced key above, so an ordinary
     * background catalog refresh looked like a different target and silently
     * wiped an in-progress recipient selection (and any `outcome_unknown`
     * notice). Currentness is carried by `basis` instead, exactly as the Team
     * credential editor does it: seed once, keep the draft, offer an explicit
     * reload.
     */
    const targetIdentity = entry === null
        ? `${props.scope.serverId}:${props.scope.accountId}:personal:${target.kind === 'personal' ? target.secret.id : ''}`
        : `${props.scope.serverId}:${props.scope.accountId}:${entry.ref}`;
    const targetMounted = React.useRef(false);
    /** The revision this draft was seeded from; the save is fenced on it. */
    const [basis, setBasis] = React.useState<number | null>(() => entry?.revision ?? null);
    const movedUnderEditor = entry !== null && basis !== null && entry.revision !== basis;
    const ownsEncryptedResource = entry !== null
        && entry.relationship === 'owner'
        && entry.encryptionMode === 'e2ee'
        && parsed?.kind === 'shared_resource';
    const readiness = useSavedSecretRecipientReadiness({
        scope: props.scope,
        resourceId: ownsEncryptedResource && parsed?.kind === 'shared_resource' ? parsed.id : null,
        revision: entry?.revision ?? null,
    });
    const [finishingSharing, setFinishingSharing] = React.useState(false);

    React.useEffect(() => {
        targetMounted.current = true;
        return () => { targetMounted.current = false; };
    }, [targetIdentity]);

    React.useEffect(() => {
        setDraft(draftFromTarget(props.target));
        setBasis(props.target.kind === 'shared' ? props.target.entry.revision : null);
        setSaving(false);
        setFailure(null);
    }, [targetIdentity]);

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

            {readiness.state ? (() => {
                const state = readiness.state;
                if (state.status === 'error') {
                    return (
                        <ItemGroup title={t('secrets.catalog.recipientReadinessTitle')}>
                            <Item
                                testID="saved-secret-recipient-readiness-retry"
                                title={t('common.retry')}
                                subtitle={t('secrets.catalog.recipientReadinessUnavailable')}
                                onPress={readiness.reload}
                                showChevron={false}
                            />
                        </ItemGroup>
                    );
                }
                const recipients = state.status === 'ready'
                    ? state.recipients.filter((recipient) => recipient.account.accountId !== props.scope.accountId)
                    : [];
                if (state.status === 'ready' && recipients.length === 0) return null;
                const owesEnvelopes = recipients.some((recipient) => (
                    recipient.readiness.status === 'available' && recipient.envelopeStatus !== 'prepared'
                ));
                const needsHomeManaged = recipients.some((recipient) => (
                    recipient.readiness.status === 'unavailable' && recipient.readiness.reason === 'plain_account'
                ));
                const busy = saving || finishingSharing || Boolean(props.approvalPending);
                return (
                    <ItemGroup title={t('secrets.catalog.recipientReadinessTitle')}>
                        {state.status === 'loading' ? (
                            <Item title={t('secrets.catalog.recipientReadinessTitle')} loading showChevron={false} />
                        ) : null}
                        {recipients.map((recipient) => (
                            <Item
                                key={recipient.account.accountId}
                                testID={`saved-secret-recipient:${recipient.account.accountId}`}
                                title={formatAccountDisplayName(recipient.account) ?? t('secrets.catalog.unavailableName')}
                                subtitle={recipientReadinessLabel(recipient)}
                                showChevron={false}
                            />
                        ))}
                        {owesEnvelopes && state.status === 'ready' ? (
                            <Item
                                testID="saved-secret-recipient-finish-sharing"
                                title={t('secrets.catalog.recipientFinishSharing')}
                                loading={finishingSharing}
                                disabled={busy}
                                onPress={async () => {
                                    const encryption = getSyncSingleton().encryption;
                                    if (!encryption || !parsed || parsed.kind !== 'shared_resource') return;
                                    setFinishingSharing(true);
                                    try {
                                        await repairApprovedSavedSecretResourceEnvelopesBestEffort({
                                            scope: props.scope,
                                            resourceId: parsed.id,
                                            expectedRevision: state.revision,
                                            decryptDataKeyEnvelope: (value) => encryption.decryptEncryptionKey(value, props.scope),
                                        });
                                    } finally {
                                        setFinishingSharing(false);
                                        readiness.reload();
                                    }
                                }}
                                showChevron={false}
                            />
                        ) : null}
                        {needsHomeManaged && props.onMakeHomeManaged ? (
                            <Item
                                testID="saved-secret-recipient-make-home-managed"
                                title={t('secrets.catalog.actions.convertToPlain')}
                                disabled={busy}
                                onPress={props.onMakeHomeManaged}
                                showChevron={false}
                            />
                        ) : null}
                    </ItemGroup>
                );
            })() : null}

            <ItemGroup footer={failure
                ? failure === 'outcome_unknown'
                    ? t('secrets.catalog.outcomeUnknown')
                    : t('secrets.catalog.operationFailed')
                : movedUnderEditor ? t('secrets.catalog.operationFailed') : undefined}>
                <Item title={t('common.cancel')} disabled={saving || props.approvalPending} onPress={props.onClose} showChevron={false} />
                <Item
                    testID="saved-secret-access-save"
                    title={t('common.save')}
                    loading={saving || props.approvalPending}
                    disabled={saving || props.approvalPending || movedUnderEditor}
                    onPress={async () => {
                        // The revision fence is a correctness rule: a press from
                        // a stale render must not replace an audience somebody
                        // else already changed.
                        if (movedUnderEditor) return;
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
                                expectedRevision: basis ?? entry!.revision!,
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
                {movedUnderEditor && entry !== null ? (
                    <Item
                        testID="saved-secret-access-reload"
                        title={t('common.retry')}
                        disabled={saving || props.approvalPending}
                        onPress={() => {
                            // Adopting the Home's current recipients is an
                            // explicit choice, never something a refresh does.
                            setDraft(draftFromTarget(props.target));
                            setBasis(entry.revision);
                            setFailure(null);
                        }}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        </ItemList>
    );
});
