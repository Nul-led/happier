import * as React from 'react';
import type {
    TeamCredentialBrokerPlacementV1,
    TeamCredentialSourceLocatorV1,
    TeamCredentialSourceResourceAdministrationV1,
} from '@happier-dev/protocol/teams';
import { teamCredentialSourceLocatorKeyV1 } from '@happier-dev/protocol/teams';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import {
    deleteTeamCredentialResource,
    listTeamCredentialSourceResources,
    updateTeamCredentialResource,
} from '@/sync/ops/teams/teamCredentialOperations';
import { t } from '@/text';

import {
    credentialFailureMessage,
    resourceStateLabel,
    teamCredentialBrokerPlacementsEqual,
} from './teamCredentialPresentation';
import { TeamCredentialBrokerPlacementSection } from './teamCredentialEditorDraft';

function SourceBrokerPlacementEditor(props: Readonly<{
    scope: ServerAccountScope;
    row: TeamCredentialSourceResourceAdministrationV1;
    pending: boolean;
    onSave: (placement: TeamCredentialBrokerPlacementV1 | null, expectedRevision: number) => Promise<boolean>;
}>) {
    const [draft, setDraft] = React.useState<TeamCredentialBrokerPlacementV1 | null>(props.row.brokerPlacement);
    const basisRevision = React.useRef(props.row.revision);
    const latestRevision = React.useRef(props.row.revision);
    latestRevision.current = props.row.revision;
    const changed = !teamCredentialBrokerPlacementsEqual(draft, props.row.brokerPlacement);
    const chooseDraft = (next: TeamCredentialBrokerPlacementV1 | null) => {
        if (!changed) basisRevision.current = props.row.revision;
        setDraft(next);
    };

    React.useEffect(() => {
        if (!changed) setDraft(props.row.brokerPlacement);
    }, [changed, props.row.brokerPlacement, props.row.revision]);

    return (
        <>
            <TeamCredentialBrokerPlacementSection
                scope={props.scope}
                testIDPrefix={`shared-with-teams:broker:${props.row.id}`}
                brokerPresentation={props.row.brokerPresentation}
                savedPlacement={props.row.brokerPlacement}
                placement={draft}
                disabled={props.pending}
                onChange={chooseDraft}
            />
            <ItemGroup>
                <Item
                    testID={`shared-with-teams:broker:${props.row.id}:save`}
                    title={t('common.save')}
                    disabled={!changed || props.pending}
                    loading={props.pending}
                    onPress={() => void props.onSave(draft, basisRevision.current).then((saved) => {
                        if (!saved) basisRevision.current = latestRevision.current;
                    })}
                    showChevron={false}
                />
            </ItemGroup>
        </>
    );
}

function readSourceResourceNextCursor(page: object): string | null {
    if (!('nextCursor' in page)) return null;
    return typeof page.nextCursor === 'string' ? page.nextCursor : null;
}

