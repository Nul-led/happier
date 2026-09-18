import * as React from 'react';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SearchHeader } from '@/components/ui/forms/SearchHeader';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { useTeamGroups } from '@/hooks/teams/useTeamGroups';
import { useTeamPagedList } from '@/hooks/teams/useTeamPagedList';
import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { getPreferredLanguage, t } from '@/text';
import { Modal } from '@/modal';
import { formatWithCachedDateTimeFormatter } from '@/utils/datetime/cachedIntlFormatters';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';

import { TeamSection } from '../TeamSection';
import { teamMemberDetailPath } from '../teamsRoutes';
import { useDirectoryPeopleList } from './DirectoryPeopleList';
import { directorySourceStateLabel } from './DirectorySyncSettingsScreen';
import { directorySourcePresentationState } from './directoryAdministrationPresentation';
import { runDirectoryGroupMappingChange } from './directoryGroupMapping';
import { runDirectorySourceRemoval } from './directorySourceRemoval';
import {
    createIdentityAdministrationClient,
    type TeamIdentityActionOutput,
} from './identityAdministrationClient';
import { useDirectorySourceAdministration } from './useDirectoryAdministration';
import { buildVirtualizedSegments } from './directorySourceDetailVirtualization';
import { createWorkosPortalReturnController } from './workosPortalReturn';

type DirectoryDetailVirtualRow = Readonly<{
    key: string;
    element: React.ReactElement;
}>;

const DIRECTORY_DETAIL_SEGMENT_SIZE = 12;

