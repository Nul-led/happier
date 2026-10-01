import * as React from 'react';

import { useWorkflowsAvailability } from '@/components/workflows/gating/workflowsAvailability';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { getStorage, useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { buildWorkflowRunListFilter, listWorkflowRuns } from '@/sync/domains/workflows/workflowRunListActions';
import { subscribeVisibleWorkflowRunListInvalidation } from '@/sync/domains/workflows/workflowRunListInvalidation';

/**
 * The Inbox's workflow input (ORC R-10; FIN 03 §6.4).
 *
 * Workflow attention has one owner: the server's `attention: 'required'` predicate, held on the
 * client in the canonical `workflowRunListWindows.attention` window that the Workflows column's
 * Needs you also reads. This owner only keeps that window loaded while the app shell is mounted, so
 * the rail badge and the Inbox can count and group it; it decides no attention of its own and keeps
 * no second run store.
 *
 * A failed refresh keeps the rows it already proved (last known) and says so once through
 * `refreshFailed` + `knownAt`; only a first read with nothing known is `failed`.
 */
export type WorkflowAttentionSource = Readonly<{
    /** Workflows are offered on this Home; when false the source is empty and never read. */
    available: boolean;
    phase: 'idle' | 'loading' | 'loaded' | 'failed';
    /** The attention window's membership for the current Account, in server order. */
    runIds: readonly string[];
    refreshFailed: boolean;
    /** Epoch ms of the last successful read, for "Showing what was known at …". */
    knownAt: number | null;
    retry: () => void;
}>;

const EMPTY_RUN_IDS: readonly string[] = Object.freeze([]);
const NOOP = () => {};

export const EMPTY_WORKFLOW_ATTENTION_SOURCE: WorkflowAttentionSource = Object.freeze({
    available: false,
    phase: 'idle',
    runIds: EMPTY_RUN_IDS,
    refreshFailed: false,
    knownAt: null,
    retry: NOOP,
});

type ReadState = Readonly<{
    accountScopeKey: string | null;
    phase: WorkflowAttentionSource['phase'];
    refreshFailed: boolean;
    knownAt: number | null;
}>;

const IDLE_READ: ReadState = { accountScopeKey: null, phase: 'idle', refreshFailed: false, knownAt: null };

function useCreateWorkflowAttentionSource(): WorkflowAttentionSource {
    const workflows = useWorkflowsAvailability();
    const available = workflows.available;
    const activeAccountScope = useActiveServerAccountScope();
    const accountScopeKey = activeAccountScope === null ? null : serverAccountScopeKeySuffix(activeAccountScope);
    const [read, setRead] = React.useState<ReadState>(IDLE_READ);
    const [token, setToken] = React.useState(0);
    const readRef = React.useRef(read);
    readRef.current = read;
    const current = available && read.accountScopeKey === accountScopeKey;
    // Membership only — never the Account's Run map — so a Run update this window does not
    // contain cannot rerender the badge.
    const window = getStorage()((state) => state.workflowRunListWindows?.attention);
    const runIds = current && read.phase === 'loaded' && window?.loaded === true ? window.runIds : EMPTY_RUN_IDS;

    React.useEffect(() => {
        if (!available) {
            setRead(IDLE_READ);
            return;
        }
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        const requestScopeKey = accountScopeKey;
        const controller = new AbortController();
        let cancelled = false;
        setRead((previous) => (
            previous.accountScopeKey === requestScopeKey && previous.phase === 'loaded'
                ? previous
                : { ...IDLE_READ, accountScopeKey: requestScopeKey, phase: 'loading' }
        ));
        void (async () => {
            try {
                const page = await listWorkflowRuns({
                    filter: buildWorkflowRunListFilter('attention'),
                    signal: controller.signal,
                });
                if (cancelled || !lifetime.isCurrent()) return;
                const loadedForScope = readRef.current.accountScopeKey === requestScopeKey
                    && readRef.current.phase === 'loaded'
                    && getStorage().getState().workflowRunListWindows?.attention?.loaded === true;
                getStorage().getState().applyWorkflowRunListPage({
                    windowId: 'attention',
                    runs: page.runs,
                    metadataByRunId: page.metadataByRunId,
                    nextCursor: page.nextCursor ?? null,
                    mode: loadedForScope ? 'refresh' : 'replace',
                });
                setRead({ accountScopeKey: requestScopeKey, phase: 'loaded', refreshFailed: false, knownAt: Date.now() });
            } catch {
                if (cancelled || !lifetime.isCurrent()) return;
                setRead((previous) => (
                    previous.accountScopeKey === requestScopeKey && previous.phase === 'loaded'
                        ? { ...previous, refreshFailed: true }
                        : { ...IDLE_READ, accountScopeKey: requestScopeKey, phase: 'failed', refreshFailed: true }
                ));
            }
        })();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [accountScopeKey, available, token]);

    React.useEffect(() => {
        if (!available) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        return subscribeVisibleWorkflowRunListInvalidation({
            lifetime,
            isVisibleWindowLoaded: () => readRef.current.phase === 'loaded' || readRef.current.phase === 'failed',
            invalidate: () => setToken((value) => value + 1),
        });
    }, [accountScopeKey, available]);

    const retry = React.useCallback(() => setToken((value) => value + 1), []);
    const phase: WorkflowAttentionSource['phase'] = !available ? 'idle' : current ? read.phase : 'loading';
    const refreshFailed = current ? read.refreshFailed : false;
    const knownAt = current ? read.knownAt : null;
    return React.useMemo(
        () => ({ available, phase, runIds, refreshFailed, knownAt, retry }),
        [available, knownAt, phase, refreshFailed, retry, runIds],
    );
}

const WorkflowAttentionSourceContext = React.createContext<WorkflowAttentionSource | null>(null);

/** Mounted once by the app shell's Inbox summary owner. */
export function WorkflowAttentionSourceProvider(props: Readonly<{ children: React.ReactNode }>) {
    const source = useCreateWorkflowAttentionSource();
    return (
        <WorkflowAttentionSourceContext.Provider value={source}>
            {props.children}
        </WorkflowAttentionSourceContext.Provider>
    );
}

/**
 * A no-op beneath the shell's owner; an isolated Inbox (tests, stories) mounts its own, so there is
 * never a second loader under the shell.
 */
export function WorkflowAttentionSourceBoundary(props: Readonly<{ children: React.ReactNode }>) {
    const existing = React.useContext(WorkflowAttentionSourceContext);
    if (existing) return <>{props.children}</>;
    return <WorkflowAttentionSourceProvider>{props.children}</WorkflowAttentionSourceProvider>;
}

export function useWorkflowAttentionSource(): WorkflowAttentionSource {
    return React.useContext(WorkflowAttentionSourceContext) ?? EMPTY_WORKFLOW_ATTENTION_SOURCE;
}
