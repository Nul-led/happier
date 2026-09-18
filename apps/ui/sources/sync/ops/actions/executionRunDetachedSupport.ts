import { machineCapabilitiesDetect } from '@/sync/ops/capabilities';

/**
 * Whether an exact machine can host a truly detached Execution Run.
 *
 * This is the one owner of that question for the UI. The `execution.run.*`
 * Action transport already asks it before it will dispatch a detached-scope
 * call; a surface that offers the detached runtime must ask the *same* owner
 * rather than carry a standing policy constant or invent a feature bit.
 */

export type DetachedExecutionRunSupport =
    | 'supported'
    | 'unsupported'
    /** No exact machine has been selected yet, so there is nothing to ask. */
    | 'machine_not_selected'
    /** The probe has not answered yet, or could not be reached. */
    | 'unknown';

/**
 * The canonical shape check for the detached-capable execution-run protocol.
 *
 * Both `detachedScope` and `startAndWait` are required because the workflow
 * coordinator's detached leaf uses the detached RPC scope *and* the bounded
 * wait; a host with only one of them cannot carry the whole contract.
 */
export function readProtocolV2ExecutionRunSupport(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Readonly<Record<string, unknown>>;
    if (record.protocolVersion !== 2) return false;
    const features = record.features;
    if (!features || typeof features !== 'object' || Array.isArray(features)) return false;
    return (features as Readonly<Record<string, unknown>>).detachedScope === true
        && (features as Readonly<Record<string, unknown>>).startAndWait === true;
}

/**
 * Asks the canonical machine-capability owner about one exact machine.
 *
 * Failure is reported as `unknown`, never as `unsupported`: an unreachable
 * probe is not evidence that the machine lacks the capability, and presenting
 * it as a refusal would be the same fabrication the truthful-availability rule
 * exists to prevent.
 */
export async function detectDetachedExecutionRunSupport(params: Readonly<{
    machineId: string | null;
    serverId?: string | null;
    signal?: AbortSignal;
}>): Promise<DetachedExecutionRunSupport> {
    if (params.machineId === null || params.machineId.trim().length === 0) {
        return 'machine_not_selected';
    }
    try {
        const capability = await machineCapabilitiesDetect(
            params.machineId,
            { requests: [{ id: 'tool.executionRuns' }] },
            {
                ...(params.serverId ? { serverId: params.serverId } : {}),
                ...(params.signal ? { signal: params.signal } : {}),
            },
        );
        if (!capability.supported) return 'unknown';
        const executionRuns = capability.response.results['tool.executionRuns'];
        if (!executionRuns?.ok) return 'unsupported';
        return readProtocolV2ExecutionRunSupport(executionRuns.data) ? 'supported' : 'unsupported';
    } catch {
        return 'unknown';
    }
}
