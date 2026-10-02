import * as React from 'react';
import type { SystemTaskResult } from '@happier-dev/protocol';

import { readTokenOnlyAuthRequestPrompt, respondToTokenOnlyAuthRequestPrompt, type SystemTaskAuthRequestApproval } from './approveSystemTaskAuthRequestPrompt';
import { presentUnmanagedCliConsent } from './presentUnmanagedCliConsent';
import { getSystemTasksRunner } from './systemTasksRuntime';
import { answerThisComputerSetupPrompt } from './thisComputerSetup/answerThisComputerSetupPrompt';
import { areServerProfileIdentifiersEquivalent, resolveSavedServerProfileByUrl } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { useSystemTaskSnapshot } from './useSystemTaskSnapshot';
import type { SystemTaskPromptContinuation, SystemTaskRunState, SystemTaskRunner } from './types';
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

/** Captures the initiating Home; navigation never retargets a pending pairing request. */
export function createThisComputerSetupPromptContinuation(
    approval?: SystemTaskAuthRequestApproval,
    spec?: SystemTaskSpec,
): SystemTaskPromptContinuation {
    const params = spec?.params;
    const expectedAccountId = params !== null && typeof params === 'object' && !Array.isArray(params)
        && 'activeAccountId' in params && typeof params.activeAccountId === 'string'
        ? params.activeAccountId.trim() : approval?.expectedAccountId;
    const scopedApproval = approval ? { ...approval, ...(expectedAccountId ? { expectedAccountId } : {}) } : undefined;
    return async (prompt) => {
        const authPrompt = readTokenOnlyAuthRequestPrompt({ type: 'prompt', data: prompt.data });
        if (authPrompt) {
            if (!scopedApproval) return undefined;
            let answer: unknown;
            await respondToTokenOnlyAuthRequestPrompt({ prompt: authPrompt, approval: scopedApproval,
                confirmUnmanagedCli: presentUnmanagedCliConsent, respond: (next) => { answer = next; },
            });
            return answer;
        }
        return await answerThisComputerSetupPrompt(prompt);
    };
}

function matchesSetupApproval(spec: SystemTaskSpec | null, approval: SystemTaskAuthRequestApproval): boolean {
    if (!spec || (spec.kind !== 'setup.thisComputer.v1' && spec.kind !== 'setup.repairThisComputer.v1')) return false;
    const params = spec.params;
    if (params === null || typeof params !== 'object' || Array.isArray(params)) return false;
    const relayUrl = 'activeRelayUrl' in params && typeof params.activeRelayUrl === 'string' ? params.activeRelayUrl : '';
    const identity = 'activeServerIdentityId' in params && typeof params.activeServerIdentityId === 'string'
        ? params.activeServerIdentityId : null;
    const accountId = 'activeAccountId' in params && typeof params.activeAccountId === 'string' ? params.activeAccountId : null;
    const urlProfile = identity ? null : resolveSavedServerProfileByUrl(relayUrl, { includeCanonicalServerUrl: true });
    const matchesHome = identity
        ? identity === approval.serverId || areServerProfileIdentifiersEquivalent(identity, approval.serverId)
        : approval.serverId
            ? urlProfile?.kind === 'resolved' && areServerProfileIdentifiersEquivalent(urlProfile.profile.id, approval.serverId)
            : urlProfile?.kind !== 'ambiguous';
    return Boolean(relayUrl) && createServerUrlComparableKey(relayUrl) === createServerUrlComparableKey(approval.expectedRelayUrl)
        && matchesHome
        && accountId === (approval.expectedAccountId ?? null);
}

export function useThisComputerSetupTask(options: Readonly<{
    runner?: SystemTaskRunner;
    /** A presenter-owned handle; otherwise adopt this runner's continued setup for the explicit Home. */
    taskId?: string | null;
    onTaskIdChange?: (taskId: string | null) => void;
    onNeedsAuth?: () => void;
    onSucceeded?: (snapshot: SystemTaskRunState) => void;
    /** When set, blocking token-only pairing prompts are answered through the explicit endpoint. */
    authRequestApproval?: SystemTaskAuthRequestApproval;
}> = {}) {
    const runner = options.runner ?? getSystemTasksRunner();
    const [localTaskId, setLocalTaskId] = React.useState<string | null>(() => {
        const approval = options.authRequestApproval;
        if (!approval || options.taskId !== undefined) return null;
        return runner.listPromptContinuations?.().find(({ spec }) => matchesSetupApproval(spec, approval))?.taskId ?? null;
    });
    const approval = options.authRequestApproval;
    const activeTaskId = options.taskId === undefined
        ? localTaskId && approval && !matchesSetupApproval(runner.getTaskSpec?.(localTaskId) ?? null, approval) ? null : localTaskId
        : options.taskId;
    React.useEffect(() => {
        if (options.taskId !== undefined || !approval) return;
        setLocalTaskId((current) => current && matchesSetupApproval(runner.getTaskSpec?.(current) ?? null, approval)
            ? current : runner.listPromptContinuations?.().find(({ spec }) => matchesSetupApproval(spec, approval))?.taskId ?? null);
    }, [runner, options.taskId, approval?.expectedRelayUrl, approval?.serverId, approval?.expectedAccountId]);
    const setActiveTaskId = React.useCallback((taskId: string | null) => {
        setLocalTaskId(taskId);
        options.onTaskIdChange?.(taskId);
    }, [options.onTaskIdChange]);
    const [isStarting, setIsStarting] = React.useState(false);
    const [startError, setStartError] = React.useState<string | null>(null);
    const activeTaskSnapshot = useSystemTaskSnapshot(runner, activeTaskId);
    const handledResultTaskIdRef = React.useRef<string | null>(null);

    const start = React.useCallback(async (spec: SystemTaskSpec) => {
        setIsStarting(true);
        setStartError(null);
        try {
            const taskId = await runner.start(spec);
            runner.registerPromptContinuation?.(taskId, createThisComputerSetupPromptContinuation(options.authRequestApproval, spec));
            handledResultTaskIdRef.current = null;
            setActiveTaskId(taskId);
            return taskId;
        } catch (error) {
            setStartError(error instanceof Error ? error.message : 'system_task_start_failed');
            throw error;
        } finally {
            setIsStarting(false);
        }
    }, [runner, setActiveTaskId, options.authRequestApproval]);

    const cancel = React.useCallback(() => {
        if (!activeTaskId) {
            return;
        }
        void runner.cancel(activeTaskId);
    }, [activeTaskId, runner]);


    React.useEffect(() => {
        if (!activeTaskId || !runner.registerPromptContinuation
            || runner.listPromptContinuations?.().some((entry) => entry.taskId === activeTaskId)) return;
        runner.registerPromptContinuation(activeTaskId, createThisComputerSetupPromptContinuation(
            options.authRequestApproval, runner.getTaskSpec?.(activeTaskId) ?? undefined,
        ));
    }, [activeTaskId, runner, options.authRequestApproval]);

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