function formatTimestamp(value: string | null): string {
    if (value === null) return t('teams.authentication.directory.never');
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) return t('teams.authentication.directory.unknown');
    return formatWithCachedDateTimeFormatter(timestamp, getPreferredLanguage(), {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

const DirectoryGroupMappings = React.memo(function DirectoryGroupMappings(props: Readonly<{
    scope: Parameters<typeof createIdentityAdministrationClient>[0];
    address: TeamAddress;
    sourceId: string;
    groupMappingsAvailable: boolean;
    mutationsAvailable: boolean;
    requestApproval: (registration: ActionApprovalRegistration) => void;
    beforeRows: readonly DirectoryDetailVirtualRow[];
    header: React.ReactElement;
}>) {
    const [query, setQuery] = React.useState('');
    const [choosingFor, setChoosingFor] = React.useState<string | null>(null);
    const [pendingGroupId, setPendingGroupId] = React.useState<string | null>(null);
    const [failure, setFailure] = React.useState<string | null>(null);

    // Announced as well as shown: the outcome renders far below the control.
    const reportMappingFailure = React.useCallback((code: string) => {
        const message = identityAdministrationFailureMessage(code);
        setFailure(message);
        announceAccessibilityMessage(message);
    }, []);
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope, {
            onApprovalPending: props.requestApproval,
        }),
        [props.requestApproval, props.scope.accountId, props.scope.serverId],
    );
    const loadPage = React.useCallback(async (cursor: string | null) => {
        const result = await client.executeDirectory('teams.directory.groups.list', {
            v: 1,
            teamId: props.address.teamId,
            sourceId: props.sourceId,
            limit: 50,
            cursor,
            ...(query.trim() ? { query: query.trim() } : {}),
        });
        return result.ok
            ? { kind: 'succeeded' as const, value: result.value }
            : { kind: 'failed' as const, failure: { kind: 'unknown' as const, retryable: result.failure.retryable, code: null } };
    }, [client, props.address.teamId, props.sourceId, query]);
    const directoryGroups = useTeamPagedList({
        key: `${props.scope.serverId} ${props.scope.accountId} ${props.address.teamId} ${props.sourceId} ${query.trim()}`,
        enabled: props.groupMappingsAvailable,
        loadPage,
    });
    const nativeGroups = useTeamGroups({
        scope: props.scope,
        address: props.address,
        archived: 'active',
        enabled: props.groupMappingsAvailable,
    });
    const nativeGroupNames = React.useMemo(
        () => new Map(nativeGroups.rows.map((group) => [group.id, group.name] as const)),
        [nativeGroups.rows],
    );

    const changeMapping = React.useCallback(async (
        group: (typeof directoryGroups.rows)[number],
        target: Parameters<typeof runDirectoryGroupMappingChange>[0]['target'],
    ) => {
        // The directory Group's own name never said where its members were
        // about to land. Name the Team Group this mapping resolves to and the
        // people it moves, both already on the rows behind this confirmation.
        const teamGroupName = (teamGroupId: string) =>
            nativeGroupNames.get(teamGroupId) ?? t('teams.authentication.directory.unknown');
        const mappedTo = (name: string) => `${t('identityAdministration.mappedTo')}: ${name}`;
        const destination = target === null
            ? (group.mapping.state === 'bound' ? mappedTo(teamGroupName(group.mapping.teamGroupId)) : null)
            : target.kind === 'native_target'
                ? mappedTo(teamGroupName(target.teamGroupId))
                : t('identityAdministration.mapCreate');
        const confirmed = await Modal.confirm(
            target === null ? t('identityAdministration.removeMapping') : t('identityAdministration.chooseGroup'),
            [
                group.displayName,
                destination,
                group.memberCount === null ? null : t('teams.groups.memberCount', { count: group.memberCount }),
            ].filter((line): line is string => line !== null).join('\n'),
            {
                cancelText: t('common.cancel'),
                confirmText: target === null ? t('identityAdministration.removeMapping') : t('common.continue'),
                ...(target === null ? { destructive: true } : {}),
            },
        );
        if (!confirmed) return;
        setPendingGroupId(group.id);
        setFailure(null);
        const finishMapping = async () => {
            setChoosingFor(null);
            await directoryGroups.reload();
        };
        try {
            const result = await runDirectoryGroupMappingChange({
                sourceId: props.sourceId,
                group,
                target,
                execute: async (command) => {
                    const outcome = command.kind === 'set'
                        ? await client.executeExternalGroupBinding('teams.externalGroupBindings.set', {
                            v: 1,
                            teamId: props.address.teamId,
                            owner: { kind: 'directory_source', directorySourceId: props.sourceId },
                            externalGroupId: command.externalGroupId,
                            target: command.target,
                        }, {
                            onApprovalSucceeded: finishMapping,
                            onApprovalFailed: reportMappingFailure,
                        })
                        : await client.executeExternalGroupBinding('teams.externalGroupBindings.remove', {
                            v: 1,
                            teamId: props.address.teamId,
                            bindingId: command.bindingId,
                        }, {
                            onApprovalSucceeded: finishMapping,
                            onApprovalFailed: reportMappingFailure,
                        });
                    if (outcome.ok) return { ok: true };
                    return 'approvalPending' in outcome
                        ? { ok: false, approvalPending: true, code: outcome.failure.code }
                        : { ok: false, code: outcome.failure.code };
                },
            });
            if (!result.ok) {
                if (!result.approvalPending) reportMappingFailure(result.code);
            } else await finishMapping();
        } finally {
            setPendingGroupId(null);
        }
    }, [client, directoryGroups, nativeGroupNames, props.address.teamId, props.sourceId, reportMappingFailure]);

    const selectedGroup = choosingFor === null
        ? null
        : directoryGroups.rows.find((group) => group.id === choosingFor) ?? null;

    const rows = React.useMemo(() => {
        const result: DirectoryDetailVirtualRow[] = [...props.beforeRows];
        if (!props.groupMappingsAvailable) return result;
        result.push({
            key: 'groups-search',
            element: <SearchHeader testID="directory-groups-search" value={query} onChangeText={setQuery} placeholder={t('identityAdministration.searchGroups')} />,
        });
        const segments = buildVirtualizedSegments(directoryGroups.rows, DIRECTORY_DETAIL_SEGMENT_SIZE);
        if (directoryGroups.status === 'loading' && directoryGroups.rows.length === 0) {
            result.push({ key: 'groups-loading', element: <ItemGroup title={t('identityAdministration.directoryGroups')}><Item title={t('common.loading')} loading showChevron={false} /></ItemGroup> });
        } else if (directoryGroups.rows.length === 0) {
            result.push({ key: 'groups-empty', element: <ItemGroup title={t('identityAdministration.directoryGroups')}><Item title={t('teams.authentication.directory.empty')} showChevron={false} /></ItemGroup> });
        } else {
            segments.forEach((segment, index) => result.push({
                key: `groups:${index}`,
                element: (
                    <ItemGroup title={segment.first ? t('identityAdministration.directoryGroups') : undefined} virtualizedSegment={{ first: segment.first, last: segment.last }}>
                        {segment.items.map((group) => (
                            <Item
                                key={group.id}
                                testID={`directory-group:${group.id}`}
                                title={group.displayName}
                                subtitle={group.mapping.state === 'bound'
                                    ? `${t('identityAdministration.mappedTo')}: ${nativeGroupNames.get(group.mapping.teamGroupId) ?? t('teams.authentication.directory.unknown')}`
                                    : t('identityAdministration.unmapped')}
                                detail={group.memberCount === null ? undefined : t('teams.groups.memberCount', { count: group.memberCount })}
                                loading={pendingGroupId === group.id}
                                disabled={pendingGroupId !== null || !props.mutationsAvailable}
                                onPress={() => setChoosingFor((current) => current === group.id ? null : group.id)}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>
                ),
            }));
        }
        if (directoryGroups.error) result.push({ key: 'groups-error', element: <ItemGroup footer={directoryGroups.error.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>{directoryGroups.error.retryable ? <Item testID="directory-groups-retry" title={t('common.retry')} onPress={() => void directoryGroups.reload()} showChevron={false} /> : null}</ItemGroup> });
        if (directoryGroups.hasMore) result.push({ key: 'groups-more', element: <ItemGroup><Item testID="directory-groups-load-more" title={t('identityAdministration.loadMore')} loading={directoryGroups.status === 'loading_more'} disabled={directoryGroups.status === 'loading_more'} onPress={() => void directoryGroups.loadMore()} showChevron={false} /></ItemGroup> });
        if (selectedGroup) result.push({
            key: `groups-choice:${selectedGroup.id}`,
            element: <ItemGroup title={t('identityAdministration.chooseGroup')}>
                <Item testID="directory-group-map-create" title={t('identityAdministration.mapCreate')} disabled={pendingGroupId !== null || !props.mutationsAvailable} onPress={() => void changeMapping(selectedGroup, { kind: 'directory_created' })} showChevron={false} />
                <Item testID="directory-group-map-existing" title={t('identityAdministration.mapExisting')} selected disabled={!props.mutationsAvailable} onPress={() => setChoosingFor(null)} showChevron={false} />
                {nativeGroups.rows.map((group) => <Item key={group.id} testID={`directory-group-native-target:${group.id}`} title={group.name} subtitle={t('teams.groups.memberCount', { count: group.memberCount })} disabled={pendingGroupId !== null || !props.mutationsAvailable} onPress={() => void changeMapping(selectedGroup, { kind: 'native_target', teamGroupId: group.id })} showChevron={false} />)}
                {nativeGroups.hasMore ? <Item title={t('identityAdministration.loadMore')} loading={nativeGroups.status === 'loading_more'} disabled={nativeGroups.status === 'loading_more'} onPress={() => void nativeGroups.loadMore()} showChevron={false} /> : null}
                {selectedGroup.mapping.state === 'bound' ? <Item testID="directory-group-remove-mapping" title={t('identityAdministration.removeMapping')} destructive disabled={pendingGroupId !== null || !props.mutationsAvailable} onPress={() => void changeMapping(selectedGroup, null)} showChevron={false} /> : null}
            </ItemGroup>,
        });
        if (failure) result.push({ key: 'groups-failure', element: <ItemGroup><Item testID="directory-group-mapping-failure" title={failure} showChevron={false} /></ItemGroup> });
        return result;
    }, [changeMapping, directoryGroups.error, directoryGroups.hasMore, directoryGroups.loadMore, directoryGroups.reload, directoryGroups.rows, directoryGroups.status, failure, nativeGroupNames, nativeGroups.hasMore, nativeGroups.loadMore, nativeGroups.rows, pendingGroupId, props.beforeRows, props.groupMappingsAvailable, props.mutationsAvailable, query, selectedGroup]);

    const renderRow = React.useCallback(({ item }: Readonly<{ item: DirectoryDetailVirtualRow }>) => item.element, []);

    return <VirtualizedList
        testID="directory-source-detail-virtualized-list"
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        ListHeaderComponent={props.header}
        style={{ flex: 1 }}
        backendPreference="auto"
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        estimatedItemSize={180}
        maintainVisibleContentPosition
    />;
});

const AuthorizedDirectorySourceDetail = React.memo(function AuthorizedDirectorySourceDetail(props: Readonly<{
    scope: Parameters<typeof useDirectorySourceAdministration>[0];
    address: NonNullable<Parameters<typeof useTeamGroups>[0]['address']>;
    teamId: string;
    sourceId: string;
    groupMappingsAvailable: boolean;
    mutationsAvailable: boolean;
    requestApproval: (registration: ActionApprovalRegistration) => void;
    shellHeader?: React.ReactNode;
}>) {
    const router = useRouter();
    const { state, refresh, pendingAction, runAction, readRemovalImpact, removeSource } = useDirectorySourceAdministration(
        props.scope,
        props.teamId,
        props.sourceId,
        props.requestApproval,
    );
    const [actionFailure, setActionFailure] = React.useState<string | null>(null);
    const [workosPortalPending, setWorkosPortalPending] = React.useState(false);
    const portalReturnController = React.useRef(createWorkosPortalReturnController()).current;
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope, {
            onApprovalPending: props.requestApproval,
        }),
        [props.requestApproval, props.scope.accountId, props.scope.serverId],
    );

    // Announced as well as shown: the outcome renders far below the control.
    const reportActionFailure = React.useCallback((code: string) => {
        const message = identityAdministrationFailureMessage(code);
        setActionFailure(message);
        announceAccessibilityMessage(message);
    }, []);

    const source = state.kind === 'ready' ? state.item : null;
    React.useEffect(() => {
        const refreshOnReturn = () => {
            if (portalReturnController.consumeReturn()) refresh();
        };
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') refreshOnReturn();
        });
        const webWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window;
        webWindow?.addEventListener?.('focus', refreshOnReturn);
        return () => {
            subscription.remove();
            webWindow?.removeEventListener?.('focus', refreshOnReturn);
        };
    }, [portalReturnController, refresh]);
    const people = useDirectoryPeopleList({
        scope: props.scope,
        address: props.address,
        sourceId: props.sourceId,
        enabled: source !== null,
    });
    const can = React.useCallback((actionId: Parameters<typeof runAction>[0]) => (
        source?.allowedActions.includes(actionId) ?? false
    ), [source]);
    const run = React.useCallback(async (actionId: Parameters<typeof runAction>[0]) => {
        setActionFailure(null);
        const result = await runAction(actionId, { onApprovalFailed: reportActionFailure });
        if (!result.ok && !('approvalPending' in result)) reportActionFailure(result.failure.code);
        return result.ok;
    }, [reportActionFailure, runAction]);
    const pause = React.useCallback(async () => {
        if (!source) return;
        if (!await Modal.confirm(
            t('teams.authentication.directory.actions.pauseTitle', { source: source.displayName }),
            t('teams.authentication.directory.actions.pauseBody'),
            { cancelText: t('common.cancel'), confirmText: t('teams.authentication.directory.actions.pause') },
        )) return;
        await run('teams.directory.sources.pause');
    }, [run, source]);
    const openWorkosSetup = React.useCallback(async () => {
        const connectionId = source?.workosAdminPortalConnectionId;
        if (!connectionId || source.kind !== 'workos_directory' || !props.mutationsAvailable) return;
        if (!await Modal.confirm(
            t('identityAdministration.workosSetupDirectory'),
            t('teams.authentication.subtitle'),
            { cancelText: t('common.cancel'), confirmText: t('common.continue') },
        )) return;
        setWorkosPortalPending(true);
        setActionFailure(null);
        try {
            const continuePortal = async (
                value: TeamIdentityActionOutput<'teams.identity.workos.adminPortalLink.create'>,
            ) => {
                let isHttps = false;
                try {
                    isHttps = new URL(value.url).protocol === 'https:';
                } catch {
                    // Invalid external links fail closed below.
                }
                if (!isHttps || !await openExternalUrl(value.url)) {
                    reportActionFailure('workos_portal_open_failed');
                    return;
                }
                portalReturnController.markOpened();
            };
            const result = await client.execute(
                'teams.identity.workos.adminPortalLink.create',
                {
                    v: 1,
                    teamId: props.teamId,
                    connectionId,
                    directorySourceId: source.id,
                    intent: 'dsync',
                },
                { onApprovalSucceeded: continuePortal, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
                return;
            }
            await continuePortal(result.value);
        } finally {
            setWorkosPortalPending(false);
        }
    }, [client, portalReturnController, props.mutationsAvailable, props.teamId, reportActionFailure, source]);
    const remove = React.useCallback(async () => {
        if (!source) return;
        setActionFailure(null);
        const outcome = await runDirectorySourceRemoval({
            sourceId: source.id,
            readImpact: readRemovalImpact,
            confirm: async (preflight) => await Modal.confirm(
                t('teams.authentication.directory.actions.removeTitle', { source: preflight.sourceLabel }),
                t('teams.authentication.directory.actions.removeBody', preflight.impact),
                {
                    cancelText: t('common.cancel'),
                    confirmText: t('teams.authentication.directory.actions.remove'),
                    destructive: true,
                },
            ),
            remove: removeSource,
            onApprovalSucceeded: async () => router.back(),
            onApprovalFailed: reportActionFailure,
        });
        if (outcome.kind === 'failed') {
            reportActionFailure(outcome.code);
        } else if (outcome.kind === 'removed') {
            router.back();
        }
    }, [readRemovalImpact, removeSource, reportActionFailure, router, source]);

    if (state.kind === 'loading') {
        return <DirectoryGroupMappings
            scope={props.scope}
            address={props.address}
            sourceId={props.sourceId}
            groupMappingsAvailable={false}
            mutationsAvailable={false}
            requestApproval={props.requestApproval}
            beforeRows={[{
                key: 'source-loading',
                element: <ItemGroup><Item title={t('common.loading')} leftElement={<ActivitySpinner />} showChevron={false} /></ItemGroup>,
            }]}
            header={<>{props.shellHeader}</>}
        />;
    }
    if (state.kind === 'unavailable') {
        return <DirectoryGroupMappings
            scope={props.scope}
            address={props.address}
            sourceId={props.sourceId}
            groupMappingsAvailable={false}
            mutationsAvailable={false}
            requestApproval={props.requestApproval}
            beforeRows={[{
                key: 'source-unavailable',
                element: (
                    <ItemGroup>
                        <Item
                            testID="team-directory-source-unavailable"
                            title={identityAdministrationFailureMessage(state.failure.code)}
                            detail={state.failure.retryable ? t('common.retry') : undefined}
                            onPress={state.failure.retryable ? refresh : undefined}
                            showChevron={false}
                        />
                    </ItemGroup>
                ),
            }]}
            header={<>{props.shellHeader}</>}
        />;
    }
    if (!source) {
        return <DirectoryGroupMappings
            scope={props.scope}
            address={props.address}
            sourceId={props.sourceId}
            groupMappingsAvailable={false}
            mutationsAvailable={false}
            requestApproval={props.requestApproval}
            beforeRows={[{
                key: 'source-not-found',
                element: <ItemGroup><Item title={t('teams.errors.notFound')} showChevron={false} /></ItemGroup>,
            }]}
            header={<>{props.shellHeader}</>}
        />;
    }
    const projectionCurrent = !state.refreshing && !state.stale;
    const beforeRows: DirectoryDetailVirtualRow[] = [];
    const peopleSegments = buildVirtualizedSegments(people.rows, DIRECTORY_DETAIL_SEGMENT_SIZE);
    if (people.status === 'loading' && people.rows.length === 0) {
        beforeRows.push({ key: 'people-loading', element: <ItemGroup title={t('teams.authentication.directory.people.section')}><Item title={t('common.loading')} loading showChevron={false} /></ItemGroup> });
    } else if (people.rows.length === 0) {
        beforeRows.push({ key: 'people-empty', element: <ItemGroup title={t('teams.authentication.directory.people.section')}><Item title={t('teams.authentication.directory.people.empty')} showChevron={false} /></ItemGroup> });
    } else {
        peopleSegments.forEach((segment, index) => beforeRows.push({
            key: `people:${index}`,
            element: <ItemGroup title={segment.first ? t('teams.authentication.directory.people.section') : undefined} virtualizedSegment={{ first: segment.first, last: segment.last }}>
                {segment.items.map((person) => {
                    const membershipId = person.accountBinding.state === 'bound' ? person.accountBinding.teamMembershipId : null;
                    const stateLabel = person.state === 'active' ? null : t(`teams.authentication.directory.people.state.${person.state}`);
                    const identityLabel = person.email ?? person.externalLogin;
                    return <Item
                        key={person.id}
                        testID={`directory-person:${person.id}`}
                        title={person.displayName ?? identityLabel ?? t('teams.authentication.directory.people.unknown')}
                        subtitle={[identityLabel, stateLabel].filter((value): value is string => value !== null).join(' · ') || undefined}
                        detail={person.accountBinding.state === 'unbound' ? t('teams.authentication.directory.people.provisioned') : t('teams.authentication.directory.people.member')}
                        onPress={membershipId === null ? undefined : () => router.push(teamMemberDetailPath(props.address, membershipId))}
                        showChevron={membershipId !== null}
                    />;
                })}
            </ItemGroup>,
        }));
    }
    if (people.error) beforeRows.push({ key: 'people-error', element: <ItemGroup footer={people.error.retryable ? t('teams.unavailable.offline') : t('identityAdministration.error')}>{people.error.retryable ? <Item testID="directory-people-retry" title={t('common.retry')} onPress={() => void people.reload()} showChevron={false} /> : null}</ItemGroup> });
    if (people.hasMore) beforeRows.push({ key: 'people-more', element: <ItemGroup><Item testID="directory-people-load-more" title={t('teams.authentication.directory.people.loadMore')} loading={people.status === 'loading_more'} disabled={people.status === 'loading_more'} onPress={() => void people.loadMore()} showChevron={false} /></ItemGroup> });
    const header = (
        <>
            {props.shellHeader}
            {state.stale ? (
                <ItemGroup footer={t('teams.stale.label')}>
                    <Item title={t('teams.unavailable.offline')} detail={t('common.retry')} onPress={refresh} showChevron={false} />
                </ItemGroup>
            ) : null}
            <ItemGroup title={source.displayName}>
                <Item
                    testID="team-directory-source-status"
                    title={t('teams.authentication.directory.detail.status')}
                    detail={directorySourceStateLabel(directorySourcePresentationState(source))}
                    showChevron={false}
                />
                <Item
                    title={t('teams.authentication.directory.detail.sourceType')}
                    detail={source.kind === 'workos_directory'
                        ? t('teams.authentication.directory.kind.workos')
                        : t('teams.authentication.directory.kind.github')}
                    showChevron={false}
                />
            </ItemGroup>
            <ItemGroup title={t('teams.authentication.directory.detail.syncSection')}>
                <Item
                    title={t('teams.authentication.directory.detail.mode')}
                    detail={source.sync.mode === 'events_and_full'
                        ? t('teams.authentication.directory.mode.eventsAndFull')
                        : t('teams.authentication.directory.mode.fullOnly')}
                    showChevron={false}
                />
                <Item
                    title={t('teams.authentication.directory.detail.freshness')}
                    detail={t(`teams.authentication.directory.freshness.${source.sync.freshness}`)}
                    showChevron={false}
                />
                <Item
                    title={t('teams.authentication.directory.detail.lastSuccess')}
                    detail={formatTimestamp(source.sync.lastSuccessAt)}
                    showChevron={false}
                />
                {source.sync.nextScheduledAt ? (
                    <Item
                        title={t('teams.authentication.directory.detail.nextScheduled')}
                        detail={formatTimestamp(source.sync.nextScheduledAt)}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
            {source.error ? (
                <ItemGroup title={t('teams.authentication.directory.detail.attentionSection')}>
                    <Item
                        testID="team-directory-source-error"
                        title={identityAdministrationFailureMessage(source.error.code)}
                        subtitle={source.error.retryable
                            ? t('teams.authentication.directory.detail.attentionRetryable')
                            : t('teams.authentication.directory.detail.attentionAdmin')}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            {actionFailure ? (
                <ItemGroup>
                    <Item
                        testID="team-directory-source-action-error"
                        title={actionFailure}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            <ItemGroup title={t('teams.authentication.directory.actions.section')}>
                {source.kind === 'workos_directory' && source.workosAdminPortalConnectionId ? (
                    <Item
                        testID="team-directory-source-open-workos"
                        title={t('identityAdministration.workosCheckSetup')}
                        disabled={!projectionCurrent || pendingAction !== null || workosPortalPending || !props.mutationsAvailable}
                        loading={workosPortalPending}
                        onPress={() => void openWorkosSetup()}
                        showChevron={false}
                    />
                ) : null}
                {can('teams.directory.sources.sync') ? (
                    <Item
                        testID="team-directory-source-sync"
                        title={t('teams.authentication.directory.actions.sync')}
                        disabled={!projectionCurrent || pendingAction !== null || !props.mutationsAvailable}
                        detail={pendingAction === 'teams.directory.sources.sync' ? t('common.loading') : undefined}
                        onPress={() => void run('teams.directory.sources.sync')}
                        showChevron={false}
                    />
                ) : null}
                {can('teams.directory.sources.pause') ? (
                    <Item
                        testID="team-directory-source-pause"
                        title={t('teams.authentication.directory.actions.pause')}
                        disabled={!projectionCurrent || pendingAction !== null || !props.mutationsAvailable}
                        onPress={() => void pause()}
                        showChevron={false}
                    />
                ) : null}
                {can('teams.directory.sources.resume') ? (
                    <Item
                        testID="team-directory-source-resume"
                        title={t('teams.authentication.directory.actions.resume')}
                        disabled={!projectionCurrent || pendingAction !== null || !props.mutationsAvailable}
                        onPress={() => void run('teams.directory.sources.resume')}
                        showChevron={false}
                    />
                ) : null}
                {can('teams.directory.sources.remove') ? (
                    <Item
                        testID="team-directory-source-remove"
                        title={t('teams.authentication.directory.actions.remove')}
                        destructive
                        disabled={!projectionCurrent || pendingAction !== null || !props.mutationsAvailable}
                        onPress={() => void remove()}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        </>
    );
    return <DirectoryGroupMappings
        scope={props.scope}
        address={props.address}
        sourceId={source.id}
        groupMappingsAvailable={props.groupMappingsAvailable}
        mutationsAvailable={props.mutationsAvailable && projectionCurrent}
        requestApproval={props.requestApproval}
        beforeRows={beforeRows}
        header={header}
    />;
});

export const DirectorySourceDetailScreen = React.memo(function DirectorySourceDetailScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    sourceId: string;
}>) {
    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('teams.authentication.directory.title')} presentation="virtualized-list">
            {({ team, scope, address, canMutate, requestApproval }, shellHeader) => team.capabilities.manageAuthentication ? (
                <AuthorizedDirectorySourceDetail
                    scope={scope}
                    address={address}
                    teamId={team.id}
                    sourceId={props.sourceId}
                    groupMappingsAvailable={team.capabilities.manageGroups}
                    mutationsAvailable={canMutate}
                    requestApproval={requestApproval}
                    shellHeader={shellHeader}
                />
            ) : <>
                {shellHeader}
                <ItemGroup><Item testID="team-directory-source-forbidden" title={t('teams.errors.forbidden')} showChevron={false} /></ItemGroup>
            </>}
        </TeamSection>
    );
});
