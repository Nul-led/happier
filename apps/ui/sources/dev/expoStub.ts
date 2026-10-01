// Vitest/node stub for the `expo` package.
// The real `expo` entrypoint loads bundler-specific runtime modules that don't exist in Vitest.
//
// Some Expo modules (e.g. `expo-widgets`) import native-bridge helpers from `expo` directly.
// Provide the minimal surface area needed for unit tests to import those modules without
// running any native side effects.

export class NativeModule<TEvents = unknown> {
    addListener(_eventName: keyof TEvents | string, _listener: (...args: unknown[]) => void): { remove: () => void } {
        return { remove: () => undefined };
    }

    removeListeners(_count: number): void {}
}

export function requireOptionalNativeModule(_moduleName?: string): null {
    return null;
}

class UnavailableNativeAesObject {
    constructor() {
        throw new Error('Native Expo AES is unavailable in Vitest; mock the native crypto boundary when exercising it.');
    }
}

export function requireNativeModule<T>(moduleName?: string): T {
    // expo-crypto 55 extends these native classes at import time. Keep that import usable
    // without pretending the Node harness implements native AES operations.
    if (moduleName === 'ExpoCryptoAES') {
        return { EncryptionKey: UnavailableNativeAesObject, SealedData: UnavailableNativeAesObject } as T;
    }
    return {} as T;
}

export default {
    NativeModule,
    requireOptionalNativeModule,
    requireNativeModule,
};
