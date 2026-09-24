import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import type { SelectionListOption, SelectionListSectionDescriptor, SelectionListStep } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import type { SessionCollaborationHandoff } from '@/components/sessions/collaboration/sessionCollaborationIntent';
import { SessionAccessGrantRow, SessionAccessLevelControl, SessionAccessRowAction } from './SessionAccessGrantRow';
import type {
    SessionAccessCandidateRowModel, SessionAccessDirectoryKind, SessionAccessDirectorySectionModel,
    SessionAccessEditorActions, SessionAccessEditorModel, SessionAccessPrincipalPresentation,
} from './sessionAccessEditorTypes';

const styles = StyleSheet.create(() => ({
    contextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
}));

function principalSubtitle(principal: SessionAccessPrincipalPresentation, required?: boolean): string {
    const kind = principal.ref.kind === 'account' ? t('session.access.account') : principal.ref.kind === 'group' ? t('session.access.group') : t('session.access.team');
    return [kind, principal.secondaryLabel, required ? t('session.access.required') : undefined].filter(Boolean).join(' · ');
}

/**
 * The row's leading identity mark: the canonical `Avatar` for an Account — which
 * already owns image loading and the generated fallback — and the themed kind
 * glyph for a Team or Group, which has no Account profile to draw.
 *
 * It is decorative on purpose. The row's own `accessibilityLabel` is the single
 * accessible name, and the visible kind stays in the subtitle so recognition
 * never depends on the glyph. `Item` resizes the leading visual for list
 * density, so `size` is accepted rather than fixed here.
 */
