import { beforeEach, describe, expect, it, vi } from 'vitest';

const releaseTransport = vi.hoisted(() => vi.fn(async () => undefined));
const resolveContext = vi.hoisted(() => vi.fn());

vi.mock('./resolveServerAccountRequestContext', () => ({
    resolveServerAccountRequestContext: resolveContext,
}));

import {
    captureServerRequestAuthorityForServerAccountScope,
    runWithServerRequestAuthorityForServerAccountScope,
} from './createServerRequestWithServerScope';

function scopedContext(accountId = 'account-a') {
    return {
        scope: 'scoped' as const,
        timeoutMs: 5_000,
        targetServerId: 'server-a',
        targetServerUrl: 'https://server-a.example',
        targetAccountId: accountId,
        token: 'token-a',
        encryption: null,
        runtimeOrigin: 'http://127.0.0.1:49152',
        carrier: 'iroh' as const,
        release: releaseTransport,
    };
}

describe('server account session request authority disposal', () => {
    beforeEach(() => {
        releaseTransport.mockClear();
        resolveContext.mockReset().mockResolvedValue(scopedContext());
    });

    it('exposes an idempotent release derived from the acquired scoped transport', async () => {
        const authority = await captureServerRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        });

        await authority.release();
        await authority.release();

        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });

    it('keeps release retry custody after a rejection: coalesces concurrent callers, propagates the first rejection, retries once on the next explicit call, then idles', async () => {
        releaseTransport.mockRejectedValueOnce(new Error('release failed'));

        const authority = await captureServerRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        });

        // Concurrent callers coalesce one in-flight underlying release and both
        // observe its rejection; the second caller must not resolve early just
        // because released was marked before the await.
        const settled = await Promise.allSettled([authority.release(), authority.release()]);
        expect(settled).toEqual([
            { status: 'rejected', reason: expect.objectContaining({ message: 'release failed' }) },
            { status: 'rejected', reason: expect.objectContaining({ message: 'release failed' }) },
        ]);
        expect(releaseTransport).toHaveBeenCalledTimes(1);

        // The next explicit call retries the underlying release exactly once.
        await expect(authority.release()).resolves.toBeUndefined();
        expect(releaseTransport).toHaveBeenCalledTimes(2);

        // After a success, later calls are idempotent.
        await expect(authority.release()).resolves.toBeUndefined();
        expect(releaseTransport).toHaveBeenCalledTimes(2);
    });

    it.each(['success', 'error'] as const)('releases once after an operation %s', async (outcome) => {
        const operation = vi.fn(async () => {
            if (outcome === 'error') throw new Error('operation failed');
            return 'ok';
        });

        const result = runWithServerRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        }, operation);

        if (outcome === 'error') await expect(result).rejects.toThrow('operation failed');
        else await expect(result).resolves.toBe('ok');
        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });

    it('releases the acquired transport when account validation fails', async () => {
        resolveContext.mockResolvedValue(scopedContext('account-b'));

        await expect(captureServerRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        })).rejects.toThrow('authenticated account does not match');

        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });
});
