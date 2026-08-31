import type {
    AutomationDefinition,
    AutomationDefinitionRun,
} from '@/sync/domains/automations/automationTypes';
import {
    attachAutomationDefinitionDetail,
    hasMatchingAutomationDefinitionTriggerBindings,
    markAutomationDefinitionContentUnavailable,
} from '@/sync/domains/automations/automationDefinitionProjection';
import { getAutomationDefinitionRunCauseAt } from '@/sync/domains/automations/automationRunCause';
import { loadSyncTuning } from '@/sync/runtime/syncTuning';

import type { StoreGet, StoreSet } from './_shared';

const AUTOMATION_RUNS_MAX_ENTRIES_PER_AUTOMATION = loadSyncTuning().automationRunsMaxEntriesPerAutomation;

type AutomationDefinitionTraversal = Readonly<{
    nextCursor: string;
    automations: Record<string, AutomationDefinition>;
}>;

type AutomationRunTraversal = Readonly<{
    nextCursor: string;
    runs: AutomationDefinitionRun[];
}>;

function retainCurrentDefinitionDetail(params: Readonly<{
    previous: AutomationDefinition | undefined;
    incoming: AutomationDefinition;
}>): AutomationDefinition {
    const { previous, incoming } = params;
    if (!previous) return incoming;

    // A delayed list response must not regress a direct current revision.
    if (previous.templateVersion > incoming.templateVersion) {
        return previous;
    }
    if (previous.templateVersion < incoming.templateVersion || incoming.detail.kind !== 'unloaded') {
        return incoming;
    }

    // Summary refreshes never carry private content. The projection owner
    // decides whether the current summary can retain that private state.
    if (previous.detail.kind === 'unloaded') return incoming;
    if (previous.detail.kind === 'unavailable') {
        return hasMatchingAutomationDefinitionTriggerBindings(previous, incoming)
            ? markAutomationDefinitionContentUnavailable(incoming)
            : incoming;
    }

    const retained = attachAutomationDefinitionDetail(incoming, previous.detail.value);
    return retained
        ? { ...retained, linkedExistingSessionId: previous.linkedExistingSessionId }
        : incoming;
}

export type AutomationsDomain = {
    automations: Record<string, AutomationDefinition>;
    automationDefinitionNextCursor: string | null;
    automationDefinitionWindowExtended: boolean;
    automationDefinitionTraversal: AutomationDefinitionTraversal | null;
    automationRunsByAutomationId: Record<string, AutomationDefinitionRun[]>;
    automationRunNextCursorByAutomationId: Record<string, string | null>;
    automationRunTraversalsByAutomationId: Record<string, AutomationRunTraversal>;
    applyAutomations: (automations: AutomationDefinition[], nextCursor?: string | null) => number | null;
    appendAutomations: (
        expectedCursor: string,
        expectedTraversalToken: number,
        automations: AutomationDefinition[],
        nextCursor: string | null,
    ) => boolean;
    upsertAutomation: (automation: AutomationDefinition) => void;
    removeAutomation: (automationId: string) => void;
    setAutomationRuns: (
        automationId: string,
        runs: AutomationDefinitionRun[],
        nextCursor: string | null,
    ) => number | null;
    refreshAutomationRunsWindow: (
        automationId: string,
        runs: AutomationDefinitionRun[],
        nextCursor: string | null,
    ) => void;
    appendAutomationRuns: (
        automationId: string,
        expectedCursor: string,
        expectedTraversalToken: number,
        runs: AutomationDefinitionRun[],
        nextCursor: string | null,
    ) => boolean;
    upsertAutomationRun: (run: AutomationDefinitionRun) => void;
};

function mergeRunsNewestFirst(runs: AutomationDefinitionRun[]): AutomationDefinitionRun[] {
    const uniqueRuns = new Map<string, AutomationDefinitionRun>();
    for (const run of runs) {
        const existing = uniqueRuns.get(run.id);
        if (!existing || run.updatedAt >= existing.updatedAt) {
            uniqueRuns.set(run.id, run);
        }
    }
    return Array.from(uniqueRuns.values())
        .sort((left, right) => {
            const rightCauseAt = getAutomationDefinitionRunCauseAt(right);
            const leftCauseAt = getAutomationDefinitionRunCauseAt(left);
            if (rightCauseAt !== leftCauseAt) {
                return rightCauseAt - leftCauseAt;
            }
            return right.updatedAt - left.updatedAt;
        });
}

function indexAutomations(automations: AutomationDefinition[]): Record<string, AutomationDefinition> {
    return Object.fromEntries(automations.map((automation) => [automation.id, automation]));
}

