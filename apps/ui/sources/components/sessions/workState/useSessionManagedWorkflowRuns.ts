import * as React from 'react';

import type { WorkflowRunSummaryV1 } from '@happier-dev/protocol/workflows/workflowProgressV1';
import type { WorkflowRunPrivateMetadataV1 } from '@happier-dev/protocol/workflows/actionsV1';

import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { getStorage, useActiveServerAccountScope, useWorkflowRunRows } from '@/sync/domains/state/storage';
import { listWorkflowRuns } from '@/sync/domains/workflows/workflowRunListActions';
import { subscribeVisibleWorkflowRunListInvalidation } from '@/sync/domains/workflows/workflowRunListInvalidation';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

/**
 * The managed Workflow Runs this Session started.
 *
 * `originSessionId` is the canonical Run-list filter for that provenance, and
 * `attention: 'required'` is the canonical server predicate for "this needs the
 * person". Both are asked of the same Action front door, so this hook adds no
 * second run store and invents no local attention rule — which matters because
 * an off-page approval is discoverable only through that server predicate.
 *
 * Row bodies land in the one Account-scoped Run row owner and are read back
 * from it, so a control the Run screen settles, or an exact invalidation,
 * reaches a mounted Session row at once. This hook keeps only the ordered
 * membership and attention ids of its own query, and re-asks on the same
 * Account-change wake the Workflows collection observes. There is no poller,
 * no second store and no local bus.
 *
 * A Session origin is provenance, not ownership: these Runs keep their own
 * custody and stay inspectable from the Workflows collection after the Session
 * ends. This reader exists so the Session that started them offers the exact
 * entry point while it is still useful.
 */

export type SessionManagedWorkflowRunsState = Readonly<{
    phase: 'idle' | 'loading' | 'loaded' | 'failed';
    runs: readonly WorkflowRunSummaryV1[];
    metadataByRunId?: Readonly<Record<string, WorkflowRunPrivateMetadataV1>>;
    /** Exactly the Run ids the server's attention predicate returned. */
    attentionRunIds: ReadonlySet<string>;
    /**
     * The most recent read failed.
     *
     * It is separate from `phase` because a failed refresh does not unlearn
     * what the previous one proved: `phase` stays `loaded` with its membership
     * intact and this says the content may be stale. Only a first read with
     * nothing known yet is `failed`.
     */
    refreshFailed: boolean;
}>;

type SessionManagedWorkflowRunsWindow = Readonly<{
    phase: SessionManagedWorkflowRunsState['phase'];
    /** The Account and Session this window was read for; anything else shows nothing. */
    accountScopeKey: string | null;
    sessionId: string | null;
    runIds: readonly string[];
    attentionRunIds: ReadonlySet<string>;
    refreshFailed: boolean;
}>;

const EMPTY_RUN_IDS: readonly string[] = Object.freeze([]);
const EMPTY_ATTENTION: ReadonlySet<string> = new Set<string>();
const EMPTY_RUNS: readonly WorkflowRunSummaryV1[] = Object.freeze([]);
const EMPTY_METADATA: Readonly<Record<string, WorkflowRunPrivateMetadataV1>> = Object.freeze({});

const EMPTY_WINDOW: SessionManagedWorkflowRunsWindow = {
    phase: 'idle',
    accountScopeKey: null,
    sessionId: null,
    runIds: EMPTY_RUN_IDS,
    attentionRunIds: EMPTY_ATTENTION,
    refreshFailed: false,
};

/**
 * Membership is the union of both pages, in a deterministic existing order.
 *
 * The two queries are different keysets: `attention: 'required'` is the only
 * owner of "this needs the person", and the Run it names is frequently not on
 * the general page. Taking membership from the general page alone fetched that
 * Run, recorded it as needing attention and then never rendered it — which is
 * exactly the case the server predicate exists for. The general page keeps its
 * server order and the attention-only ids follow in theirs; nothing is
 * re-sorted on the client, so a refresh cannot reshuffle rows under a reader.
 */
function unionRunIds(general: readonly string[], attention: readonly string[]): readonly string[] {
    const seen = new Set(general);
    const additional = attention.filter((runId) => !seen.has(runId));
    return additional.length === 0 ? general : [...general, ...additional];
}

