import * as React from 'react';

import { Icon, ICON_SIZE, type IconName } from '@/components/ui/icons/Icon';
import type {
    SelectionListDynamicSection,
    SelectionListOption,
    SelectionListSectionDescriptor,
} from '@/components/ui/selectionList';
import { t } from '@/text';

import type { Command } from '@/components/appShell/commandPalette/types';
import {
    buildCommandPaletteOptionId,
    buildCommandPaletteSelectionListSections,
} from '@/components/appShell/commandPalette/buildCommandPaletteSelectionListSections';

import {
    UNIVERSAL_SEARCH_SOURCE_IDS,
    buildUniversalSearchOptionId,
    buildUniversalSearchScopeKey,
    type UniversalSearchResult,
} from './universalSearchResult';

/**
 * The one Universal Search section builder.
 *
 * It is a THIN ADAPTER LAYER over canonical domain owners, and deliberately not
 * a registry: every built-in source is an ordinary branch here, resolved from
 * inputs the controller already fetched from that domain's own owner. There is
 * no registration API, no provider lifecycle, no ranking service and no cache —
 * `SelectionList` and `useSelectionListDynamicSections` remain the single owners
 * of query state, debounce, `AbortController`, stale-response fencing, section
 * status and virtualization.
 *
 * Two rules shape everything below.
 *
 * EMPTY QUERY IS A UI STATE, NOT A WIRE REQUEST. Every remote/corpus section
 * declares `visibleWhen: query is non-empty`, so opening Search issues zero
 * requests: the user sees bounded local recents and the command catalog.
 *
 * PROVIDER ORDER IS PRESERVED WHERE A CANONICAL EXECUTOR ALREADY RANKED. FTS,
 * fuzzy settings, file and commit sections declare `resultFiltering: 'provider'`
 * — re-running the host matcher over displayed labels would drop a legitimately
 * relevant row whose title does not literally contain the query. No raw score
 * from two different providers is ever compared, because no score reaches here.
 */

/** Bounded empty-query recents. Not a ranking service — just "what you had open". */
const EMPTY_QUERY_RECENT_LIMIT = 5;
const DEFAULT_ROW_LIMIT = 20;

export type UniversalSearchSessionEntity = Readonly<{
    sessionId: string;
    serverId: string | null;
    title: string;
    subtitle?: string;
    updatedAt: number;
}>;

export type UniversalSearchProjectEntity = Readonly<{
    workspaceRefId: string;
    serverId: string;
    machineId: string;
    rootPath: string;
    title: string;
    subtitle?: string;
    lastOpenedAtMs: number;
}>;

export type UniversalSearchSettingsPageEntity = Readonly<{
    id: string;
    route: string;
    title: string;
    subtitle?: string;
}>;

/**
 * A dynamic source the controller already bound to its exact target.
 *
 * `resolverKey` is the target identity — Account scope, Home/server, machine,
 * workspace root, generation. Changing it is how a superseded target's in-flight
 * work is dropped and how its rows are prevented from being replayed from the
 * cross-mount dynamic-section cache after a logout or Account switch.
 */
export type UniversalSearchDynamicSource = Readonly<{
    resolverKey: string;
    /** Calm source-owned coverage/truncation context rendered by SelectionList. */
    resultHint?: string;
    resolve: (query: string, signal: AbortSignal) => Promise<
        readonly UniversalSearchResult[]
        | Readonly<{ results: readonly UniversalSearchResult[]; emptyHint: string }>
    >;
}>;

function isUniversalSearchResolvePage(
    value: readonly UniversalSearchResult[] | Readonly<{ results: readonly UniversalSearchResult[]; emptyHint: string }>,
): value is Readonly<{ results: readonly UniversalSearchResult[]; emptyHint: string }> {
    return typeof value === 'object' && value !== null && 'results' in value;
}

/**
 * A source that exists but currently cannot answer.
 *
 * It renders as an empty section carrying the canonical typed reason as a hint —
 * never as a disabled fake row that could receive activation, and never as an
 * error, because "memory search is off" is not a failure.
 */
export type UniversalSearchUnavailableSource = Readonly<{
    resolverKey: string;
    hint: string;
}>;

export type UniversalSearchSource =
    | (Readonly<{ status: 'ready' }> & UniversalSearchDynamicSource)
    | (Readonly<{ status: 'unavailable' }> & UniversalSearchUnavailableSource)
    /** The source has no target at all here (no workspace, no admitted provider): omit it. */
    | Readonly<{ status: 'absent' }>;

