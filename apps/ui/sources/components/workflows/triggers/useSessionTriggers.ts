import * as React from 'react';
import type { SessionTriggerAddRequestV1, SessionTriggerUpdateRequestV1, WorkflowTriggerSetV1 } from '@happier-dev/protocol';

import { getStorage } from '@/sync/domains/state/storage';
import { createWorkflowTriggerChangeSelector, createWorkflowTriggerSetSelector } from '@/sync/store/domains/automations';
import {
    addSessionTrigger,
    listSessionTriggerSets,
    removeSessionTrigger,
    updateSessionTrigger,
    type WorkflowTriggerWriteResult,
} from '@/sync/domains/workflows/workflowTriggerActions';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';

export type SessionTriggersRead = Readonly<{
    status: 'loading' | 'ready' | 'failed';
    /** The last sets the owner returned; kept while a refresh or a failed read is pending. */
    sets: readonly WorkflowTriggerSetV1[];
    lastRunAtByAutomationId: Readonly<Record<string, number | null>>;
    /** The session's Machine, used for native capability observations and Action options. */
    machineId: string | null;
    retry: () => void;
    add: (request: Omit<SessionTriggerAddRequestV1, 'sessionId'>) => Promise<WorkflowTriggerWriteResult>;
    update: (request: Omit<SessionTriggerUpdateRequestV1, 'sessionId'>) => Promise<WorkflowTriggerWriteResult>;
    remove: (triggerId: string) => Promise<WorkflowTriggerWriteResult>;
}>;

/**
 * A session's triggers through `session.trigger.list | add | update | remove` (03 §5.4, §5.7), on the
 * Account: the one writer the Work tab and agents share. Each change is an immediate
 * call with its own result (a session has no Save); observations land in the shared store.
 *
 * The Account's Automation projection is only a change signal here: when the session's scoped rows
 * change (an agent added a trigger, a run finished) the list is read again; its `lastRunAt` gives
 * each row its last outcome.
 */
export function useSessionTriggers(sessionId: string): SessionTriggersRead {
    const selector = React.useMemo(() => createWorkflowTriggerSetSelector(`session:${sessionId}`), [sessionId]);
    const sets = getStorage()(selector);
    const changeSelector = React.useMemo(() => createWorkflowTriggerChangeSelector(sessionId), [sessionId]);
    const changeSignal = getStorage()(changeSelector);
    const lastRunAtByAutomationId = React.useMemo(
        () => Object.fromEntries(Object.values(getStorage().getState().automations)
            .filter((automation) => automation.scopeSessionId === sessionId)
            .map((automation) => [automation.id, automation.lastRunAt])),
        [changeSignal, sessionId],
    );

    const [state, setState] = React.useState<Readonly<{ sessionId: string; status: SessionTriggersRead['status'] }>>(
        () => ({ sessionId, status: 'loading' }),
    );
    const [attempt, setAttempt] = React.useState(0);
    const options = React.useCallback(() => {
        const machineId = readMachineControlTargetForSession(sessionId)?.machineId;
        return machineId ? { context: { externalActionTarget: { kind: 'machine' as const, machineId } } } : {};
    }, [sessionId]);

    React.useEffect(() => {
        const controller = new AbortController();
        setState((current) => (current.sessionId === sessionId ? current : { sessionId, status: 'loading' }));
        listSessionTriggerSets({ sessionId }, { ...options(), signal: controller.signal })
            .then(() => {
                if (!controller.signal.aborted) setState({ sessionId, status: 'ready' });
            })
            .catch(() => {
                if (!controller.signal.aborted) setState((current) => ({ ...current, sessionId, status: 'failed' }));
            });
        return () => controller.abort();
    }, [attempt, changeSignal, options, sessionId]);

    const applyWrite = React.useCallback((result: WorkflowTriggerWriteResult) => {
        setState((current) => (current.sessionId === sessionId
            ? { ...current, status: 'ready' }
            : current));
        return result;
    }, [sessionId]);

    const add = React.useCallback<SessionTriggersRead['add']>(
        async (request) => applyWrite(await addSessionTrigger({ ...request, sessionId }, options())),
        [applyWrite, options, sessionId],
    );
    const update = React.useCallback<SessionTriggersRead['update']>(
        async (request) => applyWrite(await updateSessionTrigger({ ...request, sessionId }, options())),
        [applyWrite, options, sessionId],
    );
    const remove = React.useCallback<SessionTriggersRead['remove']>(
        async (triggerId) => applyWrite(await removeSessionTrigger({ sessionId, triggerId }, options())),
        [applyWrite, options, sessionId],
    );
    const retry = React.useCallback(() => setAttempt((value) => value + 1), []);

    const owned = state.sessionId === sessionId;
    return {
        machineId: readMachineControlTargetForSession(sessionId)?.machineId ?? null,
        status: owned ? state.status : 'loading',
        sets,
        lastRunAtByAutomationId,
        retry,
        add,
        update,
        remove,
    };
}
