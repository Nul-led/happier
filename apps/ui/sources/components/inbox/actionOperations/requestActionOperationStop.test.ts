import { describe, expect, it, vi } from 'vitest';

import type { ActionOperationProjection } from '@/sync/domains/actionOperations/actionOperationSelectors';

const cancelActionOperation = vi.hoisted(() => vi.fn(async () => ({ kind: 'requested' as const })));

vi.mock('@/sync/ops/actionOperations', () => ({ cancelActionOperation }));

import { requestActionOperationStop } from './requestActionOperationStop';

function operation(serverId: string): ActionOperationProjection {
    return {
        serverId,
        snapshot: {
            version: 1,
            operationId: 'operation-1',
            revision: 1,
            actionId: 'session.fork',
            state: 'running',
            scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
            title: 'Fork session',
            createdAt: 1,
            startedAt: 2,
            cancellation: 'supported',
        },
        observation: 'available',
        isUnavailableProjection: false,
    };
}

describe('requestActionOperationStop', () => {
    it('routes through the operation transport Home rather than ambient focus', async () => {
        await expect(requestActionOperationStop(operation('home-a'))).resolves.toEqual({ kind: 'requested' });

        expect(cancelActionOperation).toHaveBeenCalledWith({
            machineId: 'machine-1',
            operationId: 'operation-1',
            serverId: 'home-a',
        });
    });

    it('fails closed without exact Home evidence', async () => {
        cancelActionOperation.mockClear();

        await expect(requestActionOperationStop({
            ...operation('home-a'),
            serverId: null,
        } as unknown as ActionOperationProjection)).resolves.toEqual({ kind: 'not_found' });
        expect(cancelActionOperation).not.toHaveBeenCalled();
    });
});
