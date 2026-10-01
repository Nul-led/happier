import * as React from 'react';

import { resolveWorkflowProblemPresentation } from '@/components/workflows/presentation/workflowProblemPresentation';
import {
    addSessionTrigger,
    listSessionTriggerSets,
    removeSessionTrigger,
    updateSessionTrigger,
    type WorkflowTriggerWriteResult,
} from '@/sync/domains/workflows/workflowTriggerActions';

import {
    KEEP_GOING_DEFAULT_INPUTS,
    areKeepGoingInputsValid,
    buildKeepGoingTriggerAddRequest,
    readKeepGoingAttachment,
    type KeepGoingAttachment,
    type KeepGoingInputs,
} from './sessionGoalContinuation';

/** Where the Goal control acts: the session, and the machine whose daemon owns its triggers. */
export type SessionGoalContinuationTarget = Readonly<{
    sessionId: string;
    machineId: string | null;
}>;

export type SessionKeepGoingTrigger = Readonly<{
    phase: 'idle' | 'loading' | 'loaded' | 'failed';
    attachment: KeepGoingAttachment | null;
    /** The fields as the person left them: the attachment's inputs, or the built-in's prefilled values. */
    inputs: Readonly<{ maxRounds: number | undefined; strikes: number | undefined; secondOpinion: boolean }>;
    /** The switch value: a pending change shows what was asked until the owner answers. */
    on: boolean;
    busy: boolean;
    /** The owner's typed refusal of the last write, worded by the workflow problem owner. */
    error: string | null;
    setOn: (on: boolean) => void;
    setInputs: (patch: Partial<Readonly<{ maxRounds: number | undefined; strikes: number | undefined; secondOpinion: boolean }>>) => void;
    /** Removes the attached trigger (clearing the goal, R-M9). Resolves false when nothing was removed. */
    detach: () => Promise<boolean>;
}>;

function setFromWrite(result: WorkflowTriggerWriteResult): KeepGoingAttachment | null {
    return readKeepGoingAttachment([result.set]);
}

/**
 * The session's Keep going trigger, read through `session.trigger.list` only while the Goal control is
 * open (`enabled`), and written through `session.trigger.add | update | remove` — each change an
 * immediate call with its own result; a session has no Save (04 §5.5). There is no local trigger store.
 */
export function useSessionKeepGoingTrigger(params: Readonly<{
    target: SessionGoalContinuationTarget | null;
    enabled: boolean;
}>): SessionKeepGoingTrigger {
    const sessionId = params.target?.sessionId ?? null;
    const machineId = params.target?.machineId ?? null;
    const [phase, setPhase] = React.useState<SessionKeepGoingTrigger['phase']>('idle');
    const [attachment, setAttachment] = React.useState<KeepGoingAttachment | null>(null);
    const [inputs, setInputsState] = React.useState<SessionKeepGoingTrigger['inputs']>(KEEP_GOING_DEFAULT_INPUTS);
    const [pendingOn, setPendingOn] = React.useState<boolean | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const attachmentRef = React.useRef(attachment);
    attachmentRef.current = attachment;
    // Field writes are serialized: one in flight, and only the newest waiting value follows it.
    const inputWriteRef = React.useRef<{ inFlight: boolean; next: KeepGoingInputs | null }>({ inFlight: false, next: null });

    const options = React.useMemo(() => ({
        context: machineId ? { externalActionTarget: { kind: 'machine' as const, machineId } } : {},
    }), [machineId]);

    React.useEffect(() => {
        if (!params.enabled || !sessionId) return;
        const controller = new AbortController();
        setPhase('loading');
        listSessionTriggerSets({ sessionId }, { ...options, signal: controller.signal })
            .then((sets) => {
                if (controller.signal.aborted) return;
                const read = readKeepGoingAttachment(sets);
                setAttachment(read);
                setInputsState(read?.inputs ?? KEEP_GOING_DEFAULT_INPUTS);
                setPhase('loaded');
            })
            .catch(() => {
                if (!controller.signal.aborted) setPhase('failed');
            });
        return () => controller.abort();
    }, [options, params.enabled, sessionId]);

    const fail = React.useCallback((cause: unknown) => {
        setError(resolveWorkflowProblemPresentation(cause).message);
    }, []);

    const setOn = React.useCallback((on: boolean) => {
        if (!sessionId || busy) return;
        const current = attachmentRef.current;
        const complete = {
            maxRounds: inputs.maxRounds ?? Number.NaN,
            strikes: inputs.strikes ?? Number.NaN,
            secondOpinion: inputs.secondOpinion,
        };
        if (on && !areKeepGoingInputsValid(complete)) return;
        setError(null);
        setPendingOn(on);
        setBusy(true);
        const write = !on
            ? (current ? removeSessionTrigger({ sessionId, triggerId: current.triggerId }, options).then(() => null) : Promise.resolve(null))
            : current
                ? updateSessionTrigger({
                    sessionId,
                    triggerId: current.triggerId,
                    expectedRevision: current.revision,
                    patch: { enabled: true, inputs: complete },
                }, options).then(setFromWrite)
                : addSessionTrigger(buildKeepGoingTriggerAddRequest(sessionId, complete), options).then(setFromWrite);
        void write
            .then((next) => setAttachment(next))
            .catch(fail)
            .finally(() => {
                setPendingOn(null);
                setBusy(false);
            });
    }, [busy, fail, inputs, options, sessionId]);

    const writeInputs = React.useCallback((next: KeepGoingInputs) => {
        const queue = inputWriteRef.current;
        if (queue.inFlight) {
            queue.next = next;
            return;
        }
        const current = attachmentRef.current;
        if (!sessionId || !current?.enabled) return;
        queue.inFlight = true;
        void updateSessionTrigger({
            sessionId,
            triggerId: current.triggerId,
            expectedRevision: current.revision,
            patch: { inputs: next },
        }, options)
            .then((result) => {
                const written = setFromWrite(result);
                attachmentRef.current = written;
                setAttachment(written);
            })
            .catch(fail)
            .finally(() => {
                queue.inFlight = false;
                const waiting = queue.next;
                queue.next = null;
                if (waiting) writeInputs(waiting);
            });
    }, [fail, options, sessionId]);

    const inputsRef = React.useRef(inputs);
    inputsRef.current = inputs;
    const setInputs = React.useCallback<SessionKeepGoingTrigger['setInputs']>((patch) => {
        const next = { ...inputsRef.current, ...patch };
        inputsRef.current = next;
        setInputsState(next);
        const complete = {
            maxRounds: next.maxRounds ?? Number.NaN,
            strikes: next.strikes ?? Number.NaN,
            secondOpinion: next.secondOpinion,
        };
        // A field that does not name a whole number yet is shown with its repair and not written.
        if (areKeepGoingInputsValid(complete)) writeInputs(complete);
    }, [writeInputs]);

    const detach = React.useCallback(async (): Promise<boolean> => {
        const current = attachmentRef.current;
        if (!sessionId || !current) return false;
        try {
            await removeSessionTrigger({ sessionId, triggerId: current.triggerId }, options);
            attachmentRef.current = null;
            setAttachment(null);
            return true;
        } catch (cause) {
            fail(cause);
            return false;
        }
    }, [fail, options, sessionId]);

    return {
        phase,
        attachment,
        inputs,
        on: pendingOn ?? attachment?.enabled === true,
        busy,
        error,
        setOn,
        setInputs,
        detach,
    };
}
