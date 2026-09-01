import * as React from 'react';

import { buildProviderCliCapabilityId } from '@/capabilities/cliCapabilityId';
import { machineCapabilitiesInvoke } from '@/sync/ops';
import type { CapabilitiesInvokeResponse } from '@/sync/api/capabilities/capabilitiesProtocol';

export type AgentCliInstallStatus = 'idle' | 'queued' | 'installing' | 'installed' | 'failed';

export type AgentCliInstallResult = Readonly<{
    status: AgentCliInstallStatus;
    logPath: string | null;
    failureReason: 'not-supported' | 'error' | 'invoke-error' | null;
}>;

export type AgentCliInstallQueueSummary = Readonly<{
    installedAgentIds: string[];
    failedAgentIds: string[];
}>;

export type AgentCliInstallQueueState = Readonly<{
    isRunning: boolean;
    hasStarted: boolean;
    agentIds: readonly string[];
    statusByProviderId: Readonly<Record<string, AgentCliInstallResult | undefined>>;
}>;

export type AgentCliInstallExecutionTarget = Readonly<{
    machineId: string;
    serverId: string;
}>;

function areExecutionTargetsEqual(
    left: AgentCliInstallExecutionTarget,
    right: AgentCliInstallExecutionTarget,
): boolean {
    return left.machineId === right.machineId && left.serverId === right.serverId;
}

function resolveInstalledCandidate(installed: boolean | null | undefined): boolean {
    return installed === true;
}

