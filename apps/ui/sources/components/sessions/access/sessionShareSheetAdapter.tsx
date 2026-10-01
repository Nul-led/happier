import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Switch } from '@/components/ui/forms/Switch';
import type { SelectionListOption, SelectionListSectionDescriptor } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { ShareRowAction } from '@/components/sharing/ShareGrantRow';
import type { ShareSheetAdapter, ShareSheetSectionContext } from '@/components/sharing/shareSheetTypes';
import type { SessionCollaborationHandoff } from '@/components/sessions/collaboration/sessionCollaborationIntent';
import { t } from '@/text';
import { projectSessionAccessLevelLabel } from './projectSessionAccessLevelLabel';
import type { SessionAccessEditorActions, SessionAccessEditorModel, SessionAccessGrantRowModel } from './sessionAccessEditorTypes';

const styles = StyleSheet.create((theme) => ({
    contextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    delegation: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    text: { color: theme.colors.text.primary },
    secondary: { color: theme.colors.text.secondary },
}));

/** Runtime-permission delegation: the one session-only control inside an open grant. */
function SessionAccessDelegationControl(props: Readonly<{
    row: SessionAccessGrantRowModel; actions: SessionAccessEditorActions; context: ShareSheetSectionContext;
}>): React.ReactElement | null {
    const { row, actions, context } = props;
    const delegation = row.permissionDelegation;
    if (delegation.kind === 'hidden') return null;
    const busy = row.operation.kind === 'saving' || row.operation.kind === 'removing';
    const id = (kind: string) => `${context.idPrefix}session-access-${kind}:${row.principal.key}`;
    return <View style={styles.delegation}>
        <Text style={styles.text}>{t('session.access.delegation')}</Text>
        {context.editable && delegation.kind === 'editable' ? <Switch testID={id('delegation')}
            value={delegation.value} disabled={busy}
            accessibilityLabel={`${row.principal.accessibilityLabel}, ${t('session.access.delegation')}`}
            onValueChange={(value) => actions.setPermissionDelegation(row.grant, value)} /> :
            <Text style={styles.secondary}>{delegation.value ? t('common.on') : t('common.off')}</Text>}
        {delegation.kind === 'locked' ? <ShareRowAction label={delegation.reason.message}
            testID={id('delegation-reason')} onPress={() => actions.explain(delegation.reason)} /> : null}
    </View>;
}

/**
 * The `Encrypted access` section: one aggregate row, one real preparation action, and the
 * explicit `Show all recipients` diagnostic. The diagnostic is always reachable while the Session
 * needs envelopes, but its rows are only requested once the manager opens it.
 */
function buildEncryptionSection(model: SessionAccessEditorModel, actions: SessionAccessEditorActions, idPrefix: string): SelectionListSectionDescriptor | null {
    const encryption = model.encryption;
    if (!encryption) return null;
    const options: SelectionListOption[] = [{
        id: 'encryption-summary',
        testID: `${idPrefix}session-access-encryption-summary`,
        label: encryption.progressLabel ?? encryption.summaryLabel,
        subtitle: encryption.error?.message,
        accessibilityLabel: encryption.accessibilityLabel,
        // Spinner only while this client is observed preparing; an idle pending audience is settled work.
        loading: encryption.progressLabel !== undefined,
        onSelect: encryption.reason ? () => { if (encryption.reason) actions.explain(encryption.reason); } : undefined,
        ...(encryption.actionLabel ? {
            rightAccessoryOutsidePressable: true,
            rightAccessory: () => <ShareRowAction label={encryption.actionLabel ?? ''}
                testID={`${idPrefix}session-access-prepare`} onPress={() => actions.prepareAccess()} />,
        } : {}),
    }, {
        id: 'encryption-show-all',
        testID: `${idPrefix}session-access-show-all-recipients`,
        label: encryption.showAllLabel,
        accessibilityLabel: encryption.showAllLabel,
        onSelect: actions.toggleAllRecipients,
    }];
    const recipients = encryption.recipients;
    if (recipients) {
        for (const row of recipients.rows) options.push({
            id: `encryption-recipient:${row.recipientAccountId}`,
            testID: `${idPrefix}session-access-recipient-${row.recipientAccountId}`,
            label: row.label,
            subtitle: row.stateLabel,
            accessibilityLabel: row.accessibilityLabel,
            disabled: true,
            // The projection already decided which rows a repeated delivery could change.
            ...(row.actionLabel && model.accessMode === 'editable' && model.content.hasLastAcknowledgedSnapshot ? {
                rightAccessoryOutsidePressable: true,
                rightAccessory: () => <ShareRowAction label={row.actionLabel ?? ''}
                    testID={`${idPrefix}session-access-reprepare-${row.recipientAccountId}`}
                    disabled={encryption.progressLabel !== undefined}
                    onPress={() => actions.prepareAccess(row.recipientAccountId)} />,
            } : {}),
        });
        if (recipients.loading) options.push({ id: 'encryption-recipients-loading', label: t('common.loading'), loading: true, disabled: true });
        if (recipients.error) options.push({ id: 'encryption-recipients-error', label: recipients.error.message,
            rightAccessoryOutsidePressable: true,
            rightAccessory: () => <ShareRowAction label={t('common.retry')}
                testID={`${idPrefix}session-access-recipients-retry`} onPress={actions.loadMoreRecipients} /> });
        else if (recipients.hasMore && !recipients.loading) options.push({
            id: 'encryption-recipients-more',
            testID: `${idPrefix}session-access-recipients-more`,
            label: t('session.access.moreRecipients'),
            onSelect: actions.loadMoreRecipients,
        });
        if (!recipients.loading && !recipients.error && recipients.rows.length === 0) options.push({
            id: 'encryption-recipients-empty', label: t('common.noMatches'), disabled: true,
        });
    }
    return { kind: 'static', id: 'encryption', title: t('session.access.encryptedAccess'), options };
}

