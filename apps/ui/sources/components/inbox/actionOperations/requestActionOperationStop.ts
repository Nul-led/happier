import type { ActionOperationCancelV1Response } from '@happier-dev/protocol';

import { cancelActionOperation } from '@/sync/ops/actionOperations';
import type { ActionOperationProjection } from '@/sync/domains/actionOperations/actionOperationSelectors';

export type ActionOperationStopTarget = Pick<ActionOperationProjection, 'serverId' | 'snapshot'>;

export async function requestActionOperationStop(
    operation: ActionOperationStopTarget,
): Promise<ActionOperationCancelV1Response> {
    if (!operation.serverId) return { kind: 'not_found' };
    return await cancelActionOperation({
        machineId: operation.snapshot.scope.machineId,
        operationId: operation.snapshot.operationId,
        serverId: operation.serverId,
    });
}

export async function requestAcceptedActionOperationStop(operation: ActionOperationProjection): Promise<void> {
    const result = await requestActionOperationStop(operation);
    if (result.kind !== 'requested' && result.kind !== 'already_settled') {
        throw new Error(`Action operation stop was not accepted: ${result.kind}`);
    }
}
