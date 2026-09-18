import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { ToolbarButton } from '@/components/ui/buttons/ToolbarButton';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import {
    SelectionList,
    type SelectionListPagination,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import { useTeamGroups } from '@/hooks/teams/useTeamGroups';
import { useTeamsDirectory } from '@/hooks/teams/useTeamsDirectory';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';
import { getTeamGroupsSnapshot } from '@/sync/store/teams/teamsSnapshots';
import { teamGroupsQueryKeyV1 } from '@happier-dev/protocol/teams';

import {
    buildSessionListFilterEditorModel,
    readSessionListAudienceTeamStepAddress,
    resolveSessionListFilterEditorSelectionChange,
    type SessionListFilterAudienceOption,
    type SessionListFilterEditorLabels,
    type SessionListFilterHomeOption,
    type SessionListFilterTagOption,
} from './sessionListFilterEditorModel';
import {
    buildQualifiedAudienceSelectionKey,
    type SessionListFilterDeletedSelections,
    type SessionListViewContext,
    type SessionListViewFilters,
} from './sessionListViewFilters';
/*
 * Audience identity belongs to the filter state owner. This component consumes its
 * qualified JSON key rather than maintaining a parallel Team-only syntax.
 */
function teamAudienceIdentity(serverId: string, teamId: string): string {
    return buildQualifiedAudienceSelectionKey({ serverId, kind: 'team', teamId });
}

export type SessionListFilterEditorCopy = SessionListFilterEditorLabels & Readonly<{
    title: string;
    clear: string;
    done: string;
    catalogLoading?: string;
    catalogMore?: string;
    catalogRetry?: string;
    catalogError?: string;
    catalogPartial?: string;
    catalogEnd?: string;
}>;

export type SessionListFilterEditorProps = Readonly<{
    filters: SessionListViewFilters;
    includeInactive: boolean;
    inactiveVisibilityAvailable?: boolean;
    queryEnabled: boolean;
    followingAvailable: boolean;
    sourceAvailable: boolean;
    homes: readonly SessionListFilterHomeOption[];
    audiences: readonly SessionListFilterAudienceOption[];
    tags: readonly SessionListFilterTagOption[];
    /** Enables the canonical Teams directory and lazy per-Team Group producer. */
    teamAudienceContext?: SessionListViewContext;
    labels: SessionListFilterEditorCopy;
    fixedHomeServerIds?: ReadonlySet<string>;
    fixedAudienceKeys?: ReadonlySet<string>;
    updateFilters(filters: SessionListViewFilters): void;
    removeAuthoritativelyDeletedSelections(deleted: SessionListFilterDeletedSelections): void;
    setIncludeInactive(includeInactive: boolean): void;
    /** Source is a persisted device preference, so it is written through its own owner. */
    setSource(source: SessionListViewFilters['source']): void;
    resetFilters(): void;
    onDone?: () => void;
    maxHeight?: number;
    disableTransitions?: boolean;
}>;

const MINIMUM_INTERACTIVE_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        minWidth: 280,
        maxWidth: 420,
        flexShrink: 1,
    },
    footer: {
        minHeight: 52,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.subtle,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    footerButton: {
        minHeight: MINIMUM_INTERACTIVE_TARGET_SIZE,
    },
}));

