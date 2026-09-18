import { describe, expect, it } from 'vitest';

import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { createActionOperationStore } from './actionOperationStore';
import { consumeActionOperationSnapshotPush } from './consumeActionOperationSnapshotPush';
import { normalizeActionOperationEphemeralIngress } from './actionOperationEphemeralIngress';

describe('normalizeActionOperationEphemeralIngress', () => {
    it.each([
        [
            'released 0.2.11 envelope',
            {
                type: 'action-operation-updated',
                machineId: 'machine-1',
                content: { t: 'encrypted', c: 'sealed' },
            },
        ],
        [
            'pre-release current-dev drain envelope',
            {
                type: 'action-operation-snapshot',
                machineId: 'machine-1',
                ciphertext: 'sealed',
            },
        ],
    ])('normalizes the %s through one qualified-store ingress', (_name, raw) => {
        expect(normalizeActionOperationEphemeralIngress(raw)).toStrictEqual({
            type: 'action-operation-snapshot',
            machineId: 'machine-1',
            ciphertext: 'sealed',
        });
    });

    it('rejects unqualified or malformed legacy input', () => {
        expect(normalizeActionOperationEphemeralIngress({
            type: 'action-operation-updated',
            machineId: 'machine-1',
            content: { t: 'plain', v: 'sealed' },
        })).toBeNull();
        expect(normalizeActionOperationEphemeralIngress({
            type: 'action-operation-updated',
            content: { t: 'encrypted', c: 'sealed' },
        })).toBeNull();
    });

    it('attaches the immutable authenticated Home rather than any focused Home', async () => {
        const store = createActionOperationStore();
        const snapshot: ActionOperationSnapshotV1 = {
            version: 1,
            operationId: 'operation-1',
            revision: 1,
            actionId: 'session.spawn_new',
            state: 'running',
            scope: { accountId: 'account-b', machineId: 'machine-1' },
            title: 'Create session',
            createdAt: 1,
            startedAt: 2,
            cancellation: 'supported',
        };

        const update = normalizeActionOperationEphemeralIngress({
            type: 'action-operation-updated',
            machineId: 'machine-1',
            content: { t: 'encrypted', c: 'sealed' },
        });
        expect(update).not.toBeNull();
        if (!update) return;

        await consumeActionOperationSnapshotPush({
            update,
            accountId: 'account-b',
            sourceServerId: 'home-b',
            openSnapshot: () => snapshot,
            store,
        });

        expect([...store.getSnapshot().operationsByKey.values()]).toStrictEqual([{
            serverId: 'home-b',
            snapshot,
        }]);
    });
});
