import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMetadata } from '@/testkit/backends/sessionMetadata';

const mocks = vi.hoisted(() => ({
    fetchSessionSnapshotUpdateFromServer: vi.fn(),
}));

vi.mock('../../snapshotSync', () => ({
    fetchSessionSnapshotUpdateFromServer: mocks.fetchSessionSnapshotUpdateFromServer,
}));

import { syncSessionSnapshotFromServer } from './syncSessionSnapshotFromServer';

describe('syncSessionSnapshotFromServer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes and atomically persists the authoritative metadata layout revision', async () => {
        const metadata = createTestMetadata({ path: '' });
        const metadataTuple = {
            metadataLayoutVersion: 1,
            metadata,
            metadataVersion: 1,
            ownerMetadata: { v: 1, metadata: {} },
            ownerMetadataEnvelope: {
                t: 'plain',
                v: { v: 1 },
            },
            agentState: null,
            agentStateVersion: 1,
        };
        mocks.fetchSessionSnapshotUpdateFromServer.mockResolvedValueOnce({
            metadataLayoutVersion: 1,
            metadataTuple,
        });
        const setMetadataSnapshot = vi.fn();
        const setAgentStateSnapshot = vi.fn();
        const setMetadataEnvelopeTupleSnapshot = vi.fn();

        await expect(syncSessionSnapshotFromServer({
            token: 'token',
            sessionId: 'session',
            accountEncryptionCurrentness: {
                mode: 'e2ee',
                version: 1,
                signingKeyFingerprint: null,
                contentKeyFingerprint: 'content-fingerprint',
                updatedAt: 1,
                recipientEnvelopeReadiness: { status: 'available' },
            },
            mode: 'e2ee',
            ctx: {
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
            },
            currentMetadataLayoutVersion: 0,
            currentMetadataVersion: 9,
            currentAgentStateVersion: 8,
            currentMetadata: createTestMetadata({ path: '/private' }),
            currentAgentState: { controlledByUser: true },
            sessionConnectionSupervisor: null,
            isClosed: () => false,
            setMetadataSnapshot,
            setAgentStateSnapshot,
            setMetadataEnvelopeTupleSnapshot,
            applyPendingQueueState: vi.fn(),
            applyLatestTurnStatus: vi.fn(),
            reason: 'connect',
        })).resolves.toBe(true);

        expect(mocks.fetchSessionSnapshotUpdateFromServer).toHaveBeenCalledWith(
            expect.objectContaining({
                currentMetadataLayoutVersion: 0,
                currentMetadataVersion: 9,
                currentAgentStateVersion: 8,
            }),
        );
        expect(setMetadataEnvelopeTupleSnapshot).toHaveBeenCalledWith(metadataTuple);
        expect(setMetadataSnapshot).not.toHaveBeenCalled();
        expect(setAgentStateSnapshot).not.toHaveBeenCalled();
    });

    it('awaits exact Execution Run target reconciliation from the current Session snapshot', async () => {
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        mocks.fetchSessionSnapshotUpdateFromServer.mockResolvedValueOnce({
            pendingExecutionRunIds: ['run-offline'],
        });
        const reconcilePendingExecutionRunTarget = vi.fn(async () => {
            await blocked;
        });

        const sync = syncSessionSnapshotFromServer({
            token: 'token',
            sessionId: 'session',
            accountEncryptionCurrentness: null,
            mode: 'plain',
            ctx: null,
            currentMetadataLayoutVersion: 0,
            currentMetadataVersion: 0,
            currentAgentStateVersion: 0,
            currentMetadata: null,
            currentAgentState: null,
            sessionConnectionSupervisor: null,
            isClosed: () => false,
            setMetadataSnapshot: vi.fn(),
            setAgentStateSnapshot: vi.fn(),
            setMetadataEnvelopeTupleSnapshot: vi.fn(),
            applyPendingQueueState: vi.fn(),
            applyLatestTurnStatus: vi.fn(),
            reconcilePendingExecutionRunTarget,
            reason: 'reconnect',
        });

        await vi.waitFor(() => {
            expect(reconcilePendingExecutionRunTarget).toHaveBeenCalledWith('run-offline');
        });
        let settled = false;
        void sync.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        release();
        await expect(sync).resolves.toBe(true);
    });
});
