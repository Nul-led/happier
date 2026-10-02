import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

import { resolveWorkspaceOpenModeFromPointer } from './useWorkspaceOpenActions';

describe('workspace row pointer intent', () => {
    it('keeps Alt, middle, and platform command clicks as intentional tabs', () => {
        vi.stubGlobal('navigator', { platform: 'MacIntel' });
        expect(resolveWorkspaceOpenModeFromPointer({ altKey: true })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ nativeEvent: { altKey: true } })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ button: 1 })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ metaKey: true })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ nativeEvent: { metaKey: true } })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ ctrlKey: true })).toBeNull();
        vi.stubGlobal('navigator', { platform: 'Win32' });
        expect(resolveWorkspaceOpenModeFromPointer({ ctrlKey: true })).toBe('newTab');
        expect(resolveWorkspaceOpenModeFromPointer({ metaKey: true })).toBeNull();
        expect(resolveWorkspaceOpenModeFromPointer({ button: 2, ctrlKey: true })).toBeNull();
        expect(resolveWorkspaceOpenModeFromPointer({ button: 0 })).toBeNull();
        vi.unstubAllGlobals();
    });
});
