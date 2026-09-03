import { beforeEach, describe, expect, it, vi } from 'vitest';

const randomBytesMock = vi.hoisted(() => vi.fn(() => new Uint8Array(32).fill(7)));
const digestMock = vi.hoisted(() => vi.fn(async () => {
    throw new Error('SubtleCrypto is unavailable');
}));

vi.mock('@/platform/cryptoRandom', () => ({
    getRandomBytes: randomBytesMock,
}));

vi.mock('@/platform/digest', () => ({
    digest: digestMock,
}));

describe('createPairingSecret', () => {
    beforeEach(() => {
        randomBytesMock.mockClear();
        digestMock.mockClear();
    });

    it('creates V2 QR secret material without requiring the unused legacy digest', async () => {
        const { createPairingSecret } = await import('./pairingSecret');

        await expect(createPairingSecret()).resolves.toEqual({
            secret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
        });
        expect(randomBytesMock).toHaveBeenCalledWith(32);
        expect(digestMock).not.toHaveBeenCalled();
    });
});
