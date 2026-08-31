import { beforeEach, describe, expect, it, vi } from 'vitest';

const releaseTransport = vi.hoisted(() => vi.fn(async () => undefined));
const resolveContext = vi.hoisted(() => vi.fn());

vi.mock('./resolveServerScopedSessionContext', () => ({
    resolveServerScopedSessionContext: resolveContext,
}));

import {
    captureSessionRequestAuthorityForServerAccountScope,
    runWithSessionRequestAuthorityForServerAccountScope,
} from './createSessionRequestWithServerScope';

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
        const authority = await captureSessionRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        });

        await authority.release();
        await authority.release();

        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });

    it.each(['success', 'error'] as const)('releases once after an operation %s', async (outcome) => {
        const operation = vi.fn(async () => {
            if (outcome === 'error') throw new Error('operation failed');
            return 'ok';
        });

        const result = runWithSessionRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        }, operation);

        if (outcome === 'error') await expect(result).rejects.toThrow('operation failed');
        else await expect(result).resolves.toBe('ok');
        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });

    it('releases the acquired transport when account validation fails', async () => {
        resolveContext.mockResolvedValue(scopedContext('account-b'));

        await expect(captureSessionRequestAuthorityForServerAccountScope({
            scope: { serverId: 'server-a', accountId: 'account-a' },
            activeRequest: vi.fn(),
        })).rejects.toThrow('authenticated account does not match');

        expect(releaseTransport).toHaveBeenCalledTimes(1);
    });
});
