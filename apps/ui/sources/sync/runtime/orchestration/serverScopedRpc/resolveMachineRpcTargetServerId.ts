import { getAppliedActiveServerSnapshot } from '@/sync/runtime/orchestration/connectionManager';

function normalizeId(raw: unknown): string {
    return String(raw ?? '').trim();
}

/**
 * Resolves an omitted machine-RPC target from the Home that owns execution,
 * rather than from the mutable staged Home selection.
 */
export function resolveMachineRpcTargetServerId(serverId?: string | null): string | undefined {
    const explicitServerId = normalizeId(serverId);
    if (explicitServerId) return explicitServerId;

    return normalizeId(getAppliedActiveServerSnapshot().serverId) || undefined;
}
