import * as React from 'react';

import { useSessionListStorageKind } from '@/components/sessions/model/useSessionListStorageKind';
import { useSessionListSelectionState } from '@/hooks/session/useSessionListSelectionState';
import { listServerProfiles, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { listServerProfileScopeIds } from '@/sync/domains/server/selection/serverSelectionProfileScopeIds';
import { useServerCredentialAccountScopeResolutions } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';

import {
    useSessionListQueryHomeSupportByServerId,
    useSessionListFeatureHomeSupportByServerId,
    type SessionListQueryHomeInput,
} from '@/sync/domains/session/listing/useSessionListQuerySourceState';

import {
    buildSessionListFilterQueryHomes,
    buildQualifiedAudienceSelectionKey,
    isSessionListEmptyQuerySelectionComplete,
    resolveSessionListFilterOrdinaryPageAdapter,
    resolveSessionListViewContextDefaults,
    shouldUseSessionListFilterQuerySource,
    type SessionListViewContext,
    type SessionListViewFilters,
} from './sessionListViewFilters';
import {
    buildSessionListViewCredentialScopeKey,
    useSessionListViewFilters,
} from './useSessionListViewFilters';

export type SessionListCorpusStorage = 'active' | 'archived';
export type SessionListCorpusPresentation = 'semantic_query' | 'legacy_owner_or_direct';

const GLOBAL_SESSION_LIST_VIEW_CONTEXT: SessionListViewContext = { kind: 'global' };

export function resolveSelectedHomeFeatureAvailability(
    selectedServerIds: readonly string[],
    supportByServerId: Readonly<Record<string, boolean | null | undefined>>,
): boolean {
    return selectedServerIds.some((serverId) => supportByServerId[serverId] === true);
}

export type SessionListViewFilterController = Readonly<{
    filters: SessionListViewFilters;
    defaultFilters: SessionListViewFilters;
    updateFilters: React.Dispatch<React.SetStateAction<SessionListViewFilters>>;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    removeAuthoritativelyDeletedSelections: ReturnType<typeof useSessionListViewFilters>['removeAuthoritativelyDeletedSelections'];
    resetFilters(): void;
    includeInactive: boolean;
    corpusStorage: SessionListCorpusStorage;
    setIncludeInactive(includeInactive: boolean): void;
    /**
     * Writes the Source facet through the device-local `sessionsListStorageFilter`
     * preference that seeds it, so the choice survives a restart instead of living
     * only in this surface's retained view state.
     */
    setSource(source: SessionListViewFilters['source']): void;
    queryEnabled: boolean;
    corpusPresentation: SessionListCorpusPresentation;
    queryHomes: readonly SessionListQueryHomeInput[];
    /**
     * Homes handed to the canonical per-Home pagination owner, or `undefined` when
     * this corpus has no owner mounted and the incumbent ordinary Sync list is the
     * source. Archived always has an owner because its released GET adapter serves
     * Homes without filtered listing.
     */
    pagingHomes: readonly SessionListQueryHomeInput[] | undefined;
    /** True only when mounted filter options are known and qualified facets exclude every Home. */
    emptyQuerySelectionComplete?: boolean;
    followingAvailable: boolean;
    sourceAvailable: boolean;
    homeOptions: readonly Readonly<{ serverId: string; label: string }>[];
    viewContext: SessionListViewContext;
    viewContextKey: string;
    /** Stable across focused-Home changes; changes only with this context's credential-bound corpus. */
    retentionScopeKey: string;
    fixedHomeServerIds?: ReadonlySet<string>;
    fixedAudienceKeys?: ReadonlySet<string>;
}>;

/**
 * Canonical owner for one Sessions surface's retained filter state and query
 * projection. The Home selector remains the owner of the mounted Home set; this
 * hook seeds a temporary view selection from the credential-bound Home corpus
 * for each global or exact-Team context.
 */
export function useSessionListViewFilterController(
    corpusStorage: SessionListCorpusStorage = 'active',
    viewContext: SessionListViewContext = GLOBAL_SESSION_LIST_VIEW_CONTEXT,
): SessionListViewFilterController {
    const selection = useSessionListSelectionState();
    const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const { externalSessionsEnabled, storageKind, setStorageKind } = useSessionListStorageKind();
    // Source has one device-local owner, so this controller seeds it rather than
    // taking a per-surface default: mount order can no longer decide which default
    // the shared global context gets. With no Home exposing external Sessions the
    // facet cannot mean anything, so the corpus stays unnarrowed.
    const defaultSource: SessionListViewFilters['source'] = externalSessionsEnabled ? storageKind : 'all';
    const serverProfilesGeneration = useServerProfilesGeneration();
    const mountedHomeServerIds = React.useMemo(() => {
        const values = selection.allowedServerIds?.length
            ? selection.allowedServerIds
            : selection.activeServerId
                ? [selection.activeServerId]
                : [];
        return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    }, [selection.activeServerId, selection.allowedServerIds]);
    const authoritativeHomeServerIds = React.useMemo(() => {
        const profileScopeIds = listServerProfileScopeIds(listServerProfiles());
        // A same-origin bootstrap can be mounted before it has a stored profile.
        return [...new Set([
            ...profileScopeIds,
            ...(selection.activeServerId ? [selection.activeServerId] : []),
        ])];
    }, [selection.activeServerId, serverProfilesGeneration]);
    const context = resolveSessionListViewContextDefaults(
        viewContext,
        mountedHomeServerIds,
        defaultSource,
    );
    const credentialServerIds = React.useMemo(() => viewContext.kind === 'team'
        ? [viewContext.team.serverId]
        : authoritativeHomeServerIds,
    [authoritativeHomeServerIds, viewContext]);
    const accountScopeResolutions = useServerCredentialAccountScopeResolutions(credentialServerIds);
    const participatingServerIds = viewContext.kind === 'team'
        ? [viewContext.team.serverId]
        : mountedHomeServerIds;
    const retentionScopeKey = buildSessionListViewCredentialScopeKey(
        context.contextKey,
        accountScopeResolutions,
        participatingServerIds,
    );
    const retained = useSessionListViewFilters({
        contextKey: context.contextKey,
        defaults: context.defaults,
        accountScopeResolutions,
        // Global Homes mount asynchronously; a Team context is fixed to its Home.
        followDefaultHomeSelection: viewContext.kind === 'global',
        authoritativeHomeServerIds,
    });
    // Archived Sessions are inactive by definition, so the active list's
    // `Hide inactive sessions` preference cannot narrow this corpus: applying it
    // would make the archived destination authoritatively empty.
    const includeInactive = corpusStorage === 'archived' ? true : hideInactiveSessions !== true;
    // Admission is decided per exact Home. One capable Home mounts the filtered
    // corpus for the whole surface; the remaining Homes contribute their own
    // truthful loading, disabled, unsupported or offline state instead of
    // suppressing it. Only a selection where no Home can serve the query and no
    // corpus has a released GET adapter falls back to the incumbent ordinary list.
    //
    // Support is probed for every selected mounted Home, before any facet narrows
    // the set. Whether a Home can serve filtered listing is a property of that Home,
    // not of the current selection, and deriving it from the post-facet set would
    // make the tag facet's own meaning depend on itself.
    const selectedHomeServerIds = React.useMemo(
        () => mountedHomeServerIds.filter((serverId) => retained.filters.homeServerIds.includes(serverId)),
        [mountedHomeServerIds, retained.filters.homeServerIds],
    );
    const homeSupportByServerId = useSessionListQueryHomeSupportByServerId(selectedHomeServerIds, true);
    const followingSupportByServerId = useSessionListFeatureHomeSupportByServerId(
        'sessions.following',
        selectedHomeServerIds,
        true,
    );
    const sourceSupportByServerId = useSessionListFeatureHomeSupportByServerId(
        'sessions.direct',
        selectedHomeServerIds,
        true,
    );
    const queryEnabled = resolveSelectedHomeFeatureAvailability(selectedHomeServerIds, homeSupportByServerId);
    const followingAvailable = resolveSelectedHomeFeatureAvailability(selectedHomeServerIds, followingSupportByServerId);
    const sourceAvailable = resolveSelectedHomeFeatureAvailability(selectedHomeServerIds, sourceSupportByServerId);
    const queryHomes = React.useMemo(
        () => buildSessionListFilterQueryHomes(retained.filters, {
            storage: corpusStorage,
            includeInactive,
            mountedHomeServerIds,
            // No selected Home can express tags structurally, so the released GET
            // adapter serves the corpus and the qualified tag selection narrows its
            // loaded rows locally instead of producing an unanswerable request.
            tagFacet: queryEnabled ? 'query' : 'local',
        }).map((home) => ({
            ...home,
            ordinaryAdapter: resolveSessionListFilterOrdinaryPageAdapter(retained.filters, home.query),
        })),
        [corpusStorage, includeInactive, mountedHomeServerIds, queryEnabled, retained.filters],
    );
    const useQuerySource = shouldUseSessionListFilterQuerySource(retained.filters, {
        mountedHomeServerIds,
        queryEnabled,
        hasOrdinaryAdapter: queryHomes.some((home) => home.ordinaryAdapter !== null),
    });
    const pagingHomes = useQuerySource ? queryHomes : undefined;
    const corpusPresentation: SessionListCorpusPresentation = queryEnabled
        ? 'semantic_query'
        : 'legacy_owner_or_direct';
    const emptyQuerySelectionComplete = isSessionListEmptyQuerySelectionComplete({
        useQuerySource,
        mountedHomeCount: mountedHomeServerIds.length,
        queryHomeCount: queryHomes.length,
    });
    const homeOptions = React.useMemo(() => {
        const profilesById = new Map(listServerProfiles().flatMap((profile) => [
            [profile.id, profile] as const,
            [resolveServerProfileScopeId(profile), profile] as const,
        ]));
        const visibleHomeServerIds = viewContext.kind === 'team'
            ? [viewContext.team.serverId]
            : mountedHomeServerIds;
        return visibleHomeServerIds.map((serverId) => ({
            serverId,
            label: profilesById.get(serverId)?.name?.trim() || serverId,
        }));
    }, [mountedHomeServerIds, viewContext]);
    const fixedHomeServerIds = React.useMemo(
        () => viewContext.kind === 'team'
            ? new Set([viewContext.team.serverId])
            : undefined,
        [viewContext],
    );
    const fixedAudienceKeys = React.useMemo(
        () => viewContext.kind === 'team'
            ? new Set([buildQualifiedAudienceSelectionKey({
                serverId: viewContext.team.serverId,
                kind: 'team',
                teamId: viewContext.team.teamId,
            })])
            : undefined,
        [viewContext],
    );
    const setIncludeInactive = React.useCallback((value: boolean) => {
        if (corpusStorage === 'archived') return;
        setHideInactiveSessions(!value);
    }, [corpusStorage, setHideInactiveSessions]);
    const updateFilters = retained.updateFilters;
    const setSource = React.useCallback((source: SessionListViewFilters['source']) => {
        setStorageKind(source);
        updateFilters((current) => (current.source === source ? current : { ...current, source }));
    }, [setStorageKind, updateFilters]);

    return React.useMemo(() => ({
        ...retained,
        defaultFilters: context.defaults,
        includeInactive,
        corpusStorage,
        setIncludeInactive,
        setSource,
        queryEnabled,
        corpusPresentation,
        queryHomes,
        pagingHomes,
        emptyQuerySelectionComplete,
        followingAvailable,
        sourceAvailable,
        homeOptions,
        viewContext,
        viewContextKey: context.contextKey,
        retentionScopeKey,
        fixedHomeServerIds,
        fixedAudienceKeys,
    }), [
        context.defaults,
        context.contextKey,
        corpusStorage,
        fixedAudienceKeys,
        fixedHomeServerIds,
        followingAvailable,
        homeOptions,
        includeInactive,
        pagingHomes,
        emptyQuerySelectionComplete,
        queryEnabled,
        corpusPresentation,
        queryHomes,
        retained,
        retentionScopeKey,
        setIncludeInactive,
        setSource,
        sourceAvailable,
        viewContext,
    ]);
}
