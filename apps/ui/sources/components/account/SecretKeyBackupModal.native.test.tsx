import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createReactNativeNativeMock } from '@/dev/testkit/mocks/reactNative';
import { installAccountCommonModuleMocks } from './accountTestHelpers';

const runtime = vi.hoisted(() => ({
    writeBytes: vi.fn(),
    close: vi.fn(),
    cleanup: vi.fn(),
    isAvailable: vi.fn(async () => true),
    share: vi.fn(),
}));

installAccountCommonModuleMocks({
    reactNative: async () => createReactNativeNativeMock({ platformOS: 'ios' }),
});

vi.mock('@/sync/runtime/files/nativeCacheFileSink', () => ({
    createNativeCacheFileSink: async () => ({
        ok: true as const,
        fileUri: 'file:///cache/happier-recovery-key.txt',
        writeBytes: runtime.writeBytes,
        close: runtime.close,
        cleanup: runtime.cleanup,
    }),
}));

vi.mock('expo-sharing', () => ({
    isAvailableAsync: runtime.isAvailable,
    shareAsync: (...args: unknown[]) => runtime.share(...args),
}));

afterEach(() => {
    standardCleanup();
    runtime.writeBytes.mockReset();
    runtime.close.mockReset();
    runtime.cleanup.mockReset();
    runtime.isAvailable.mockClear();
    runtime.share.mockReset();
});

describe('Recovery key native disclosure', () => {
    it('shares an app-cache file and always removes it afterward', async () => {
        const { SecretKeyBackupModal } = await import('./SecretKeyBackupModal');
        const screen = await renderScreen(<SecretKeyBackupModal
            secret="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            onClose={vi.fn()}
        />);

        await screen.pressByTestIdAsync('recovery-key-download');

        expect(runtime.writeBytes).toHaveBeenCalledOnce();
        expect(runtime.close).toHaveBeenCalledOnce();
        expect(runtime.isAvailable).toHaveBeenCalledOnce();
        expect(runtime.share).toHaveBeenCalledWith(
            'file:///cache/happier-recovery-key.txt',
            { mimeType: 'text/plain' },
        );
        expect(runtime.cleanup).toHaveBeenCalledOnce();
    });
});