function SessionAccessPrincipalVisual(props: Readonly<{
    principal: SessionAccessPrincipalPresentation; testID: string; size?: number;
}>): React.ReactElement {
    const { principal } = props;
    const { theme } = useUnistyles();
    const size = props.size ?? ICON_SIZE.lg;
    return <View testID={props.testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {principal.ref.kind === 'account'
            ? <Avatar id={principal.avatar?.id ?? principal.key} size={size} imageUrl={principal.avatar?.imageUrl ?? null} />
            : <Icon name="users" size={size} color={theme.colors.text.secondary} />}
    </View>;
}

function principalVisual(principal: SessionAccessPrincipalPresentation, idPrefix: string): () => React.ReactNode {
    return () => <SessionAccessPrincipalVisual principal={principal}
        testID={`${idPrefix}session-access-principal-visual:${principal.key}`} />;
}

/**
 * The `Encrypted access` section: one aggregate row, one real preparation action,
 * and the explicit `Show all recipients` diagnostic.
 *
 * The diagnostic is always reachable while the Session needs envelopes, including
 * when every recipient is healthy — inspection must not require something to be
 * broken first — but its rows are only requested once the manager opens it.
 */
function buildEncryptionSection(input: Readonly<{
    model: SessionAccessEditorModel;
    actions: SessionAccessEditorActions;
    idPrefix: string;
}>): SelectionListSectionDescriptor | null {
    const { model, actions, idPrefix } = input;
    const encryption = model.encryption;
    if (!encryption) return null;
    const options: SelectionListOption[] = [{
        id: 'encryption-summary',
        testID: `${idPrefix}session-access-encryption-summary`,
        label: encryption.progressLabel ?? encryption.summaryLabel,
        subtitle: encryption.error?.message,
        accessibilityLabel: encryption.accessibilityLabel,
        // Spinner only while this client is observed preparing; an idle pending
        // audience is settled work, not progress.
        loading: encryption.progressLabel !== undefined,
        onSelect: encryption.reason ? () => { if (encryption.reason) actions.explain(encryption.reason); } : undefined,
        ...(encryption.actionLabel ? {
            rightAccessoryOutsidePressable: true,
            rightAccessory: () => <SessionAccessRowAction label={encryption.actionLabel ?? ''}
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
            // The projection already decided which rows a repeated delivery could
            // change, and what to call it there; this surface only renders it.
            ...(row.actionLabel && model.accessMode === 'editable' && model.content.hasLastAcknowledgedSnapshot ? {
                rightAccessoryOutsidePressable: true,
                rightAccessory: () => <SessionAccessRowAction label={row.actionLabel ?? ''}
                    testID={`${idPrefix}session-access-reprepare-${row.recipientAccountId}`}
                    disabled={encryption.progressLabel !== undefined}
                    onPress={() => actions.prepareAccess(row.recipientAccountId)} />,
            } : {}),
        });
        if (recipients.loading) options.push({ id: 'encryption-recipients-loading', label: t('common.loading'), loading: true, disabled: true });
        if (recipients.error) options.push({ id: 'encryption-recipients-error', label: recipients.error.message,
            rightAccessoryOutsidePressable: true,
            rightAccessory: () => <SessionAccessRowAction label={t('common.retry')}
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

export function buildSessionAccessSelectionStep(input: Readonly<{
    model: SessionAccessEditorModel;
    actions: SessionAccessEditorActions;
    onExpand(key: string): void;
    testID?: string;
    directoryKind?: SessionAccessDirectoryKind;
    /** Supplied only by an anchored composer editor, never by the full surface. */
    onOpenFullSurface?: (handoff: SessionCollaborationHandoff) => void;
}>): SelectionListStep {
    const { model, actions } = input;
    const idPrefix = input.testID && input.testID !== 'session-access-editor' ? `${input.testID}:` : '';
    const excluded = new Set(model.grants.map((row) => row.principal.key));
    if (model.owner) excluded.add(model.owner.principal.key);
    // A change awaiting its approval holds every other edit until it settles.
    const editable = model.accessMode === 'editable' && model.content.hasLastAcknowledgedSnapshot
        && !model.pendingApproval;
    const current: SelectionListOption[] = [];
    if (model.owner) current.push({ id: model.owner.principal.key, label: model.owner.principal.displayName,
        subtitle: principalSubtitle(model.owner.principal), accessibilityLabel: model.owner.principal.accessibilityLabel,
        icon: principalVisual(model.owner.principal, idPrefix),
        rightAccessory: () => <Text>{t('session.access.owner')}</Text> });
    for (const row of model.grants) current.push({
        id: row.principal.key, testID: `${idPrefix}session-access-grant-${row.principal.key}`,
        label: row.principal.displayName, subtitle: [principalSubtitle(row.principal, row.requiredByTeamPolicy), row.operation.kind === 'error' ? row.operation.error.message : undefined].filter(Boolean).join(' · '),
        accessibilityLabel: row.principal.accessibilityLabel,
        icon: principalVisual(row.principal, idPrefix),
        loading: row.operation.kind === 'saving' || row.operation.kind === 'removing',
        onSelect: () => input.onExpand(row.principal.key),
        rightAccessoryOutsidePressable: true,
        rightAccessory: () => <SessionAccessLevelControl row={row} actions={actions} onExpand={() => input.onExpand(row.principal.key)}
            testID={`${idPrefix}session-access-level:${row.principal.key}`} />,
        expandedContent: () => <SessionAccessGrantRow row={row} actions={actions} editable={editable} idPrefix={idPrefix} />,
    });
    const candidateOptions = (rows: readonly SessionAccessCandidateRowModel[]): SelectionListOption[] => {
        const seen = new Set(excluded);
        return rows.flatMap((row) => {
            if (seen.has(row.principal.key)) return [];
            seen.add(row.principal.key);
            const reason = row.addition.kind === 'blocked' ? row.addition.reason : undefined;
            return [{ id: row.principal.key, testID: `${idPrefix}session-access-candidate-${row.principal.key}`,
                label: row.principal.displayName,
                subtitle: [principalSubtitle(row.principal), reason?.message, row.operation.kind === 'error' ? row.operation.error.message : undefined].filter(Boolean).join(' · '),
                accessibilityLabel: row.principal.accessibilityLabel,
                icon: principalVisual(row.principal, idPrefix),
                loading: row.operation.kind === 'saving',
                disabled: row.operation.kind === 'saving',
                onSelect: () => reason ? actions.explain(reason) : actions.addPrincipal(row.principal.ref),
            }];
        });
    };
    const sourceSection = (source: SessionAccessDirectorySectionModel): SelectionListSectionDescriptor => ({
        kind: 'dynamic', id: `directory:${source.kind}`, title: source.title,
        resolverKey: JSON.stringify([source.resolverKey ?? source.kind, [...excluded], source.resolveCandidates ? undefined : model.revision]),
        resultFiltering: 'provider', resultTransition: 'none',
        // The list owns debounce, cancellation and stale result rejection. No network or store access lives here.
        resolve: async (query, signal) => ({
            options: candidateOptions(source.resolveCandidates ? await source.resolveCandidates(query, signal) : source.candidates),
            resultHint: !source.resolveCandidates && (source.status === 'loading' || source.status === 'refreshing') ? t('common.loading') : undefined,
        }),
    });
    const sections: SelectionListSectionDescriptor[] = input.directoryKind ? [] : [
        ...(model.viewerAccess ? [{
            kind: 'static' as const,
            id: 'viewer-access',
            title: t('session.access.yourAccess'),
            options: [{
                id: 'viewer-access',
                testID: `${idPrefix}session-access-viewer-access`,
                label: model.viewerAccess.levelLabel,
                subtitle: model.viewerAccess.sourceLabels.join(' · '),
                accessibilityLabel: model.viewerAccess.accessibilityLabel,
                disabled: true,
            }],
        }] : []),
        // Last-good rows stay while the Home cannot be reached — an authoritative
        // empty roster would be a lie — but they must not read as the current
        // answer. This is the same word presence already uses for retained facts.
        { kind: 'static', id: 'current', title: model.content.phase === 'error' && model.content.hasLastAcknowledgedSnapshot
            ? t('session.access.withContext', { context: t('session.access.hasAccess'), label: t('session.collaboration.stale') })
            : t('session.access.hasAccess'), options: current },
    ];
    if (!input.directoryKind && model.context) {
        sections.push({ kind: 'static', id: 'context', title: t('session.access.teams'), options: model.context.options.map((option) => ({
            id: `context:${option.teamId ?? 'personal'}`,
            testID: `${idPrefix}session-access-context-${option.teamId ?? 'personal'}`,
            label: option.label,
            subtitle: option.teamId === model.context?.primaryTeamId ? t('session.access.team')
                : option.blockedReason?.message,
            loading: model.context?.operation === 'saving'
                && option.teamId === (model.context?.confirmation?.teamId ?? model.context?.primaryTeamId),
            disabled: !editable || model.context?.operation === 'saving',
            onSelect: () => option.blockedReason ? actions.explain(option.blockedReason) : actions.setContext(option.teamId),
        })) });
        if (model.context.confirmation) {
            sections.push({ kind: 'static', id: 'context-confirmation', title: model.context.confirmation.label, options: [
                ...model.context.confirmation.consequences.map((consequence, index) => ({
                    id: `context-consequence:${index}`,
                    label: consequence,
                    disabled: true,
                })),
                {
                    id: 'context-confirmation-actions',
                    label: model.context.confirmation.label,
                    rightAccessoryOutsidePressable: true,
                    rightAccessory: () => <View style={styles.contextActions}>
                        <SessionAccessRowAction label={t('common.continue')} testID={`${idPrefix}session-access-context-confirm`}
                            disabled={model.context?.operation === 'saving'} onPress={actions.confirmContext} />
                        <SessionAccessRowAction label={t('common.cancel')} testID={`${idPrefix}session-access-context-cancel`}
                            disabled={model.context?.operation === 'saving'} onPress={actions.cancelContext} />
                    </View>,
                },
            ] });
        }
    }
    if (!input.directoryKind) {
        // Directly under the audience it describes, and above the directory: one quiet
        // Session-scoped line, never a readiness badge beside each person.
        const encryption = buildEncryptionSection({ model, actions, idPrefix });
        if (encryption) sections.push(encryption);
    }
    if (editable) for (const kind of ['account', 'group', 'team'] as const) {
        if (input.directoryKind && input.directoryKind !== kind) continue;
        const source = model.directory.sections.find((section) => section.kind === kind);
        if (!source) continue;
        sections.push(sourceSection(source));
        const controls: SelectionListOption[] = [];
        if (source.status === 'error' && source.error) controls.push({ id: `retry:${kind}`, label: source.error.message,
            rightAccessoryOutsidePressable: true, rightAccessory: () => <SessionAccessRowAction label={t('common.retry')}
                testID={`${idPrefix}session-access-directory-retry:${kind}`} onPress={() => actions.retryDirectory(kind)} /> });
        if (!input.directoryKind && source.hasMore) controls.push({ id: `browse:${kind}`, label: source.title,
            subtitle: t('session.access.browseMore'), testID: `${idPrefix}session-access-browse:${kind}`,
            openStep: buildSessionAccessSelectionStep({ ...input, directoryKind: kind }) });
        if (controls.length) sections.push({ kind: 'static', id: `directory-controls:${kind}`, options: controls });
    }
    if (!input.directoryKind) {
        const notices: SelectionListOption[] = [];
        if (model.pendingApproval) notices.push({ id: 'approval-pending', testID: `${idPrefix}session-access-approval`,
            label: t('approvals.title'), subtitle: t('approvals.status.open'),
            onSelect: actions.openPendingApproval, disabled: !actions.openPendingApproval });
        if (model.historicalLayout && actions.updateHistoricalLayout) {
            const historical = model.historicalLayout;
            const update = actions.updateHistoricalLayout;
            notices.push({ id: 'historical-layout', testID: `${idPrefix}session-access-historical-layout`,
                label: t('session.access.historicalLayoutNotice'),
                ...(historical.error ? { subtitle: historical.error.message } : {}),
                loading: historical.updating,
                rightAccessoryOutsidePressable: true,
                rightAccessory: () => <SessionAccessRowAction label={t('session.access.historicalLayoutUpdate')}
                    testID={`${idPrefix}session-access-historical-layout-update`}
                    disabled={historical.updating || !editable} onPress={update} /> });
        }
        if (model.content.phase === 'initial' || model.content.phase === 'refreshing') notices.push({ id: 'loading', label: t('common.loading'), loading: true, disabled: true });
        if (model.content.issue) notices.push({ id: 'issue', label: model.content.issue.message, onSelect: model.content.issue.retryable ? actions.retryContent : undefined,
            rightAccessory: model.content.issue.retryable ? () => <Text>{t('common.retry')}</Text> : undefined });
        if (model.context?.error) notices.push({ id: 'context-issue', label: model.context.error.message });
        if (model.readOnlyReason) notices.push({ id: 'read-only', label: model.readOnlyReason.message, onSelect: () => { if (model.readOnlyReason) actions.explain(model.readOnlyReason); } });
        if (model.notice) notices.push({ id: 'notice', label: model.notice.message,
            onSelect: model.notice.action === 'clear_access' ? actions.clearAccess : () => { if (model.notice?.reason) actions.explain(model.notice.reason); },
            rightAccessoryOutsidePressable: model.notice.action === 'clear_access',
            rightAccessory: model.notice.action === 'clear_access' ? () => <SessionAccessRowAction label={t('session.access.private')}
                testID={`${idPrefix}session-access-clear-draft`} onPress={actions.clearAccess} /> : undefined });
        notices.push({ id: 'access-help', label: t('common.details'),
            onSelect: () => input.onExpand('access-help'), expandedContent: () => <Text>{t('session.access.help')}</Text> });
        sections.push({ kind: 'static', id: 'status', options: notices });
    }
    // The anchored composer popover is otherwise a dead end on a wide desktop:
    // this is its one route into the same Collaboration destination with Access
    // focused. The full surface never offers to open itself.
    if (!input.directoryKind && input.onOpenFullSurface) {
        const openFullSurface = input.onOpenFullSurface;
        sections.push({ kind: 'static', id: 'open-collaboration', options: [{
            id: 'open-collaboration',
            testID: `${idPrefix}session-access-open-collaboration`,
            label: t('session.access.openCollaboration'),
            // The destination mounts its own controller and reloads the roster
            // itself; what it cannot rebuild is what the person already typed.
            onSelect: () => openFullSurface({ query: model.directory.query }),
        }] });
    }
    return { id: input.directoryKind ? `session-access-directory:${input.directoryKind}` : 'session-access',
        ...(editable ? { inputPlaceholder: t('session.access.search') } : {}), disableInputFilter: true,
        emptyStateLabel: t('common.noMatches'), sections };
}
