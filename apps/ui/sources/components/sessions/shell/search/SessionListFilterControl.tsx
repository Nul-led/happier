import * as React from 'react';
import type { SessionListScopeV1 } from '@happier-dev/protocol';

import { t } from '@/text';
import type { SessionOrganizationProjection } from '@/sync/domains/session/organization/types';

import {
    buildSessionListFilterTagOptions,
    qualifySessionListFilterOptionLabel,
} from './sessionListFilterTagOptions';
import { SessionListFilterEditorControl } from './SessionListFilterEditorControl';
import type { SessionListViewFilterController } from './useSessionListViewFilterController';

function readScopeLabel(scope: SessionListScopeV1): string {
    switch (scope) {
        case 'my_work': return t('sessionsList.filtersMyWork');
        case 'assigned_to_me': return t('sessionsList.filtersAssignedToMe');
        case 'following': return t('sessionsList.filtersFollowing');
        case 'involving_me': return t('sessionsList.filtersInvolvingMe');
        case 'all_accessible': return t('sessionsList.filtersAllAccessible');
    }
}

export const SessionListFilterControl = React.memo(function SessionListFilterControl(props: Readonly<{
    controller: SessionListViewFilterController;
    organizationProjectionsByServerId: Readonly<Record<string, SessionOrganizationProjection>>;
}>) {
    const { controller } = props;
    const qualifyLabel = React.useCallback((label: string, serverId: string) => (
        qualifySessionListFilterOptionLabel({ label, serverId, homeOptions: controller.homeOptions })
    ), [controller.homeOptions]);
    const outsideTeamsLabel = t('sessionsList.filtersOutsideTeams');
    const audienceOptions = React.useMemo(() => {
        return controller.viewContext.kind === 'global'
            ? controller.homeOptions.map((home) => ({
            serverId: home.serverId,
            kind: 'outside_teams' as const,
            label: qualifyLabel(outsideTeamsLabel, home.serverId),
        }))
            : [];
    }, [controller.homeOptions, controller.viewContext, outsideTeamsLabel, qualifyLabel]);
    const tagOptions = React.useMemo(() => buildSessionListFilterTagOptions({
        homeOptions: controller.homeOptions,
        organizationProjectionsByServerId: props.organizationProjectionsByServerId,
    }), [controller.homeOptions, props.organizationProjectionsByServerId]);
    const allMountedHomesSelected = React.useMemo(() => {
        const selected = new Set(controller.filters.homeServerIds);
        return selected.size === controller.homeOptions.length
            && controller.homeOptions.every((home) => selected.has(home.serverId));
    }, [controller.filters.homeServerIds, controller.homeOptions]);
    const active = controller.filters.scope !== 'my_work'
        || controller.filters.attention !== 'any'
        || !controller.includeInactive
        || !allMountedHomesSelected
        || controller.filters.audiences.length > 0
        || controller.filters.tagIds.length > 0
        || controller.filters.source !== 'all';
    const labels = {
        title: t('sessionsList.filtersTitle'),
        search: t('sessionsList.filtersSearch'),
        show: t('sessionsList.filtersShow'),
        myWork: t('sessionsList.filtersMyWork'),
        assignedToMe: t('sessionsList.filtersAssignedToMe'),
        following: t('sessionsList.filtersFollowing'),
        involvingMe: t('sessionsList.filtersInvolvingMe'),
        allAccessible: t('sessionsList.filtersAllAccessible'),
        attention: t('sessionsList.filtersAttention'),
        anyAttention: t('sessionsList.filtersAttentionAny'),
        needsMyAttention: t('sessionsList.filtersAttentionNeedsMe'),
        inactiveSessions: t('sessionsList.filtersInactive'),
        showInactive: t('sessionsList.filtersInactiveShow'),
        hideInactive: t('sessionsList.filtersInactiveHide'),
        homes: t('sessionsList.filtersHomes'),
        sharedWith: t('sessionsList.filtersSharedWith'),
        outsideTeams: outsideTeamsLabel,
        tags: t('sessionsList.filtersTags'),
        source: t('sessionsList.filtersSource'),
        allSources: t('sessionsList.filtersSourceAll'),
        persistedSource: t('sessionsList.filtersSourcePersisted'),
        directSource: t('sessionsList.filtersSourceDirect'),
        noOptions: t('sessionsList.filtersNoOptions'),
        clear: t('sessionsList.filtersClear'),
        done: t('sessionsList.filtersDone'),
        catalogLoading: t('common.loading'),
        catalogMore: t('common.more'),
        catalogRetry: t('common.retry'),
        catalogError: t('common.error'),
        catalogPartial: t('common.unavailable'),
        catalogEnd: t('session.access.allLoaded'),
    };

    // A Team is named for people, not addressed by them. The immutable id shows
    // only while the Home has not answered with the Team's real name yet.
    const semanticScopeLabel = readScopeLabel(controller.filters.scope);
    const corpusLabel = controller.corpusPresentation === 'legacy_owner_or_direct'
        ? t('sessionsList.filtersLegacyOwnerDirect')
        : semanticScopeLabel;
    const scopedLabel = controller.viewContext.kind === 'team'
        ? `${corpusLabel} · ${
            controller.viewContext.teamDisplayName?.trim() || controller.viewContext.team.teamId
        }`
        : corpusLabel;
    // The attention facet narrows the corpus as much as the scope does, so the
    // collapsed control has to say it is on rather than leaving the list looking
    // inexplicably short. Short form here; the editor keeps the full sentence.
    const controlLabel = controller.filters.attention === 'needs_my_attention'
        ? `${scopedLabel} · ${t('sessionsList.filtersScopeNeedsMe')}`
        : scopedLabel;

    return (
        <SessionListFilterEditorControl
            label={controlLabel}
            active={active}
            editor={{
                filters: controller.filters,
                includeInactive: controller.includeInactive,
                inactiveVisibilityAvailable: controller.corpusStorage === 'active',
                queryEnabled: controller.queryEnabled,
                followingAvailable: controller.followingAvailable,
                sourceAvailable: controller.sourceAvailable,
                homes: controller.homeOptions,
                audiences: audienceOptions,
                teamAudienceContext: controller.viewContext,
                tags: tagOptions,
                labels,
                fixedHomeServerIds: controller.fixedHomeServerIds,
                fixedAudienceKeys: controller.fixedAudienceKeys,
                updateFilters: controller.updateFilters,
                removeAuthoritativelyDeletedSelections: controller.removeAuthoritativelyDeletedSelections,
                setIncludeInactive: controller.setIncludeInactive,
                setSource: controller.setSource,
                resetFilters: controller.resetFilters,
            }}
        />
    );
});
