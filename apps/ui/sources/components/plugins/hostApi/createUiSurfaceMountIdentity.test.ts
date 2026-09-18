import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUiSurfaceMountIdentity } from './createUiSurfaceMountIdentity';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('surface mount identity', () => {
    it('uses the secure platform adapter when browser global crypto is absent', () => {
        vi.stubGlobal('crypto', undefined);
        const first = createUiSurfaceMountIdentity();
        const second = createUiSurfaceMountIdentity();
        expect(first).toEqual({ instanceId: expect.any(String), mountNonce: expect.any(String) });
        expect(first?.instanceId).not.toBe(first?.mountNonce);
        expect(second).not.toEqual(first);
    });

    it('returns unavailable instead of synthesizing an identity when secure entropy fails', async () => {
        vi.spyOn(await import('@/platform/randomUUID'), 'randomUUID').mockImplementation(() => {
            throw new Error('secure_entropy_unavailable');
        });

        expect(createUiSurfaceMountIdentity()).toBeNull();
    });
});
