import { describe, expect, it, vi } from 'vitest';

const activeRequest = vi.hoisted(() => vi.fn());
// HTTP is the system boundary; the real KV adapters run below it.
vi.mock('@/sync/http/client', () => ({ serverFetch: activeRequest }));

import { kvGet, kvMutate } from './apiKv';

describe('Account KV captured request', () => {
    it('uses the captured Account request for reads and CAS conflicts', async () => {
        activeRequest.mockResolvedValue(new Response(JSON.stringify({ key: 'workspace:tabs:v1', value: 'wrong-Account', version: 9 })));
        const request = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'workspace:tabs:v1', value: 'record', version: 2 })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errors: [{
                key: 'workspace:tabs:v1', error: 'version-mismatch', value: 'remote', version: 3,
            }] }), { status: 409 }));
        await expect(kvGet({ token: 'captured' }, 'workspace:tabs:v1', { request, retry: 'none' }))
            .resolves.toEqual({ key: 'workspace:tabs:v1', value: 'record', version: 2 });
        await expect(kvMutate({ token: 'captured' }, [{ key: 'workspace:tabs:v1', value: 'local', version: 2 }], { request, retry: 'none' }))
            .resolves.toMatchObject({ success: false, errors: [{ value: 'remote', version: 3 }] });
        expect(activeRequest).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledWith('/v1/kv', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer captured' }),
        }), { includeAuth: false, retry: 'none' });
    });
});
