import { describe, expect, it } from 'vitest';
import { createSimulatorInputLeaseManager } from './lease';

describe('simulator input lease manager', () => {
    it('allows one active controller per physical source across viewer streams and expires stale leases', () => {
        const manager = createSimulatorInputLeaseManager({ ttlMs: 1_000 });
        expect(manager.acquire({
            streamId: 'stream_1',
            sourceId: 'source_1',
            holderId: 'viewer_1',
            nowMs: 1_000,
        })).toMatchObject({ ok: true });
        expect(manager.acquire({
            streamId: 'stream_2',
            sourceId: 'source_1',
            holderId: 'viewer_2',
            nowMs: 1_500,
        })).toEqual({ ok: false, reasonCode: 'lease_already_held' });
        expect(manager.acquire({
            streamId: 'stream_2',
            sourceId: 'source_1',
            holderId: 'viewer_2',
            nowMs: 2_001,
        })).toMatchObject({ ok: true, lease: { holderId: 'viewer_2' } });
    });

    it('binds renewal, reads and release to the owning stream, then permits another stream to acquire', () => {
        const manager = createSimulatorInputLeaseManager({ ttlMs: 1_000 });
        const first = manager.acquire({ streamId: 'stream_1', sourceId: 'source_1', holderId: 'viewer_1', nowMs: 1_000 });
        expect(first.ok).toBe(true);
        if (!first.ok) throw new Error('Expected initial lease');

        expect(manager.acquire({ streamId: 'stream_2', sourceId: 'source_1', holderId: 'viewer_1', nowMs: 1_100 }))
            .toEqual({ ok: false, reasonCode: 'lease_already_held' });
        expect(manager.read({ streamId: 'stream_2', sourceId: 'source_1', nowMs: 1_100 })).toBeNull();
        expect(manager.release({ streamId: 'stream_2', sourceId: 'source_1', leaseId: first.lease.leaseId }))
            .toEqual({ ok: false, reasonCode: 'input_lease_mismatch' });
        const renewed = manager.acquire({ streamId: 'stream_1', sourceId: 'source_1', holderId: 'viewer_1', nowMs: 1_200 });
        expect(renewed.ok).toBe(true);
        if (!renewed.ok) throw new Error('Expected renewal');
        expect(manager.release({ streamId: 'stream_1', sourceId: 'source_1', leaseId: renewed.lease.leaseId })).toEqual({ ok: true });

        const second = manager.acquire({ streamId: 'stream_2', sourceId: 'source_1', holderId: 'viewer_2', nowMs: 1_300 });
        expect(second).toMatchObject({ ok: true, lease: { streamId: 'stream_2', holderId: 'viewer_2' } });
        expect(manager.release({ streamId: 'stream_1', sourceId: 'source_1', leaseId: renewed.lease.leaseId }))
            .toEqual({ ok: false, reasonCode: 'input_lease_mismatch' });
        expect(manager.read({ streamId: 'stream_2', sourceId: 'source_1', nowMs: 1_400 })).toEqual(second.ok ? second.lease : null);
        expect(manager.acquire({ streamId: 'stream_3', sourceId: 'source_2', holderId: 'viewer_3', nowMs: 1_400 }))
            .toMatchObject({ ok: true });
    });
});
