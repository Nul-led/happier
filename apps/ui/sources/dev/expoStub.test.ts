import { describe, expect, it } from 'vitest';

import * as expo from './expoStub';

describe('expo vitest stub', () => {
    it('provides the optional native module bridge used by Expo packages', () => {
        expect(expo.requireOptionalNativeModule('ExpoHaptics')).toBeNull();
        expect(expo.default.requireOptionalNativeModule('ExpoHaptics')).toBeNull();
    });

    it('keeps Expo crypto importable without silently simulating native AES', () => {
        const crypto = expo.requireNativeModule<{
            EncryptionKey: new () => unknown;
            SealedData: new () => unknown;
        }>('ExpoCryptoAES');
        expect(() => new crypto.EncryptionKey()).toThrow(Error);
        expect(() => new crypto.SealedData()).toThrow(Error);
    });
});
