import * as React from 'react';
import type { SystemTaskResult } from '@happier-dev/protocol';

import { buildLocalMachineSetupSystemTaskSpec } from './buildLocalMachineSetupSystemTaskSpec';
import {
    readTokenOnlyAuthRequestPrompt,
    respondToTokenOnlyAuthRequestPrompt,
    type SystemTaskAuthRequestApproval,
} from './approveSystemTaskAuthRequestPrompt';
import { getSystemTasksRunner } from './systemTasksRuntime';
import { useSystemTaskSnapshot } from './useSystemTaskSnapshot';
import type { SystemTaskRunState, SystemTaskRunner } from './types';
import type { SystemTaskSpec } from '@happier-dev/protocol';

export type ThisComputerSetupFollowUp = 'auth' | null;

export function resolveThisComputerSetupFollowUp(result: SystemTaskResult | null): ThisComputerSetupFollowUp {
    if (!result || result.ok) {
        return null;
    }
    if (result.error.code === 'not_authenticated') {
        return 'auth';
    }
    return null;
}

export function useThisComputerSetupTask(options: Readonly<{
    runner?: SystemTaskRunner;
    autoStart?: boolean;
    onNeedsAuth?: () => void;
    onSucceeded?: (snapshot: SystemTaskRunState) => void;
    /** When set, blocking token-only pairing prompts are answered through the explicit endpoint. */
    authRequestApproval?: SystemTaskAuthRequestApproval;
}> = {}) {
    const runner = options.runner ?? getSystemTasksRunner();
    const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
    const [isStarting, setIsStarting] = React.useState(false);
    const [startError, setStartError] = React.useState<string | null>(null);
    const activeTaskSnapshot = useSystemTaskSnapshot(runner, activeTaskId);
    const autoStartAttemptedRef = React.useRef(false);
    const handledResultTaskIdRef = React.useRef<string | null>(null);

    const start = React.useCallback(async (specOverride?: SystemTaskSpec) => {
        setIsStarting(true);
        setStartError(null);
        try {
            const taskId = await runner.start(specOverride ?? buildLocalMachineSetupSystemTaskSpec());
            handledResultTaskIdRef.current = null;
            setActiveTaskId(taskId);
            return taskId;
        } catch (error) {
            setStartError(error instanceof Error ? error.message : 'system_task_start_failed');
            throw error;
        } finally {
            setIsStarting(false);
        }
    }, [runner]);

    const cancel = React.useCallback(() => {
        if (!activeTaskId) {
            return;
        }
        void runner.cancel(activeTaskId);
    }, [activeTaskId, runner]);

    React.useEffect(() => {
        if (!options.autoStart || autoStartAttemptedRef.current || activeTaskId) {
            return;
        }
        autoStartAttemptedRef.current = true;
        void start().catch(() => {});
    }, [activeTaskId, options.autoStart, start]);

    // Answers blocking token-only pairing prompts through the explicit target endpoint. The
    // prompt's target identity is validated against the expected Home before any credential is
    // read, and the answer itself never carries credential material. The three-argument runner
    // subscription replays already-recorded events, so a prompt emitted between runner.start()
    // and this subscription is still delivered here; the signature set keeps handling
    // exactly-once across replays.
    const expectedRelayUrl = options.authRequestApproval?.expectedRelayUrl;
    const approvalServerId = options.authRequestApproval?.serverId;
    const handledApprovalPromptSignaturesRef = React.useRef(new Set<string>());
    React.useEffect(() => {
        if (!activeTaskId || !expectedRelayUrl) {
            return;
        }
        const handled = handledApprovalPromptSignaturesRef.current;
        return runner.subscribe(
            activeTaskId,
            (event) => {
                const prompt = readTokenOnlyAuthRequestPrompt(event);
                if (!prompt) {
                    return;
                }
                const signature = `${event.taskId}:${event.tsMs}:${prompt.publicKey}:${prompt.response}`;
                if (handled.has(signature)) {
                    return;
                }
                handled.add(signature);
                void respondToTokenOnlyAuthRequestPrompt({
                    prompt,
                    approval: {
                        expectedRelayUrl,
                        ...(approvalServerId ? { serverId: approvalServerId } : {}),
                    },
                    respond: (answer) => runner.respond(activeTaskId, answer),
                });
            },
            () => {},
        );
    }, [activeTaskId, approvalServerId, expectedRelayUrl, runner]);

    React.useEffect(() => {
        if (!activeTaskSnapshot?.result) {
            return;
        }
        if (handledResultTaskIdRef.current === activeTaskSnapshot.taskId) {
            return;
        }

        handledResultTaskIdRef.current = activeTaskSnapshot.taskId;
        if (activeTaskSnapshot.result.ok) {
            options.onSucceeded?.(activeTaskSnapshot);
            return;
        }

        const followUp = resolveThisComputerSetupFollowUp(activeTaskSnapshot.result);
        if (followUp === 'auth') {
            options.onNeedsAuth?.();
            return;
        }
    }, [activeTaskSnapshot, options]);

    const completedMachineId = React.useMemo(() => {
        if (!activeTaskSnapshot?.result?.ok) {
            return null;
        }
        const machineId = (activeTaskSnapshot.result.data as { machineId?: unknown } | undefined)?.machineId;
        return typeof machineId === 'string' && machineId.trim().length > 0 ? machineId.trim() : null;
    }, [activeTaskSnapshot]);

    return {
        activeTaskId,
        activeTaskSnapshot,
        cancel,
        completedMachineId,
        isStarting,
        runner,
        start,
        startError,
    };
}
