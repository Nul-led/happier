import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Device storage for the reminder's dismissed flag (the persistence boundary).
const storage = vi.hoisted(() => ({
    dismissed: false,
    getRecoveryKeyReminderDismissed: vi.fn(async () => storage.dismissed),
    setRecoveryKeyReminderDismissed: vi.fn(async (value: boolean) => {
        storage.dismissed = value;
        return true;
    }),
    getCachedRecoveryKeyReminderDismissed: vi.fn(() => null as boolean | null),
}));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getRecoveryKeyReminderDismissed: storage.getRecoveryKeyReminderDismissed,
            setRecoveryKeyReminderDismissed: storage.setRecoveryKeyReminderDismissed,
            getCachedRecoveryKeyReminderDismissed: storage.getCachedRecoveryKeyReminderDismissed,
        },
        isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
    };
});

// The server's feature answer (HTTP) turns the reminder on.
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: async () => ({ features: { auth: { ui: { recoveryKeyReminder: { enabled: true } } } } }),
    getCachedReadyServerFeatures: () => null,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, credentials: { token: 't', secret: 's' } }),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

afterEach(() => {
    storage.dismissed = false;
    vi.resetModules();
});

describe('useRecoveryKeyReminder', () => {
    it('is needed until the key is saved or the reminder dismissed, for every surface at once', async () => {
        const { useRecoveryKeyReminder } = await import('./useRecoveryKeyReminder');
        const hub = await renderHook(() => useRecoveryKeyReminder());
        const banner = await renderHook(() => useRecoveryKeyReminder());
        await flushHookEffects({ cycles: 3 });
        expect(hub.getCurrent().needed).toBe(true);
        expect(banner.getCurrent().needed).toBe(true);

        // Dismissing from one surface is done everywhere, and remembered on the device.
        await act(async () => { await hub.getCurrent().dismiss(); });
        await flushHookEffects({ cycles: 2 });
        expect(hub.getCurrent().needed).toBe(false);
        expect(banner.getCurrent().needed).toBe(false);
        expect(storage.dismissed).toBe(true);
    });

    it('is done once the key is saved', async () => {
        const { useRecoveryKeyReminder } = await import('./useRecoveryKeyReminder');
        const hook = await renderHook(() => useRecoveryKeyReminder());
        await flushHookEffects({ cycles: 3 });
        expect(hook.getCurrent().needed).toBe(true);

        await act(async () => { await hook.getCurrent().markSaved(); });
        await flushHookEffects({ cycles: 2 });
        expect(hook.getCurrent().needed).toBe(false);
    });
});