export function useAgentCliInstallQueue(params: Readonly<{
    machineId: string | null;
    serverId: string | null;
    /**
     * Optional Administration-owned target resolver. When supplied, it is
     * authoritative over the render-time identifiers and is consulted before
     * every machine mutation.
     */
    resolveExecutionTarget?: () => AgentCliInstallExecutionTarget | null;
    agentIds: readonly string[];
    agentDetectKeys: Readonly<Record<string, string | undefined>>;
    installedByAgentId: Readonly<Record<string, boolean | null | undefined>>;
}>) {
    const mountedRef = React.useRef(true);
    const abortRef = React.useRef<{ aborted: boolean }>({ aborted: false });
    const runningRef = React.useRef(false);

    const [hasStarted, setHasStarted] = React.useState(false);
    const [isRunning, setIsRunning] = React.useState(false);
    const [statusByProviderId, setStatusByProviderId] = React.useState<Record<string, AgentCliInstallResult | undefined>>({});

    const resolveCurrentExecutionTarget = React.useCallback((): AgentCliInstallExecutionTarget | null => {
        if (params.resolveExecutionTarget) return params.resolveExecutionTarget();
        if (!params.machineId || !params.serverId) return null;
        return { machineId: params.machineId, serverId: params.serverId };
    }, [params.machineId, params.resolveExecutionTarget, params.serverId]);

    const isExecutionTargetCurrent = React.useCallback((expected: AgentCliInstallExecutionTarget): boolean => {
        const current = resolveCurrentExecutionTarget();
        return current !== null && areExecutionTargetsEqual(current, expected);
    }, [resolveCurrentExecutionTarget]);

    React.useEffect(() => {
        return () => {
            mountedRef.current = false;
            abortRef.current.aborted = true;
        };
    }, []);

    const setStatus = React.useCallback((agentId: string, next: AgentCliInstallResult) => {
        if (!mountedRef.current) return;
        setStatusByProviderId((previous) => ({
            ...previous,
            [agentId]: next,
        }));
    }, []);

    const resolveStatus = React.useCallback((agentId: string): AgentCliInstallResult => {
        const override = statusByProviderId[agentId];
        const installed = resolveInstalledCandidate(params.installedByAgentId[agentId]);

        if (installed) {
            return {
                status: 'installed',
                logPath: null,
                failureReason: null,
            };
        }

        return override ?? { status: 'idle', logPath: null, failureReason: null };
    }, [params.installedByAgentId, statusByProviderId]);

    const start = React.useCallback(async (agentIds: readonly string[] = params.agentIds): Promise<AgentCliInstallQueueSummary> => {
        if (runningRef.current) {
            return {
                installedAgentIds: agentIds.filter((id) => resolveStatus(id).status === 'installed'),
                failedAgentIds: agentIds.filter((id) => resolveStatus(id).status === 'failed'),
            };
        }

        setHasStarted(true);
        abortRef.current.aborted = true;
        const runAbort = { aborted: false };
        abortRef.current = runAbort;
        runningRef.current = true;
        setIsRunning(true);

        const installedAgentIds: string[] = [];
        const failedAgentIds: string[] = [];

        const installTargets: string[] = [];
        for (const agentId of agentIds) {
            if (resolveStatus(agentId).status === 'installed') {
                installedAgentIds.push(agentId);
                continue;
            }
            installTargets.push(agentId);
        }

        for (const agentId of installTargets) {
            setStatus(agentId, { status: 'queued', logPath: null, failureReason: null });
        }

        for (const agentId of installTargets) {
            if (runAbort.aborted) break;
            const detectKey = params.agentDetectKeys[agentId];
            const executionTarget = resolveCurrentExecutionTarget();
            if (!executionTarget) break;
            if (!detectKey) {
                setStatus(agentId, { status: 'failed', logPath: null, failureReason: 'error' });
                failedAgentIds.push(agentId);
                continue;
            }

            setStatus(agentId, { status: 'installing', logPath: null, failureReason: null });

            let result: { ok: true; response: CapabilitiesInvokeResponse } | { ok: false; reason: 'not-supported' | 'error' };
            try {
                const invokeRequest = {
                    id: buildProviderCliCapabilityId(agentId),
                    method: 'install' as const,
                    params: {
                        skipIfInstalled: true,
                        allowVendorRecipeExecution: true,
                    },
                };
                const invoked = await machineCapabilitiesInvoke(executionTarget.machineId, invokeRequest, {
                    timeoutMs: 5 * 60_000,
                    serverId: executionTarget.serverId,
                });
                if (!invoked.supported) {
                    result = { ok: false, reason: invoked.reason };
                } else {
                    result = { ok: true, response: invoked.response };
                }
            } catch {
                result = { ok: false, reason: 'error' };
            }

            if (runAbort.aborted || !isExecutionTargetCurrent(executionTarget)) break;

            if (!result.ok) {
                setStatus(agentId, { status: 'failed', logPath: null, failureReason: result.reason });
                failedAgentIds.push(agentId);
                continue;
            }

            if (!result.response.ok) {
                setStatus(agentId, { status: 'failed', logPath: result.response.logPath ?? null, failureReason: 'invoke-error' });
                failedAgentIds.push(agentId);
                continue;
            }

            setStatus(agentId, { status: 'installed', logPath: null, failureReason: null });
            installedAgentIds.push(agentId);
        }

        if (mountedRef.current && !runAbort.aborted) {
            setIsRunning(false);
        }
        if (!runAbort.aborted) {
            runningRef.current = false;
        }

        return { installedAgentIds, failedAgentIds };
    }, [isExecutionTargetCurrent, params.agentDetectKeys, params.agentIds, resolveCurrentExecutionTarget, resolveStatus, setStatus]);

    const retry = React.useCallback(async (agentId: string): Promise<AgentCliInstallQueueSummary> => {
        setStatus(agentId, { status: 'queued', logPath: null, failureReason: null });
        return start([agentId]);
    }, [setStatus, start]);

    const reset = React.useCallback(() => {
        abortRef.current.aborted = true;
        runningRef.current = false;
        setIsRunning(false);
        setHasStarted(false);
        setStatusByProviderId({});
    }, []);

    const state: AgentCliInstallQueueState = React.useMemo(() => ({
        isRunning,
        hasStarted,
        agentIds: params.agentIds,
        statusByProviderId,
    }), [hasStarted, isRunning, params.agentIds, statusByProviderId]);

    return {
        state,
        resolveStatus,
        start,
        retry,
        reset,
    } as const;
}