function mergeAutomationDefinitions(
    previous: Record<string, AutomationDefinition>,
    incoming: AutomationDefinition[],
): Record<string, AutomationDefinition> {
    const next = { ...previous };
    for (const automation of incoming) {
        next[automation.id] = retainCurrentDefinitionDetail({
            previous: previous[automation.id],
            incoming: automation,
        });
    }
    return next;
}

function replaceAutomationDefinitions(
    previous: Record<string, AutomationDefinition>,
    incoming: AutomationDefinition[],
): Record<string, AutomationDefinition> {
    const next: Record<string, AutomationDefinition> = {};
    for (const automation of incoming) {
        next[automation.id] = retainCurrentDefinitionDetail({
            previous: previous[automation.id],
            incoming: automation,
        });
    }
    return next;
}

function retainAutomationRunMembership(
    automationIds: ReadonlySet<string>,
    runsByAutomationId: Record<string, AutomationDefinitionRun[]>,
    cursorsByAutomationId: Record<string, string | null>,
    traversalsByAutomationId: Record<string, AutomationRunTraversal>,
) {
    return {
        automationRunsByAutomationId: Object.fromEntries(
            Object.entries(runsByAutomationId).filter(([automationId]) => automationIds.has(automationId)),
        ),
        automationRunNextCursorByAutomationId: Object.fromEntries(
            Object.entries(cursorsByAutomationId).filter(([automationId]) => automationIds.has(automationId)),
        ),
        automationRunTraversalsByAutomationId: Object.fromEntries(
            Object.entries(traversalsByAutomationId).filter(([automationId]) => automationIds.has(automationId)),
        ),
    };
}

/**
 * The passive retention ceiling. It bounds what this store keeps for an
 * Automation nobody asked to page through — a seeded first page, or a run row
 * pushed in by a socket update — so a large Account cannot accumulate run
 * history the reader never requested.
 *
 * It is NOT a traversal ceiling. Rows the reader explicitly paged in through
 * `appendAutomationRuns` stay retained, and an incoming update may never
 * shrink that window below what the reader is already looking at; the next
 * full re-seed collapses it back to this bound.
 */
function retainPassiveRunWindow(
    runs: AutomationDefinitionRun[],
    retainedFloor = 0,
): AutomationDefinitionRun[] {
    const merged = mergeRunsNewestFirst(runs);
    return merged.slice(0, Math.max(AUTOMATION_RUNS_MAX_ENTRIES_PER_AUTOMATION, retainedFloor));
}

/**
 * The one writer that replaces an Automation's whole run projection: the
 * bounded newest-first window together with the server continuation that
 * belongs to it. Both facts come from the same response, so nothing here may
 * be updated without the other.
 */
function seedAutomationRunWindow<S extends AutomationsDomain>(
    state: S,
    automationId: string,
    runs: AutomationDefinitionRun[],
    nextCursor: string | null,
): S {
    return {
        ...state,
        automationRunsByAutomationId: {
            ...state.automationRunsByAutomationId,
            [automationId]: retainPassiveRunWindow(runs),
        },
        automationRunNextCursorByAutomationId: {
            ...state.automationRunNextCursorByAutomationId,
            [automationId]: nextCursor,
        },
    };
}