export const SharedWithTeamsSourceAdministration = React.memo(function SharedWithTeamsSourceAdministration(
    props: Readonly<{ scope: ServerAccountScope; source: TeamCredentialSourceLocatorV1 }>,
) {
    const router = useRouter();
    const [rows, setRows] = React.useState<readonly TeamCredentialSourceResourceAdministrationV1[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [openId, setOpenId] = React.useState<string | null>(null);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const generation = React.useRef(0);

    const reload = React.useCallback(async () => {
        const requestGeneration = ++generation.current;
        const outcome = await listTeamCredentialSourceResources(props);
        if (generation.current !== requestGeneration) return;
        if (outcome.kind === 'succeeded') {
            setRows(outcome.value.resources);
            setNextCursor(readSourceResourceNextCursor(outcome.value));
            setError(null);
        } else {
            setError(credentialFailureMessage(outcome.failure));
        }
    }, [props.scope, props.source]);
    const loadMore = React.useCallback(async () => {
        if (!nextCursor) return;
        setLoadingMore(true);
        try {
            const outcome = await listTeamCredentialSourceResources({ ...props, cursor: nextCursor });
            if (outcome.kind === 'succeeded') {
                setRows((current) => [...(current ?? []), ...outcome.value.resources.filter(
                    (row) => !(current ?? []).some((existing) => existing.id === row.id),
                )]);
                setNextCursor(readSourceResourceNextCursor(outcome.value));
            } else setError(credentialFailureMessage(outcome.failure));
        } finally { setLoadingMore(false); }
    }, [nextCursor, props.scope, props.source]);
    const approval = useActionApprovalContinuation({
        scopeKey: `${props.scope.serverId}:${props.scope.accountId}:credential-source:${teamCredentialSourceLocatorKeyV1(props.source)}`,
        serverId: props.scope.serverId,
        onExecuted: () => { void reload(); },
    });

    React.useEffect(() => {
        setRows(null);
        setError(null);
        setNextCursor(null);
        void reload();
        return () => { generation.current += 1; };
    }, [reload]);

    const update = React.useCallback(async (
        row: TeamCredentialSourceResourceAdministrationV1,
        patch: Readonly<{ enabled?: boolean; disclosureCeiling?: 'brokered_only'; brokerPlacement?: TeamCredentialBrokerPlacementV1 | null }>,
        expectedRevision = row.revision,
    ): Promise<boolean> => {
        setPendingId(row.id);
        try {
            const outcome = await updateTeamCredentialResource({
                scope: props.scope,
                resourceId: row.id,
                expectedRevision,
                ...patch,
                ...(patch.enabled === false ? { confirmedByPresentUser: true as const } : {}),
            });
            if (outcome.kind === 'failed') {
                await reload();
                setError(credentialFailureMessage(outcome.failure));
                return false;
            }
            await reload();
            return true;
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) approval.requestApproval(cause.registration);
            await reload();
            if (!isTeamActionApprovalPendingError(cause)) setError(t('teams.errors.generic'));
            return false;
        } finally {
            setPendingId(null);
        }
    }, [approval, props.scope, reload]);
    const openRow = rows?.find((row) => row.id === openId) ?? null;

    return (
        <>
        <ItemGroup title={t('teams.credentials.sourceAdministration.title')} description={error ?? undefined}>
            {approval.approvalId ? <Item
                testID="shared-with-teams:approval"
                title={t('approvals.title')}
                subtitle={approval.error ? t('approvals.loadError') : t('approvals.status.open')}
                accessibilityLiveRegion={approval.error ? 'assertive' : 'polite'}
                onPress={() => router.push(`/inbox/approvals/${encodeURIComponent(approval.approvalId!)}?serverId=${encodeURIComponent(props.scope.serverId)}`)}
                showChevron={false}
            /> : null}
            {rows === null && !error ? (
                <Item testID="shared-with-teams:loading" title={t('common.loading')} loading showChevron={false} />
            ) : null}
            {rows?.length === 0 ? (
                <Item testID="shared-with-teams:empty" mode="info" title={t('teams.credentials.sourceAdministration.empty')} showChevron={false} />
            ) : null}
            {rows?.map((row) => (
                <React.Fragment key={row.id}>
                    <Item
                        testID={`shared-with-teams:resource:${row.id}`}
                        title={row.displayName}
                        subtitle={resourceStateLabel(row.readiness.kind)}
                        selected={openId === row.id}
                        accessibilityExpanded={openId === row.id}
                        onPress={() => setOpenId((current) => current === row.id ? null : row.id)}
                    />
                    {openId === row.id && row.capabilities.narrowDisclosure && row.disclosureCeiling === 'direct_allowed' ? (
                        <Item
                            testID={`shared-with-teams:narrow:${row.id}`}
                            title={t('teams.credentials.edit.ceilingBrokeredOnly')}
                            disabled={pendingId === row.id || approval.approvalPending}
                            onPress={() => void update(row, { disclosureCeiling: 'brokered_only' })}
                            showChevron={false}
                        />
                    ) : null}
                    {openId === row.id && row.enabled && row.capabilities.disable ? (
                        <Item
                            testID={`shared-with-teams:disable:${row.id}`}
                            title={t('common.disable')}
                            disabled={pendingId === row.id || approval.approvalPending}
                            onPress={async () => {
                                if (!await Modal.confirm(t('common.disable'), t('teams.credentials.delete.body'), { confirmText: t('common.disable'), destructive: true })) return;
                                await update(row, { enabled: false });
                            }}
                            showChevron={false}
                        />
                    ) : null}
                    {openId === row.id && !row.enabled && row.capabilities.enable ? (
                        <Item
                            testID={`shared-with-teams:enable:${row.id}`}
                            title={t('common.enable')}
                            disabled={pendingId === row.id || approval.approvalPending}
                            onPress={() => void update(row, { enabled: true })}
                            showChevron={false}
                        />
                    ) : null}
                    {openId === row.id && row.capabilities.delete ? (
                        <Item
                            testID={`shared-with-teams:delete:${row.id}`}
                            title={t('teams.credentials.delete.action')}
                            destructive
                            disabled={pendingId === row.id || approval.approvalPending}
                            onPress={async () => {
                                if (!await Modal.confirm(t('teams.credentials.delete.title', { name: row.displayName }), t('teams.credentials.delete.body'), { confirmText: t('teams.credentials.delete.action'), destructive: true })) return;
                                setPendingId(row.id);
                                try {
                                    const outcome = await deleteTeamCredentialResource({ scope: props.scope, resourceId: row.id, expectedRevision: row.revision, confirmedByPresentUser: true });
                                    await reload();
                                    if (outcome.kind === 'failed') setError(credentialFailureMessage(outcome.failure));
                                } catch (cause) {
                                    if (isTeamActionApprovalPendingError(cause)) approval.requestApproval(cause.registration);
                                    await reload();
                                    if (!isTeamActionApprovalPendingError(cause)) setError(t('teams.errors.generic'));
                                } finally {
                                    setPendingId(null);
                                }
                            }}
                            showChevron={false}
                        />
                    ) : null}
                </React.Fragment>
            ))}
            {nextCursor ? <Item testID="shared-with-teams:load-more" title={t('common.next')} disabled={loadingMore} loading={loadingMore} onPress={() => void loadMore()} showChevron={false} /> : null}
            {error && rows === null ? (
                <Item testID="shared-with-teams:retry" title={t('common.retry')} onPress={() => void reload()} showChevron={false} />
            ) : null}
        </ItemGroup>
        {openRow?.capabilities.updateBrokerPlacement ? (
            <SourceBrokerPlacementEditor
                key={openRow.id}
                scope={props.scope}
                row={openRow}
                pending={pendingId === openRow.id || approval.approvalPending}
                onSave={(brokerPlacement, expectedRevision) => update(openRow, { brokerPlacement }, expectedRevision)}
            />
        ) : null}
        </>
    );
});

export const SharedWithTeamsForSource = React.memo(function SharedWithTeamsForSource(props: Readonly<{
    serverId: string;
    source: TeamCredentialSourceLocatorV1;
}>) {
    const resolution = useServerCredentialAccountScopeResolution(props.serverId);
    return resolution.kind === 'bound'
        ? <SharedWithTeamsSourceAdministration scope={resolution.scope} source={props.source} />
        : null;
});
