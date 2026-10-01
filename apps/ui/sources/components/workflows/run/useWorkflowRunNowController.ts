import React from 'react';

import {
    WorkflowRunStartRequestV1Schema,
    WorkflowRunStartResultV1Schema,
    type WorkflowRunStartRequestV1,
    type WorkflowRunStartResultV1,
    type WorkflowProjectTargetV1,
} from '@happier-dev/protocol';

import { resolveWorkflowProblemPresentation } from '@/components/workflows/presentation/workflowProblemPresentation';
import { Modal } from '@/modal';
import {
    useTransientCommandAcknowledgement,
    type TransientCommandState,
} from '@/hooks/ui/useTransientCommandAcknowledgement';
import { storage } from '@/sync/domains/state/storageStore';
import { callWorkflowAction } from '@/sync/domains/workflows/callWorkflowAction';
import { workflowRunRowFromSummary } from '@/sync/store/domains/workflowRuns';

import { projectAcceptedWorkflowRunTarget } from './projectAcceptedWorkflowRunTarget';

/**
 * Transient command state for one **Run now** press.
 *
 * `acknowledged` means the server accepted the admission — it is not a Run
 * state. Whether that Run is queued, running, waiting for an approval or
 * already finished is read from the canonical Run projection, never inferred
 * from this vocabulary. The machine itself is the shared transient-command
 * owner, so this press and the Automation one cannot drift apart.
 */
export type WorkflowRunNowState = TransientCommandState;

export type WorkflowRunNowRequest = Readonly<{
    /**
     * The Run UUID the **caller** allocated for this explicit admission attempt.
     *
     * Allocation belongs to the press, not to this controller: a response-loss
     * recovery re-invokes `runNow` with the identical `runId`, so the server
     * settles the same Run and answers `admission: 'existing'`. A deliberate
     * "Run again" is a different press with a new id, and is the caller's
     * decision because it repeats real effects.
     */
    runId: string;
    source: WorkflowRunStartRequestV1['source'];
    metadata?: WorkflowRunStartRequestV1['metadata'];
    /** Declared-input values collected by the input sheet, in the Protocol shape. */
    inputs?: WorkflowRunStartRequestV1['inputs'];
    /**
     * Run-wide runtime choice. Session is the protocol default and is omitted
     * on the wire so older/current callers retain the same canonical shape.
     */
    executionTarget?: WorkflowRunStartRequestV1['executionTarget'];
    onComplete?: WorkflowRunStartRequestV1['onComplete'];
    /** Exact page-selected project, stamped as host context rather than Action input. */
    project?: WorkflowProjectTargetV1;
    /**
     * The invoking session, stamped as host context `defaultSessionId`: FIN's one origin producer
     * records it as the Run's `origin.originSessionId` (`origin_session` steps, result delivery).
     */
    originSessionId?: string;
    /** Whether the pressing surface is still mounted/current, for error presentation only. */
    isInvocationCurrent?: () => boolean;
}>;

export type WorkflowRunNowController = Readonly<{
    stateFor: (runId: string) => WorkflowRunNowState;
    /**
     * Admits the reviewed draft and returns the exact admitted handle, so the
     * caller navigates to the Run the server settled rather than guessing it
     * from the newest history row. `null` means nothing was admitted by this
     * call: no active Account, an admission already in flight for this id, a
     * retired Account scope, or a failure that was surfaced to the user.
     */
    runNow: (request: WorkflowRunNowRequest) => Promise<WorkflowRunStartResultV1 | null>;
}>;

async function startWorkflowRun(request: WorkflowRunNowRequest): Promise<WorkflowRunStartResultV1> {
    const input = WorkflowRunStartRequestV1Schema.parse({
        runId: request.runId,
        source: request.source,
        ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
        ...(request.executionTarget === undefined || request.executionTarget.kind === 'session'
            ? {}
            : { executionTarget: request.executionTarget }),
        ...(request.onComplete === undefined ? {} : { onComplete: request.onComplete }),
    });
    // Dispatch and failure mapping stay at the one shared workflow Action seam.
    const result = await callWorkflowAction({
        actionId: 'workflow.run.start',
        input,
        parseResult: (value) => WorkflowRunStartResultV1Schema.parse(value),
        fallbackMessage: 'Workflow run request failed',
        ...(request.project === undefined && request.originSessionId === undefined
            ? {}
            : { context: {
                ...(request.originSessionId === undefined ? {} : { defaultSessionId: request.originSessionId }),
                ...(request.project === undefined ? {} : { externalActionTarget: {
                    kind: 'machine' as const,
                    machineId: request.project.machineId,
                    project: projectAcceptedWorkflowRunTarget(request.project),
                } }),
            } }),
    });
    return result;
}

/**
 * The UI admission owner for `workflow.run.start`.
 *
 * It owns one thing: turning an explicit press into exactly one canonical
 * admission and handing back the Run the server settled. The admitted body is
 * merged into the existing Account-scoped Run row map so the exact route can
 * open it immediately; this controller keeps no Run cache, no polling and no
 * Run-state interpretation of its own.
 */
export function useWorkflowRunNowController(): WorkflowRunNowController {
    const command = useTransientCommandAcknowledgement<WorkflowRunStartResultV1>('workflow.runNow');

    return React.useMemo(() => ({
        stateFor: command.stateFor,
        // A second press while the first is still unsettled is the same intent,
        // not a second Run: the identical `runId` is already in flight.
        runNow: async (request) => await command.run({
            commandId: request.runId,
            submit: () => startWorkflowRun(request),
            // Merged into the existing Account-scoped Run row map only while
            // the pressing Account is still active, so the exact route can open
            // the settled Run immediately.
            onAccepted: (result) => {
                storage.getState().upsertWorkflowRuns([workflowRunRowFromSummary(
                    result.run,
                    request.metadata ? { kind: 'available', value: request.metadata } : null,
                )]);
            },
            ...(request.isInvocationCurrent
                ? { isInvocationCurrent: request.isInvocationCurrent }
                : {}),
            onError: async (error) => {
                // The Automation formatter knows no workflow code, so every
                // admission refusal — no access, a conflicting rejoin, a
                // definition that needs repair — read as one generic sentence.
                const problem = resolveWorkflowProblemPresentation(error);
                await Modal.alert(problem.title, problem.message);
            },
        }),
    }), [command]);
}