export function createAutomationsDomain<S extends AutomationsDomain>({
    set,
}: {
    set: StoreSet<S>;
    get: StoreGet<S>;
}): AutomationsDomain {
    let nextTraversalToken = 0;
    let definitionTraversalToken: number | null = null;
    const runTraversalTokensByAutomationId = new Map<string, number>();

    return {
        automations: {},
        automationDefinitionNextCursor: null,
        automationDefinitionWindowExtended: false,
        automationDefinitionTraversal: null,
        automationRunsByAutomationId: {},
        automationRunNextCursorByAutomationId: {},
        automationRunTraversalsByAutomationId: {},
        applyAutomations: (automations, nextCursor) => {
            const traversalToken = nextCursor === null || nextCursor === undefined
                ? null
                : ++nextTraversalToken;
            definitionTraversalToken = traversalToken;
            set((state) => {
                const freshPage = indexAutomations(automations);
                if (nextCursor !== null && nextCursor !== undefined) {
                    // Keep the last-known-good window while a fresh traversal
                    // is incomplete. Only the full terminal traversal can
                    // authoritatively retire a remotely deleted definition.
                    return {
                        ...state,
                        automations: mergeAutomationDefinitions(state.automations, automations),
                        automationDefinitionNextCursor: nextCursor,
                        automationDefinitionWindowExtended: true,
                        automationDefinitionTraversal: { nextCursor, automations: freshPage },
                    };
                }
                const replacement = replaceAutomationDefinitions(state.automations, automations);
                return {
                    ...state,
                    automations: replacement,
                    automationDefinitionNextCursor: null,
                    automationDefinitionWindowExtended: false,
                    automationDefinitionTraversal: null,
                    ...retainAutomationRunMembership(
                        new Set(Object.keys(replacement)),
                        state.automationRunsByAutomationId,
                        state.automationRunNextCursorByAutomationId,
                        state.automationRunTraversalsByAutomationId,
                    ),
                };
            });
            return traversalToken;
        },
        appendAutomations: (expectedCursor, expectedTraversalToken, automations, nextCursor) => {
            let accepted = false;
            set((state) => {
                if (
                    state.automationDefinitionNextCursor !== expectedCursor
                    || definitionTraversalToken !== expectedTraversalToken
                ) return state;
                const traversal = state.automationDefinitionTraversal;
                if (!traversal || traversal.nextCursor !== expectedCursor) return state;
                const traversedAutomations = { ...traversal.automations, ...indexAutomations(automations) };
                accepted = true;
                if (nextCursor === null) {
                    definitionTraversalToken = null;
                    const replacement = replaceAutomationDefinitions(
                        state.automations,
                        Object.values(traversedAutomations),
                    );
                    return {
                        ...state,
                        automations: replacement,
                        automationDefinitionNextCursor: null,
                        automationDefinitionWindowExtended: false,
                        automationDefinitionTraversal: null,
                        ...retainAutomationRunMembership(
                            new Set(Object.keys(replacement)),
                            state.automationRunsByAutomationId,
                            state.automationRunNextCursorByAutomationId,
                            state.automationRunTraversalsByAutomationId,
                        ),
                    };
                }
                return {
                    ...state,
                    automations: mergeAutomationDefinitions(state.automations, automations),
                    automationDefinitionNextCursor: nextCursor,
                    automationDefinitionWindowExtended: true,
                    automationDefinitionTraversal: {
                        nextCursor,
                        automations: traversedAutomations,
                    },
                };
            });
            return accepted;
        },
        upsertAutomation: (automation) =>
            set((state) => ({
                ...state,
                automations: {
                    ...state.automations,
                    [automation.id]: automation,
                },
                automationDefinitionTraversal: state.automationDefinitionTraversal
                    ? {
                        ...state.automationDefinitionTraversal,
                        automations: {
                            ...state.automationDefinitionTraversal.automations,
                            [automation.id]: automation,
                        },
                    }
                    : null,
            })),
        removeAutomation: (automationId) => {
            runTraversalTokensByAutomationId.delete(automationId);
            set((state) => {
                const nextAutomations = { ...state.automations };
                const nextRunsByAutomationId = { ...state.automationRunsByAutomationId };
                const nextRunCursorsByAutomationId = { ...state.automationRunNextCursorByAutomationId };
                const nextRunTraversalsByAutomationId = { ...state.automationRunTraversalsByAutomationId };
                delete nextAutomations[automationId];
                delete nextRunsByAutomationId[automationId];
                delete nextRunCursorsByAutomationId[automationId];
                delete nextRunTraversalsByAutomationId[automationId];
                const nextDefinitionTraversal = state.automationDefinitionTraversal
                    ? {
                        ...state.automationDefinitionTraversal,
                        automations: { ...state.automationDefinitionTraversal.automations },
                    }
                    : null;
                if (nextDefinitionTraversal) delete nextDefinitionTraversal.automations[automationId];
                return {
                    ...state,
                    automations: nextAutomations,
                    automationRunsByAutomationId: nextRunsByAutomationId,
                    automationRunNextCursorByAutomationId: nextRunCursorsByAutomationId,
                    automationRunTraversalsByAutomationId: nextRunTraversalsByAutomationId,
                    automationDefinitionTraversal: nextDefinitionTraversal,
                };
            });
        },
        setAutomationRuns: (automationId, runs, nextCursor) => {
            const traversalToken = nextCursor === null ? null : ++nextTraversalToken;
            if (traversalToken === null) runTraversalTokensByAutomationId.delete(automationId);
            else runTraversalTokensByAutomationId.set(automationId, traversalToken);
            set((state) => {
                const nextTraversals = { ...state.automationRunTraversalsByAutomationId };
                if (nextCursor === null) {
                    delete nextTraversals[automationId];
                    return {
                        ...seedAutomationRunWindow(state, automationId, runs, nextCursor),
                        automationRunTraversalsByAutomationId: nextTraversals,
                    };
                }
                const existing = state.automationRunsByAutomationId[automationId] ?? [];
                return {
                    ...state,
                    automationRunsByAutomationId: {
                        ...state.automationRunsByAutomationId,
                        [automationId]: existing.length === 0
                            ? retainPassiveRunWindow(runs)
                            : mergeRunsNewestFirst([...existing, ...runs]),
                    },
                    automationRunNextCursorByAutomationId: {
                        ...state.automationRunNextCursorByAutomationId,
                        [automationId]: nextCursor,
                    },
                    automationRunTraversalsByAutomationId: {
                        ...nextTraversals,
                        [automationId]: { nextCursor, runs },
                    },
                };
            });
            return traversalToken;
        },
        refreshAutomationRunsWindow: (automationId, runs, nextCursor) =>
            set((state) => {
                const existing = state.automationRunsByAutomationId[automationId] ?? [];
                const traversal = state.automationRunTraversalsByAutomationId[automationId];
                const nextTraversals = traversal
                    ? {
                        ...state.automationRunTraversalsByAutomationId,
                        [automationId]: {
                            ...traversal,
                            runs: mergeRunsNewestFirst([...traversal.runs, ...runs]),
                        },
                    }
                    : state.automationRunTraversalsByAutomationId;
                // A window no larger than the page the server just returned is
                // the passive projection: re-seeding it is exactly what the
                // reader would see by reopening the Automation, and everything
                // it drops is still reachable through the fresh continuation.
                if (existing.length <= runs.length) {
                    return {
                        ...seedAutomationRunWindow(state, automationId, runs, nextCursor),
                        automationRunTraversalsByAutomationId: nextTraversals,
                    };
                }
                // A larger window is a traversal the reader paid for page by
                // page, and the cursor it holds is the authoritative server
                // continuation for the END of that traversal. A refresh only
                // restates the newest page into it: replacing the window would
                // discard Runs the reader is looking at, and replacing the
                // continuation would rewind the traversal to the first page.
                return {
                    ...state,
                    automationRunsByAutomationId: {
                        ...state.automationRunsByAutomationId,
                        [automationId]: mergeRunsNewestFirst([...existing, ...runs]),
                    },
                    automationRunTraversalsByAutomationId: nextTraversals,
                };
            }),
        appendAutomationRuns: (automationId, expectedCursor, expectedTraversalToken, runs, nextCursor) => {
            let accepted = false;
            set((state) => {
                if (
                    state.automationRunNextCursorByAutomationId[automationId] !== expectedCursor
                    || runTraversalTokensByAutomationId.get(automationId) !== expectedTraversalToken
                ) {
                    return state;
                }
                const traversal = state.automationRunTraversalsByAutomationId[automationId];
                if (!traversal || traversal.nextCursor !== expectedCursor) return state;
                const existing = state.automationRunsByAutomationId[automationId] ?? [];
                const traversedRuns = mergeRunsNewestFirst([...traversal.runs, ...runs]);
                const nextTraversals = { ...state.automationRunTraversalsByAutomationId };
                accepted = true;
                if (nextCursor === null) {
                    runTraversalTokensByAutomationId.delete(automationId);
                    delete nextTraversals[automationId];
                    return {
                        ...state,
                        automationRunsByAutomationId: {
                            ...state.automationRunsByAutomationId,
                            [automationId]: traversedRuns,
                        },
                        automationRunNextCursorByAutomationId: {
                            ...state.automationRunNextCursorByAutomationId,
                            [automationId]: null,
                        },
                        automationRunTraversalsByAutomationId: nextTraversals,
                    };
                }
                // An explicit page is what the reader asked to see, so it is
                // retained in full and the server's continuation is recorded
                // verbatim. Deriving the continuation from the passive window
                // instead made the newest-first ceiling look like the end of
                // the Automation's history, with no way back to older Runs and
                // nothing said about it. The window this grows is bounded by
                // the pages the reader actually requested and collapses back
                // to the passive ceiling on the next full re-seed.
                return {
                    ...state,
                    automationRunsByAutomationId: {
                        ...state.automationRunsByAutomationId,
                        [automationId]: mergeRunsNewestFirst([...existing, ...runs]),
                    },
                    automationRunNextCursorByAutomationId: {
                        ...state.automationRunNextCursorByAutomationId,
                        [automationId]: nextCursor,
                    },
                    automationRunTraversalsByAutomationId: {
                        ...nextTraversals,
                        [automationId]: { nextCursor, runs: traversedRuns },
                    },
                };
            });
            return accepted;
        },
        upsertAutomationRun: (run) =>
            set((state) => {
                const existing = state.automationRunsByAutomationId[run.automationId] ?? [];
                const filtered = existing.filter((entry) => entry.id !== run.id);
                const next = retainPassiveRunWindow([run, ...filtered], existing.length);
                const traversal = state.automationRunTraversalsByAutomationId[run.automationId];
                return {
                    ...state,
                    automationRunsByAutomationId: {
                        ...state.automationRunsByAutomationId,
                        [run.automationId]: next,
                    },
                    automationRunTraversalsByAutomationId: traversal
                        ? {
                            ...state.automationRunTraversalsByAutomationId,
                            [run.automationId]: {
                                ...traversal,
                                runs: mergeRunsNewestFirst([...traversal.runs, run]),
                            },
                        }
                        : state.automationRunTraversalsByAutomationId,
                };
            }),
    };
}
