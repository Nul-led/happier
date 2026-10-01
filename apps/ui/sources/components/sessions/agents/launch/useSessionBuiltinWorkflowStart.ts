import * as React from 'react';
import { BUILTIN_WORKFLOW_CATALOG_V1, type JsonValue } from '@happier-dev/protocol';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useWorkflowRunComposerModal, type WorkflowRunComposerModalProps } from '@/components/workflows/run/useWorkflowRunComposerModal';
import { useWorkflowRunNowController } from '@/components/workflows/run/useWorkflowRunNowController';
import { randomUUID } from '@/platform/randomUUID';
import { tLoose } from '@/text';

type BuiltinWorkflowEntry = (typeof BUILTIN_WORKFLOW_CATALOG_V1)[number];

/**
 * The built-ins a session's "+" can start: those that run on their own beside it. A built-in that
 * runs inside a session (Keep going, Review & converge) needs that session as its run's origin;
 * the start below carries it, and offering those built-ins here is INT's decision.
 */
export const SESSION_STARTABLE_BUILTIN_WORKFLOWS: readonly BuiltinWorkflowEntry[] = BUILTIN_WORKFLOW_CATALOG_V1
    .filter((entry) => !entry.requiresOriginSession);

type PendingStart = Readonly<{
    entry: BuiltinWorkflowEntry;
    values: Readonly<Record<string, JsonValue | undefined>>;
    rawTextValues: Readonly<Record<string, string>>;
}>;

/**
 * Starts a built-in workflow from a session through FIN's run start (`workflow.run.start` with a
 * catalog source, on the session's machine and folder): its declared inputs are asked first in
 * FIN's input sheet, and the admitted Run opens. No second start path and no Run cache.
 */
export function useSessionBuiltinWorkflowStart(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
}>): (workflowId: string) => void {
    const router = useRouter();
    const target = useSessionMachineTarget(params.sessionId, params.serverId);
    const runNow = useWorkflowRunNowController();
    const [pending, setPending] = React.useState<PendingStart | null>(null);
    // One press is one admission: a retry after a lost response reuses the same Run id.
    const pendingRunIdRef = React.useRef<string | null>(null);
    const machineId = target?.machineId ?? null;
    const directory = target?.basePath ?? null;

    const admit = React.useCallback(async (
        entry: BuiltinWorkflowEntry,
        inputs: Readonly<Record<string, JsonValue>> | undefined,
    ) => {
        if (!machineId || !directory) return;
        const runId = pendingRunIdRef.current ?? randomUUID();
        pendingRunIdRef.current = runId;
        const admitted = await runNow.runNow({
            runId,
            source: { kind: 'catalog', workflow: entry.id },
            metadata: { title: tLoose(entry.titleKey) },
            ...(inputs === undefined ? {} : { inputs: { ...inputs } }),
            project: { machineId, directory },
            originSessionId: params.sessionId,
        });
        if (admitted === null) return;
        pendingRunIdRef.current = null;
        setPending(null);
        router.push({ pathname: '/workflows/runs/[runId]', params: { runId: admitted.run.id } } as never);
    }, [directory, machineId, params.sessionId, router, runNow]);

    const start = React.useCallback((workflowId: string) => {
        const entry = SESSION_STARTABLE_BUILTIN_WORKFLOWS.find((candidate) => candidate.id === workflowId);
        if (!entry || !machineId || !directory) return;
        pendingRunIdRef.current = null;
        // Declared inputs are collected before admission, in declaration order.
        if (entry.definition.inputs.length > 0) {
            setPending({ entry, values: {}, rawTextValues: {} });
            return;
        }
        void admit(entry, undefined);
    }, [admit, directory, machineId]);

    const cancel = React.useCallback(() => setPending(null), []);
    const changeValues = React.useCallback((values: PendingStart['values']) => {
        setPending((current) => current ? { ...current, values } : current);
    }, []);
    const changeRawTextValues = React.useCallback((rawTextValues: PendingStart['rawTextValues']) => {
        setPending((current) => current ? { ...current, rawTextValues } : current);
    }, []);
    const modalProps = React.useMemo<WorkflowRunComposerModalProps | null>(() => pending === null ? null : {
        inputs: pending.entry.definition.inputs,
        values: pending.values,
        onChangeValues: changeValues,
        rawTextValues: pending.rawTextValues,
        onChangeRawTextValues: changeRawTextValues,
        workflowName: tLoose(pending.entry.titleKey),
        preview: tLoose(pending.entry.descriptionKey),
        machineId,
        serverId: params.serverId ?? null,
        onRun: (inputs) => { void admit(pending.entry, inputs); },
        onCancel: cancel,
        pending: runNow.stateFor(pendingRunIdRef.current ?? '') === 'submitting',
    }, [admit, cancel, changeRawTextValues, changeValues, machineId, params.serverId, pending, runNow]);
    useWorkflowRunComposerModal({ open: pending !== null, props: modalProps });

    return start;
}