export type BuildUniversalSearchSectionsInput = Readonly<{
    query: string;
    commands: readonly Command[];
    sessions: readonly UniversalSearchSessionEntity[];
    projects: readonly UniversalSearchProjectEntity[];
    /** The resolved settings catalog's own Fuse owner; never a second matcher. */
    searchSettingsPages: (query: string) => readonly UniversalSearchSettingsPageEntity[];
    transcript: UniversalSearchSource;
    files: UniversalSearchSource;
    commits: UniversalSearchSource;
    /** Already-built plugin provider sections; this module adds no plugin policy. */
    pluginSections: readonly SelectionListDynamicSection[];
    /**
     * Records the selected identity. It deliberately does NOT navigate: the
     * option-level callback runs BEFORE the list-level `onSelect`, and plan
     * §4.2 requires commit → dismiss → awaited activation in that order. The
     * surface owns the dismissal and the awaited activation that follow.
     */
    onCommitResult: (result: UniversalSearchResult) => void;
    rowLimit?: number;
}>;

function icon(name: IconName): () => React.ReactElement {
    return () => <Icon name={name} size={ICON_SIZE.md} />;
}

function toOption(
    result: UniversalSearchResult,
    iconName: IconName,
    onCommit: (result: UniversalSearchResult) => void,
): SelectionListOption {
    return {
        id: buildUniversalSearchOptionId(result.sourceId, result.scopeKey, result.id),
        testID: `universal-search:option:${result.sourceId}:${result.id}`,
        label: result.title,
        ...(result.subtitle ? { subtitle: result.subtitle } : {}),
        icon: icon(iconName),
        onSelect: () => { onCommit(result); },
    };
}

function buildDynamicSection(
    input: Readonly<{
        sourceId: string;
        title: string;
        source: UniversalSearchSource;
        iconName: IconName;
        rowLimit: number;
        onCommit: (result: UniversalSearchResult) => void;
    }>,
): SelectionListDynamicSection[] {
    const { source } = input;
    if (source.status === 'absent') return [];

    if (source.status === 'unavailable') {
        return [{
            id: input.sourceId,
            title: input.title,
            resolverKey: `${input.sourceId}|${source.resolverKey}`,
            visibleWhen: (value: string) => value.trim().length > 0,
            debounceMs: 0,
            loadingSkeletonRows: 0,
            showSkeletonsOnFirstLoad: true,
            resultTransition: 'none',
            // A truthful, non-activatable availability statement resolved through
            // the canonical empty-hint path. The shell and every healthy section
            // stay usable beside it.
            resolve: async () => ({ options: [], emptyHint: source.hint }),
        }];
    }

    return [{
        id: input.sourceId,
        title: input.title,
        resolverKey: `${input.sourceId}|${source.resolverKey}`,
        ...(source.resultHint ? { resultHint: source.resultHint } : {}),
        visibleWhen: (value: string) => value.trim().length > 0,
        resultFiltering: 'provider',
        showSkeletonsOnFirstLoad: true,
        resultTransition: 'none',
        resolve: async (seed, signal) => {
            const resolved = await source.resolve(seed.trim(), signal);
            const page = isUniversalSearchResolvePage(resolved) ? resolved : null;
            const results = page ? page.results : resolved;
            return {
                options: results
                    .slice(0, input.rowLimit)
                    .map((result) => toOption(result, input.iconName, input.onCommit)),
                ...(page ? { emptyHint: page.emptyHint } : {}),
            };
        },
    }];
}

function narrowLocalEntities<T>(
    entities: readonly T[],
    query: string,
    recentLimit: number,
): readonly T[] {
    // On an empty query the list is a bounded "what you had open" set. With a
    // query the host matcher does the narrowing and ranking, so every candidate
    // must be offered. SelectionList virtualizes the resulting rows; there is no
    // pre-match display cap that can hide a valid later candidate.
    return query.length === 0 ? entities.slice(0, recentLimit) : entities;
}

