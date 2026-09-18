import * as React from 'react';
import type { SystemTaskResult } from '@happier-dev/protocol';

import type { SystemTaskAuthRequestApproval } from './approveSystemTaskAuthRequestPrompt';
import { useSystemTaskAuthRequestApproval } from './useSystemTaskAuthRequestApproval';
import { readLatestSystemTaskPrompt } from './prompts/readLatestSystemTaskPrompt';
import { getSystemTasksRunner } from './systemTasksRuntime';
import { useThisComputerSetupPromptModals } from './thisComputerSetup/useThisComputerSetupPromptModals';
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
    const handledResultTaskIdRef = React.useRef<string | null>(null);

    const start = React.useCallback(async (spec: SystemTaskSpec) => {
        setIsStarting(true);
        setStartError(null);
        try {
            const taskId = await runner.start(spec);
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


    // Blocking token-only pairing prompts are answered by the one approval owner.
    useSystemTaskAuthRequestApproval({
        runner,
        taskId: activeTaskId,
        ...(options.authRequestApproval ? { approval: options.authRequestApproval } : {}),
    });

    // The service-consent prompts the setup kind raises before it mutates anything
    // (`releaseChannel.switchDefaultForSetup`, `daemon.takeOverManualRelayRuntimeForSetup`,
    // `daemon.replaceLocalBackgroundServices`) are blocking too: `ctx.prompt` is an unbounded
    // promise, so a starter with no responder leaves the run waiting forever with no affordance.
    // The responder therefore lives beside the approval owner here, so every starter of this hook
    // answers them — not only the surface that happened to mount the modal hook itself.
    const activeTaskPrompt = React.useMemo(
        () => readLatestSystemTaskPrompt(activeTaskSnapshot),
        [activeTaskSnapshot],
    );
    useThisComputerSetupPromptModals({
        runner,
        taskId: activeTaskId,
        snapshot: activeTaskSnapshot,
        prompt: activeTaskPrompt,
    });

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
