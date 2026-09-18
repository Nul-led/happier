import { afterEach, describe, expect, it } from 'vitest';

import {
    awaitPersonalHomeBootstrapQaMutationPause,
    controlPersonalHomeBootstrapQaMutationPause,
} from './personalHomeBootstrapQaMutationPause';

const INSTALL = 'relay.runtime.installOrUpdate.v1';
const STATUS = 'relay.runtime.status.v1';

function settled(promise: Promise<void>): Promise<'settled' | 'pending'> {
    return Promise.race([
        promise.then(() => 'settled' as const),
        new Promise<'pending'>((resolve) => { setTimeout(() => resolve('pending'), 0); }),
    ]);
}

afterEach(() => {
    controlPersonalHomeBootstrapQaMutationPause({ action: 'release' });
});

describe('personal home bootstrap QA mutation pause', () => {
    it('is inert until armed so ordinary bootstrap mutations never wait', async () => {
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' })).toEqual({
            ok: true,
            armed: null,
            held: null,
            observedMutations: 0,
        });
        await expect(settled(awaitPersonalHomeBootstrapQaMutationPause(INSTALL))).resolves.toBe('settled');
    });

    it('holds exactly the armed ordinal of the armed durable mutation and releases on demand', async () => {
        const armed = controlPersonalHomeBootstrapQaMutationPause({
            action: 'arm',
            kind: INSTALL,
            ordinal: 2,
            ttlMs: 60_000,
        });
        expect(armed.ok).toBe(true);
        expect(armed.armed).toMatchObject({ kind: INSTALL, ordinal: 2 });

        // Status reads are not durable mutations and must never be counted or paused.
        await expect(settled(awaitPersonalHomeBootstrapQaMutationPause(STATUS))).resolves.toBe('settled');
        // The first durable mutation of the armed kind still runs: the pause sits BETWEEN them.
        await expect(settled(awaitPersonalHomeBootstrapQaMutationPause(INSTALL))).resolves.toBe('settled');
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' }).observedMutations).toBe(1);

        const second = awaitPersonalHomeBootstrapQaMutationPause(INSTALL);
        await expect(settled(second)).resolves.toBe('pending');
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' })).toMatchObject({
            held: { kind: INSTALL, ordinal: 2 },
            observedMutations: 2,
        });

        const released = controlPersonalHomeBootstrapQaMutationPause({ action: 'release' });
        expect(released).toEqual({ ok: true, armed: null, held: null, observedMutations: 0 });
        await expect(settled(second)).resolves.toBe('settled');
    });

    it('auto-releases an expired arm so a shipped runtime can never stall on it', async () => {
        controlPersonalHomeBootstrapQaMutationPause({ action: 'arm', kind: INSTALL, ordinal: 1, ttlMs: 1 });
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        await expect(settled(awaitPersonalHomeBootstrapQaMutationPause(INSTALL))).resolves.toBe('settled');
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' }).armed).toBeNull();
    });

    it('rejects unusable arm requests instead of pausing an unrelated boundary', () => {
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'arm', kind: STATUS, ordinal: 1 }))
            .toMatchObject({ ok: false, reason: 'unsupported-mutation-kind' });
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'arm', kind: INSTALL, ordinal: 0 }))
            .toMatchObject({ ok: false, reason: 'invalid-ordinal' });
        expect(controlPersonalHomeBootstrapQaMutationPause({ action: 'read' }).armed).toBeNull();
    });

    it('bounds the requested hold to the maximum supported window', () => {
        const armed = controlPersonalHomeBootstrapQaMutationPause({
            action: 'arm',
            kind: INSTALL,
            ordinal: 1,
            ttlMs: 10 * 60_000,
        });
        expect(armed.ok).toBe(true);
        expect((armed.armed?.expiresAtMs ?? 0) - Date.now()).toBeLessThanOrEqual(300_000);
    });
});