export function useSessionManagedWorkflowRuns(params: Readonly<{
    sessionId: string | null;
    enabled?: boolean;
}>): SessionManagedWorkflowRunsState {
    const sessionId = params.sessionId !== null && params.sessionId.trim().length > 0 ? params.sessionId : null;
    const enabled = params.enabled ?? true;
    const activeAccountScope = useActiveServerAccountScope();
    const accountScopeKey = activeAccountScope === null ? null : serverAccountScopeKeySuffix(activeAccountScope);
    const [listWindow, setWindow] = React.useState<SessionManagedWorkflowRunsWindow>(EMPTY_WINDOW);
    const [invalidationToken, setInvalidationToken] = React.useState(0);
    const current = listWindow.accountScopeKey === accountScopeKey && listWindow.sessionId === sessionId;
    // Only this Session's own window, never the Account's whole Run map: an
    // exact refresh of a Run this Session did not start must not rerender a
    // mounted transcript section.
    const rows = useWorkflowRunRows(current ? listWindow.runIds : EMPTY_RUN_IDS);
    const windowRef = React.useRef(listWindow);
    windowRef.current = listWindow;

    React.useEffect(() => {
        if (!enabled || sessionId === null) {
            setWindow(EMPTY_WINDOW);
            return;
        }
        // Decrypted Account content never survives a scope change: the lifetime
        // retires this read before another Account's rows could be applied.
        const lifetime = captureActiveServerAccountScopeLifetime();
        const requestScopeKey = accountScopeKey;
        const controller = new AbortController();
        let cancelled = false;
        // A re-read keeps last-known-good rows; only a first read is loading.
        setWindow((current) => (
            current.accountScopeKey === requestScopeKey && current.sessionId === sessionId && current.phase === 'loaded'
                ? current
                : { ...EMPTY_WINDOW, phase: 'loading', accountScopeKey: requestScopeKey, sessionId }
        ));
        void (async () => {
            try {
                const [all, attention] = await Promise.all([
                    listWorkflowRuns({
                        filter: { originSessionId: sessionId },
                        signal: controller.signal,
                    }),
                    listWorkflowRuns({
                        filter: { originSessionId: sessionId, attention: 'required' },
                        signal: controller.signal,
                    }),
                ]);
                if (cancelled || (lifetime !== null && !lifetime.isCurrent())) return;
                // Both pages' bodies land in the one Account-scoped row owner,
                // so an off-page actionable Run is the same body the exact Run
                // route resolves rather than a second, thinner copy.
                getStorage().getState().upsertWorkflowRuns([
                    ...all.runs.map((run) => workflowRunRowFromSummary(run, all.metadataByRunId[run.id] ?? null)),
                    ...attention.runs.map((run) => workflowRunRowFromSummary(
                        run,
                        attention.metadataByRunId[run.id] ?? null,
                    )),
                ]);
                setWindow({
                    phase: 'loaded',
                    accountScopeKey: requestScopeKey,
                    sessionId,
                    runIds: unionRunIds(
                        all.runs.map((run) => run.id),
                        attention.runs.map((run) => run.id),
                    ),
                    attentionRunIds: new Set(attention.runs.map((run) => run.id)),
                    refreshFailed: false,
                });
            } catch {
                if (cancelled || (lifetime !== null && !lifetime.isCurrent())) return;
                // A failed refresh is not evidence that the Session started
                // nothing: the window keeps the membership it already proved
                // and reports staleness beside it.
                setWindow((current) => (
                    current.accountScopeKey === requestScopeKey
                        && current.sessionId === sessionId
                        && current.phase === 'loaded'
                        ? { ...current, refreshFailed: true }
                        : {
                            ...EMPTY_WINDOW,
                            phase: 'failed',
                            refreshFailed: true,
                            accountScopeKey: requestScopeKey,
                            sessionId,
                        }
                ));
            }
        })();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [accountScopeKey, enabled, invalidationToken, sessionId]);

    React.useEffect(() => {
        if (!enabled || sessionId === null) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        return subscribeVisibleWorkflowRunListInvalidation({
            lifetime,
            isVisibleWindowLoaded: () => windowRef.current.phase === 'loaded'
                && windowRef.current.sessionId === sessionId,
            invalidate: () => setInvalidationToken((token) => token + 1),
        });
    }, [accountScopeKey, enabled, sessionId]);

    const runs = React.useMemo(
        () => (rows.length === 0 ? EMPTY_RUNS : rows.flatMap((row) => (row.summary ? [row.summary] : []))),
        [rows],
    );
    const metadataByRunId = React.useMemo(() => {
        const entries = rows.flatMap((row) => (row.metadata ? [[row.id, row.metadata] as const] : []));
        return entries.length === 0 ? EMPTY_METADATA : Object.fromEntries(entries);
    }, [rows]);

    const phase: SessionManagedWorkflowRunsState['phase'] = current
        ? listWindow.phase
        : sessionId === null || !enabled ? 'idle' : 'loading';
    const attentionRunIds = current ? listWindow.attentionRunIds : EMPTY_ATTENTION;
    const refreshFailed = current ? listWindow.refreshFailed : false;
    // One stable state object per change, as the consumers that memoize on it expect.
    return React.useMemo(
        () => ({ phase, runs, metadataByRunId, attentionRunIds, refreshFailed }),
        [attentionRunIds, metadataByRunId, phase, refreshFailed, runs],
    );
}
