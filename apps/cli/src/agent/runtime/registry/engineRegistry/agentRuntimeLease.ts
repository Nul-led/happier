import type {
    AgentRuntime,
    AgentRuntimeSurfaces,
} from '@happier-dev/plugin-sdk/agents/runtime';

import type { AgentRuntimeRegistrationLease } from '@/plugins/runtime/lifecycle/contributions/targetAgents';

export async function resolveLeasedAgentRuntime(params: Readonly<{
    lease: AgentRuntimeRegistrationLease;
    resolveHostSurfaces?: () => Promise<AgentRuntimeSurfaces | null>;
}>): Promise<AgentRuntime> {
    if (!params.lease.hasPrimaryRuntime) {
        throw new Error(
            `Agent '${params.lease.agentId}' from plugin '${params.lease.pluginId}' does not register a primary runtime`,
        );
    }
    const retirementSignal = params.lease.retirementSignal;
    if (!(retirementSignal instanceof AbortSignal)) {
        throw new Error(
            `Agent '${params.lease.agentId}' runtime lease has no generation retirement signal`,
        );
    }
    const runtime = await params.lease.createRuntime({
        signal: retirementSignal,
    });
    const leaseSurfaces: AgentRuntimeSurfaces = Object.freeze({
        ...(params.lease.terminal ? { terminal: params.lease.terminal } : {}),
    });
    const hostSurfaces = params.resolveHostSurfaces
        ? await params.resolveHostSurfaces()
        : null;
    if (retirementSignal.aborted || !params.lease.isCurrent()) {
        throw new Error(
            `Agent '${params.lease.agentId}' runtime generation retired while resolving host-bound surfaces`,
        );
    }
    if (Object.keys(leaseSurfaces).length === 0 && !hostSurfaces) {
        return runtime;
    }

    const runtimeSurfaces = runtime.surfaces ?? {};
    for (const family of Object.keys(hostSurfaces ?? {}) as (keyof AgentRuntimeSurfaces)[]) {
        if (hostSurfaces?.[family] !== undefined && leaseSurfaces[family] !== undefined) {
            throw new Error(
                `Agent '${params.lease.agentId}' has competing leased and host '${family}' surfaces`,
            );
        }
    }
    const auxiliarySurfaces = Object.freeze({
        ...leaseSurfaces,
        ...(hostSurfaces ?? {}),
    });
    for (const family of Object.keys(auxiliarySurfaces) as (keyof AgentRuntimeSurfaces)[]) {
        if (auxiliarySurfaces[family] !== undefined && runtimeSurfaces[family] !== undefined) {
            throw new Error(
                `Agent '${params.lease.agentId}' has competing runtime and auxiliary '${family}' surfaces`,
            );
        }
    }

    return Object.freeze({
        ...runtime,
        surfaces: Object.freeze({
            ...runtimeSurfaces,
            ...auxiliarySurfaces,
        }),
    });
}