export function buildUniversalSearchSections(
    input: BuildUniversalSearchSectionsInput,
): ReadonlyArray<SelectionListSectionDescriptor> {
    const query = input.query.trim();
    const rowLimit = input.rowLimit ?? DEFAULT_ROW_LIMIT;
    const onCommit = input.onCommitResult;
    const sections: SelectionListSectionDescriptor[] = [];

    // Commands first: they are local, immediate, and the highest-frequency
    // reason the surface is open. Construction, currentness, availability, i18n
    // and activation all stay with `buildCommandPaletteCommands`.
    const visibleCommands = input.commands.filter((command) => command.kind !== 'recentSession');
    sections.push(...buildCommandPaletteSelectionListSections(visibleCommands));

    const sessions = narrowLocalEntities(input.sessions, query, EMPTY_QUERY_RECENT_LIMIT);
    if (sessions.length > 0) {
        sections.push({
            kind: 'static',
            id: UNIVERSAL_SEARCH_SOURCE_IDS.sessions,
            title: query.length === 0
                ? t('commandPalette.commands.recentSessionsCategory')
                : t('universalSearch.sections.sessions'),
            options: sessions.map((session) => toOption({
                id: session.sessionId,
                // The same session id can exist on two Homes; the Home the row
                // was projected from is part of what the user selected.
                scopeKey: buildUniversalSearchScopeKey([session.serverId]),
                sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.sessions,
                kind: 'session',
                title: session.title,
                ...(session.subtitle ? { subtitle: session.subtitle } : {}),
                target: {
                    kind: 'session',
                    sessionId: session.sessionId,
                    serverId: session.serverId,
                },
            }, 'chats-circle', onCommit)),
        });
    }

    const projects = narrowLocalEntities(input.projects, query, EMPTY_QUERY_RECENT_LIMIT);
    if (projects.length > 0) {
        sections.push({
            kind: 'static',
            id: UNIVERSAL_SEARCH_SOURCE_IDS.projects,
            title: t('universalSearch.sections.projects'),
            options: projects.map((project) => toOption({
                id: project.workspaceRefId,
                scopeKey: buildUniversalSearchScopeKey([
                    project.serverId,
                    project.machineId,
                    project.rootPath,
                ]),
                sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.projects,
                kind: 'project',
                title: project.title,
                ...(project.subtitle ? { subtitle: project.subtitle } : {}),
                target: {
                    kind: 'project',
                    workspaceRefId: project.workspaceRefId,
                    serverId: project.serverId,
                    machineId: project.machineId,
                    rootPath: project.rootPath,
                },
            }, 'folder-open', onCommit)),
        });
    }

    // Settings pages come pre-ranked by the settings catalog's own Fuse owner,
    // which matches keywords and ancestor titles the row never displays. It is a
    // local corpus, so it resolves with no debounce; it is provider-filtered so
    // a keyword-only match is not thrown away by the host matcher.
    if (query.length > 0) {
        const settingsPages = input.searchSettingsPages(query).slice(0, rowLimit);
        if (settingsPages.length > 0) {
            sections.push({
                kind: 'dynamic',
                id: UNIVERSAL_SEARCH_SOURCE_IDS.settings,
                title: t('universalSearch.sections.settings'),
                resolverKey: `${UNIVERSAL_SEARCH_SOURCE_IDS.settings}|${query}`,
                visibleWhen: (value: string) => value.trim().length > 0,
                debounceMs: 0,
                loadingSkeletonRows: 0,
                resultFiltering: 'provider',
                showSkeletonsOnFirstLoad: true,
                resultTransition: 'none',
                resolve: async () => ({
                    options: settingsPages.map((page) => toOption({
                        id: page.id,
                        // Settings pages are host-local: the catalog is the scope.
                        scopeKey: buildUniversalSearchScopeKey(['settings']),
                        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.settings,
                        kind: 'settingsPage',
                        title: page.title,
                        ...(page.subtitle ? { subtitle: page.subtitle } : {}),
                        target: { kind: 'settingsPage', route: page.route },
                    }, 'sliders-horizontal', onCommit)),
                }),
            });
        }
    }

    for (const section of buildDynamicSection({
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.transcript,
        title: t('universalSearch.sections.messages'),
        source: input.transcript,
        iconName: 'chat-circle-dots',
        rowLimit,
        onCommit,
    })) {
        sections.push({ kind: 'dynamic', ...section });
    }

    for (const section of buildDynamicSection({
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.files,
        title: t('universalSearch.sections.files'),
        source: input.files,
        iconName: 'file',
        rowLimit,
        onCommit,
    })) {
        sections.push({ kind: 'dynamic', ...section });
    }

    for (const section of buildDynamicSection({
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.commits,
        title: t('universalSearch.sections.commits'),
        source: input.commits,
        iconName: 'git-branch',
        rowLimit,
        onCommit,
    })) {
        sections.push({ kind: 'dynamic', ...section });
    }

    for (const section of input.pluginSections) {
        // Query-result motion and first-load truth are host presentation policy,
        // not plugin descriptor policy. Keep every admitted plugin section on
        // the same high-frequency Search behavior as built-in providers.
        sections.push({
            kind: 'dynamic',
            ...section,
            showSkeletonsOnFirstLoad: true,
            resultTransition: 'none',
        });
    }

    return sections;
}

/** Resolve the command a rendered option id refers to, if any. */
export function findCommandForOptionId(
    commands: readonly Command[],
    optionId: string,
): Command | null {
    for (const command of commands) {
        if (buildCommandPaletteOptionId(command.id) === optionId) return command;
    }
    return null;
}