export const SessionListFilterEditor = React.memo(function SessionListFilterEditor(
    props: SessionListFilterEditorProps,
) {
    const styles = stylesheet;
    const audienceServerIds = React.useMemo(
        () => props.homes.map((home) => home.serverId),
        [props.homes],
    );
    const teamAudienceEnabled = props.queryEnabled && props.teamAudienceContext !== undefined;
    const directory = useTeamsDirectory({
        enabled: teamAudienceEnabled,
        serverIds: audienceServerIds,
        scope: 'member',
        archived: 'active',
    });
    const audienceContextKey = props.teamAudienceContext?.kind === 'team'
        ? `team:${props.teamAudienceContext.team.serverId}:${props.teamAudienceContext.team.teamId}`
        : props.teamAudienceContext?.kind ?? 'none';
    const [drilledTeamState, setDrilledTeamState] = React.useState<Readonly<{
        contextKey: string;
        address: TeamAddress;
    }> | null>(null);
    const drilledTeam = drilledTeamState?.contextKey === audienceContextKey
        ? drilledTeamState.address
        : null;
    const selectedGroupTeam = React.useMemo<TeamAddress | null>(() => {
        const selected = props.filters.audiences.find((audience) => (
            audience.kind === 'group' && audienceServerIds.includes(audience.serverId)
        ));
        return selected?.kind === 'group'
            ? { serverId: selected.serverId, teamId: selected.teamId }
            : null;
    }, [audienceServerIds, props.filters.audiences]);
    const activeTeam = React.useMemo<TeamAddress | null>(() => {
        const context = props.teamAudienceContext;
        if (!context) return null;
        if (context.kind === 'team') return context.team;
        if (drilledTeam && audienceServerIds.includes(drilledTeam.serverId)) return drilledTeam;
        // A retained Group filter still needs its canonical Group catalog checked
        // even before the editor drills into that Team. This reuses the editor's
        // one incumbent Group observer and does not create another filter-lifetime
        // subscription or catalog.
        return selectedGroupTeam;
    }, [audienceServerIds, drilledTeam, props.teamAudienceContext, selectedGroupTeam]);
    const activeTeamScope = activeTeam
        ? directory.scopes.find((scope) => scope.serverId === activeTeam.serverId) ?? null
        : null;
    const groups = useTeamGroups({
        scope: activeTeamScope,
        address: activeTeam,
        archived: 'active',
        enabled: teamAudienceEnabled && activeTeam !== null,
    });
    const directoryComplete = teamAudienceEnabled
        && directory.kind !== 'loading'
        && !directory.partial
        && !directory.hasMore;
    const activeGroupsComplete = teamAudienceEnabled
        && activeTeam !== null
        && groups.status === 'ready'
        && groups.isCurrent
        && !groups.hasMore;

    const audiences = React.useMemo<readonly SessionListFilterAudienceOption[]>(() => {
        const context = props.teamAudienceContext;
        if (!context) return props.audiences;

        const homeLabels = new Map(props.homes.map((home) => [home.serverId, home.label]));
        const qualifyTeamLabel = (name: string, serverId: string) => props.homes.length <= 1
            ? name
            : `${name} · ${homeLabels.get(serverId) ?? serverId}`;
        const options: SessionListFilterAudienceOption[] = [...props.audiences];
        const rows = context.kind === 'team'
            ? directory.rows.filter((row) => (
                row.address.serverId === context.team.serverId
                && row.address.teamId === context.team.teamId
            ))
            : directory.rows;
        for (const row of rows) {
            options.push({
                serverId: row.address.serverId,
                kind: 'team',
                teamId: row.address.teamId,
                label: qualifyTeamLabel(row.team.name, row.address.serverId),
            });
        }
        const representedTeams = new Set(options.flatMap((option) => option.kind === 'team'
            ? [teamAudienceIdentity(option.serverId, option.teamId)]
            : []));
        if (context.kind === 'global' && !directoryComplete) {
            // These rows reify retained filter IDs only. They never claim to be
            // directory results and disappear once the current directory can
            // authoritatively prove that the Team no longer exists.
            for (const selected of props.filters.audiences) {
                if (selected.kind === 'outside_teams' || !audienceServerIds.includes(selected.serverId)) continue;
                const key = teamAudienceIdentity(selected.serverId, selected.teamId);
                if (representedTeams.has(key)) continue;
                representedTeams.add(key);
                options.push({
                    serverId: selected.serverId,
                    kind: 'team',
                    teamId: selected.teamId,
                    label: qualifyTeamLabel(selected.teamId, selected.serverId),
                });
            }
        }
        if (context.kind === 'team' && rows.length === 0) {
            options.push({
                serverId: context.team.serverId,
                kind: 'team',
                teamId: context.team.teamId,
                label: context.team.teamId,
            });
        }
        if (activeTeam) {
            for (const group of groups.rows) {
                options.push({
                    serverId: activeTeam.serverId,
                    kind: 'group',
                    teamId: activeTeam.teamId,
                    groupId: group.id,
                    label: group.name,
                });
            }
            if (!activeGroupsComplete) {
                const representedGroups = new Set(groups.rows.map((group) => group.id));
                for (const selected of props.filters.audiences) {
                    if (selected.kind !== 'group'
                        || selected.serverId !== activeTeam.serverId
                        || selected.teamId !== activeTeam.teamId
                        || representedGroups.has(selected.groupId)) continue;
                    representedGroups.add(selected.groupId);
                    options.push({
                        serverId: activeTeam.serverId,
                        kind: 'group',
                        teamId: activeTeam.teamId,
                        groupId: selected.groupId,
                        label: selected.groupId,
                    });
                }
            }
        }
        return options;
    }, [
        activeGroupsComplete,
        activeTeam,
        audienceServerIds,
        directory.rows,
        directoryComplete,
        groups.rows,
        props.audiences,
        props.filters.audiences,
        props.homes,
        props.teamAudienceContext,
    ]);

    // A complete current owner answer is the only evidence that can remove a
    // retained ID. Partial, stale, offline and still-paginating reads keep the
    // selection intact, matching the filter-state lifetime contract.
    React.useEffect(() => {
        const context = props.teamAudienceContext;
        if (!context) return;
        const currentTeams = directoryComplete
            ? new Set(directory.rows.map((row) => teamAudienceIdentity(row.address.serverId, row.address.teamId)))
            : null;
        const currentGroups = activeGroupsComplete && activeTeam
            ? new Set(groups.rows.map((group) => group.id))
            : null;
        const deletedAudiences = props.filters.audiences.filter((audience) => {
            if (audience.kind === 'outside_teams') return false;
            if (currentTeams && context.kind === 'global'
                && !currentTeams.has(teamAudienceIdentity(audience.serverId, audience.teamId))) return true;
            if (audience.kind === 'group') {
                const address = { serverId: audience.serverId, teamId: audience.teamId };
                const scope = directory.scopes.find((candidate) => candidate.serverId === audience.serverId) ?? null;
                const snapshot = getTeamGroupsSnapshot(
                    scope,
                    address,
                    teamGroupsQueryKeyV1({ v: 1, teamId: audience.teamId, archived: 'active' }),
                );
                if (
                    snapshot?.status === 'ready'
                    && !snapshot.stale
                    && snapshot.nextCursor === null
                    && snapshot.data !== null
                    && !snapshot.data.some((group) => group.id === audience.groupId)
                ) return true;
            }
            return audience.kind === 'group' && currentGroups !== null && activeTeam !== null
                && audience.serverId === activeTeam.serverId
                && audience.teamId === activeTeam.teamId
                && !currentGroups.has(audience.groupId);
        });
        if (deletedAudiences.length > 0) {
            props.removeAuthoritativelyDeletedSelections({ deletedAudiences });
        }
    }, [
        activeGroupsComplete,
        activeTeam,
        directory.rows,
        directory.scopes,
        directoryComplete,
        groups.rows,
        props.filters,
        props.removeAuthoritativelyDeletedSelections,
        props.teamAudienceContext,
    ]);
    const model = React.useMemo(() => buildSessionListFilterEditorModel({
        filters: props.filters,
        includeInactive: props.includeInactive,
        inactiveVisibilityAvailable: props.inactiveVisibilityAvailable,
        attentionAvailable: props.queryEnabled,
        labels: props.labels,
        scopesAvailable: {
            my_work: props.queryEnabled,
            assigned_to_me: props.queryEnabled,
            following: props.queryEnabled && props.followingAvailable,
            involving_me: props.queryEnabled,
            all_accessible: props.queryEnabled,
        },
        homes: props.homes,
        audiences,
        audiencePresentation: props.teamAudienceContext?.kind === 'global' ? 'team_drilldown' : 'flat',
        tags: props.tags,
        sourceAvailable: props.sourceAvailable,
        fixedHomeServerIds: props.fixedHomeServerIds,
        fixedAudienceKeys: props.fixedAudienceKeys,
    }), [
        audiences,
        props.filters,
        props.fixedAudienceKeys,
        props.fixedHomeServerIds,
        props.followingAvailable,
        props.homes,
        props.includeInactive,
        props.inactiveVisibilityAvailable,
        props.labels,
        props.queryEnabled,
        props.sourceAvailable,
        props.tags,
        props.teamAudienceContext,
    ]);
    const handleActiveStepChange = React.useCallback((step: SelectionListStep) => {
        if (props.teamAudienceContext?.kind !== 'global') return;
        const address = readSessionListAudienceTeamStepAddress(step.id);
        setDrilledTeamState(address ? {
            contextKey: audienceContextKey,
            address: { serverId: address.serverId, teamId: address.teamId },
        } : null);
    }, [audienceContextKey, props.teamAudienceContext]);
    const syncedAudienceStep = React.useMemo(() => {
        if (props.teamAudienceContext?.kind !== 'global' || !drilledTeam) return null;
        for (const section of model.rootStep.sections) {
            if (section.kind !== 'static') continue;
            for (const option of section.options) {
                const address = option.openStep
                    ? readSessionListAudienceTeamStepAddress(option.openStep.id)
                    : null;
                if (address?.serverId === drilledTeam.serverId && address.teamId === drilledTeam.teamId) {
                    return option.openStep ?? null;
                }
            }
        }
        return null;
    }, [drilledTeam, model.rootStep.sections, props.teamAudienceContext]);
    const handleSelect = React.useCallback((optionId: string) => {
        if (props.inactiveVisibilityAvailable === false && optionId.startsWith('inactive:')) return;
        if (!props.queryEnabled && optionId.startsWith('attention:')) return;
        const next = resolveSessionListFilterEditorSelectionChange(
            props.filters,
            props.includeInactive,
            optionId,
        );
        // Source has a persisted owner; every other facet is this surface's retained
        // view state. One option id only ever moves one facet, so the write goes to
        // exactly one writer.
        if (next.filters.source !== props.filters.source) {
            props.setSource(next.filters.source);
        } else if (next.filters !== props.filters) {
            props.updateFilters(next.filters);
        }
        if (next.includeInactive !== props.includeInactive) {
            props.setIncludeInactive(next.includeInactive);
        }
    }, [props]);
    const pagination = React.useMemo<SelectionListPagination | undefined>(() => {
        if (!teamAudienceEnabled) return undefined;
        const loadingLabel = props.labels.catalogLoading ?? props.labels.noOptions;
        const moreLabel = props.labels.catalogMore ?? props.labels.noOptions;
        const retryLabel = props.labels.catalogRetry ?? props.labels.noOptions;
        const endReachedLabel = props.labels.catalogEnd ?? props.labels.noOptions;
        const showGroups = activeTeam !== null && activeTeamScope !== null && (
            props.teamAudienceContext?.kind === 'team' || drilledTeam !== null
        );
        if (showGroups) {
            const retryable = groups.error?.retryable === true;
            return {
                hasMore: groups.hasMore,
                loadingMore: groups.status === 'loading'
                    || groups.status === 'loading_more'
                    || (groups.status === 'ready' && !groups.isCurrent && groups.error === null),
                requestKey: JSON.stringify([
                    activeTeam.serverId,
                    activeTeam.teamId,
                    groups.rows.map((row) => row.id),
                    groups.hasMore,
                ]),
                error: groups.status === 'error'
                    ? (props.labels.catalogError ?? props.labels.noOptions)
                    : null,
                onEndReached: () => { void groups.loadMore(); },
                ...(retryable ? { onRetry: () => { void groups.reload(); } } : {}),
                loadingLabel,
                moreLabel,
                retryLabel,
                endReachedLabel: groups.rows.length === 0 ? props.labels.noOptions : endReachedLabel,
            };
        }
        const unavailable = directory.unavailableHomes.filter((home) => home.reason !== 'loading');
        const retryable = directory.stale || unavailable.some((home) => home.retryable);
        return {
            hasMore: directory.hasMore,
            loadingMore: directory.unavailableHomes.some((home) => home.reason === 'loading')
                || (directory.kind === 'loading' && unavailable.length === 0),
            requestKey: JSON.stringify([
                directory.rows.map((row) => [row.address.serverId, row.address.teamId]),
                directory.hasMore,
            ]),
            error: unavailable.length > 0 || directory.stale
                ? (directory.rows.length > 0
                    ? props.labels.catalogPartial ?? props.labels.catalogError ?? props.labels.noOptions
                    : props.labels.catalogError ?? props.labels.noOptions)
                : null,
            onEndReached: directory.loadMore,
            ...(retryable ? { onRetry: directory.refresh } : {}),
            loadingLabel,
            moreLabel,
            retryLabel,
            endReachedLabel: directory.rows.length === 0 ? props.labels.noOptions : endReachedLabel,
        };
    }, [
        activeTeam,
        activeTeamScope,
        directory,
        drilledTeam,
        groups,
        props.labels,
        props.teamAudienceContext,
        teamAudienceEnabled,
    ]);

    return (
        <View testID="session-list-filter-editor-surface" style={styles.root}>
            <SelectionList
                rootStep={model.rootStep}
                selection={model.selection}
                syncActiveStep={props.teamAudienceContext?.kind === 'global' ? syncedAudienceStep : undefined}
                onActiveStepChange={handleActiveStepChange}
                listAccessibilityLabel={props.labels.title}
                onSelect={handleSelect}
                pagination={pagination}
                onRequestClose={props.onDone ?? (() => undefined)}
                autoFocusInputOnWeb
                autoFocusInputOnNative={false}
                maxHeight={props.maxHeight}
                heightBehavior={props.maxHeight === undefined ? 'content' : 'fixedToMaxHeight'}
                showsVerticalScrollIndicator
                disableTransitions={props.disableTransitions}
                testID="session-list-filter-editor"
            />
            <View style={styles.footer}>
                <ToolbarButton
                    label={props.labels.clear}
                    onPress={props.resetFilters}
                    testID="session-list-filter-clear"
                    style={styles.footerButton}
                />
                {props.onDone ? (
                    <ToolbarButton
                        label={props.labels.done}
                        tone="primary"
                        onPress={props.onDone}
                        testID="session-list-filter-done"
                        style={styles.footerButton}
                    />
                ) : null}
            </View>
        </View>
    );
});