/** Whether a manager may change this Session's roster now; a pending approval holds every edit. */
export function isSessionAccessEditable(model: SessionAccessEditorModel): boolean {
    return model.accessMode === 'editable' && model.content.hasLastAcknowledgedSnapshot && !model.pendingApproval;
}

/**
 * The session meaning of the one share sheet: "Can view / Can steer / Admin", runtime-permission
 * delegation, the Session's Team context, encrypted access, approvals and the hand-off to the full
 * Collaboration surface.
 */
export function createSessionShareSheetAdapter(input: Readonly<{
    model: SessionAccessEditorModel;
    actions: SessionAccessEditorActions;
    /** The Session's in-app route; absent for a session that doesn't exist yet. */
    linkPath?: string;
    responsibleAccountId?: string | null;
    onOpenFullSurface?: (handoff: SessionCollaborationHandoff) => void;
}>): ShareSheetAdapter<SessionAccessGrantRowModel> {
    const { model, actions } = input;
    return {
        namespace: 'session-access',
        title: t('session.access.title'),
        levels: {
            view: { label: projectSessionAccessLevelLabel('view') },
            edit: { label: projectSessionAccessLevelLabel('edit') },
            admin: { label: projectSessionAccessLevelLabel('admin') },
        },
        notes: [t('session.access.help')],
        ...(input.linkPath ? { linkPath: input.linkPath } : {}),
        principalTags: (principal, row) => {
            // The Session's one responsible person is named where their access is, so the Share
            // panel answers "who is on the hook" without a second list.
            const responsible = principal.ref.kind === 'account' && input.responsibleAccountId != null
                && principal.ref.accountId === input.responsibleAccountId;
            return [row?.requiredByTeamPolicy ? t('session.access.required') : undefined,
                responsible ? t('session.responsibilityRowTitle') : undefined].filter((tag): tag is string => tag !== undefined);
        },
        showsLevelLock: (row) => row.requiredByTeamPolicy,
        renderGrantDetails: (row, context) => <SessionAccessDelegationControl row={row} actions={actions} context={context} />,
        sections: ({ idPrefix, editable }) => {
            const leading: SelectionListSectionDescriptor[] = model.viewerAccess ? [{
                kind: 'static', id: 'viewer-access', title: t('session.access.yourAccess'),
                options: [{ id: 'viewer-access', testID: `${idPrefix}session-access-viewer-access`,
                    label: model.viewerAccess.levelLabel, subtitle: model.viewerAccess.sourceLabels.join(' · '),
                    accessibilityLabel: model.viewerAccess.accessibilityLabel, disabled: true }],
            }] : [];
            const afterAccess: SelectionListSectionDescriptor[] = [];
            const context = model.context;
            if (context) {
                afterAccess.push({ kind: 'static', id: 'context', title: t('session.access.teams'), options: context.options.map((option) => ({
                    id: `context:${option.teamId ?? 'personal'}`,
                    testID: `${idPrefix}session-access-context-${option.teamId ?? 'personal'}`,
                    label: option.label,
                    subtitle: option.teamId === context.primaryTeamId ? t('session.access.team') : option.blockedReason?.message,
                    loading: context.operation === 'saving'
                        && option.teamId === (context.confirmation?.teamId ?? context.primaryTeamId),
                    disabled: !editable || context.operation === 'saving',
                    onSelect: () => option.blockedReason ? actions.explain(option.blockedReason) : actions.setContext(option.teamId),
                })) });
                const confirmation = context.confirmation;
                if (confirmation) afterAccess.push({ kind: 'static', id: 'context-confirmation', title: confirmation.label, options: [
                    ...confirmation.consequences.map((consequence, index) => ({ id: `context-consequence:${index}`, label: consequence, disabled: true })),
                    { id: 'context-confirmation-actions', label: confirmation.label, rightAccessoryOutsidePressable: true,
                        rightAccessory: () => <View style={styles.contextActions}>
                            <ShareRowAction label={t('common.continue')} testID={`${idPrefix}session-access-context-confirm`}
                                disabled={context.operation === 'saving'} onPress={actions.confirmContext} />
                            <ShareRowAction label={t('common.cancel')} testID={`${idPrefix}session-access-context-cancel`}
                                disabled={context.operation === 'saving'} onPress={actions.cancelContext} />
                        </View> },
                ] });
            }
            // Directly under the audience it describes, and above the directory: one quiet
            // Session-scoped line, never a readiness badge beside each person.
            const encryption = buildEncryptionSection(model, actions, idPrefix);
            if (encryption) afterAccess.push(encryption);

            const notices: SelectionListOption[] = [];
            if (model.pendingApproval) notices.push({ id: 'approval-pending', testID: `${idPrefix}session-access-approval`,
                label: t('approvals.title'), subtitle: t('approvals.status.open'),
                onSelect: actions.openPendingApproval, disabled: !actions.openPendingApproval });
            const historical = model.historicalLayout;
            const update = actions.updateHistoricalLayout;
            if (historical && update) notices.push({ id: 'historical-layout', testID: `${idPrefix}session-access-historical-layout`,
                label: t('session.access.historicalLayoutNotice'),
                ...(historical.error ? { subtitle: historical.error.message } : {}),
                loading: historical.updating,
                rightAccessoryOutsidePressable: true,
                rightAccessory: () => <ShareRowAction label={t('session.access.historicalLayoutUpdate')}
                    testID={`${idPrefix}session-access-historical-layout-update`}
                    disabled={historical.updating || !editable} onPress={update} /> });
            if (model.content.phase === 'initial' || model.content.phase === 'refreshing') notices.push({ id: 'loading', label: t('common.loading'), loading: true, disabled: true });
            if (model.content.issue) notices.push({ id: 'issue', label: model.content.issue.message, onSelect: model.content.issue.retryable ? actions.retryContent : undefined,
                rightAccessory: model.content.issue.retryable ? () => <Text>{t('common.retry')}</Text> : undefined });
            if (context?.error) notices.push({ id: 'context-issue', label: context.error.message });
            const readOnlyReason = model.readOnlyReason;
            if (readOnlyReason) notices.push({ id: 'read-only', label: readOnlyReason.message, onSelect: () => actions.explain(readOnlyReason) });
            const notice = model.notice;
            if (notice) notices.push({ id: 'notice', label: notice.message,
                onSelect: notice.action === 'clear_access' ? actions.clearAccess : () => { if (notice.reason) actions.explain(notice.reason); },
                rightAccessoryOutsidePressable: notice.action === 'clear_access',
                rightAccessory: notice.action === 'clear_access' ? () => <ShareRowAction label={t('session.access.private')}
                    testID={`${idPrefix}session-access-clear-draft`} onPress={actions.clearAccess} /> : undefined });
            const trailing: SelectionListSectionDescriptor[] = notices.length ? [{ kind: 'static', id: 'status', options: notices }] : [];
            // The anchored composer popover is otherwise a dead end on a wide desktop: this is its one
            // route into the same Collaboration destination with Access focused.
            const openFullSurface = input.onOpenFullSurface;
            if (openFullSurface) trailing.push({ kind: 'static', id: 'open-collaboration', options: [{
                id: 'open-collaboration',
                testID: `${idPrefix}session-access-open-collaboration`,
                label: t('session.access.openCollaboration'),
                // The destination reloads the roster itself; what it cannot rebuild is what was typed.
                onSelect: () => openFullSurface({ query: model.directory.query }),
            }] });
            return { leading, afterAccess, trailing };
        },
    };
}
