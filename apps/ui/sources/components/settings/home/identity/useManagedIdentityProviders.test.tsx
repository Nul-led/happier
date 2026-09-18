import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('./managedIdentityProviderClient', () => ({
    createManagedIdentityProviderClient: () => ({ execute: executeMock }),
}));

import { useManagedIdentityProviders } from './useManagedIdentityProviders';

const HOME_SCOPE = Object.freeze({ serverId: 'home-a', accountId: 'account-a' });

function emptyProviderListResult() {
    return Promise.resolve({
        kind: 'succeeded' as const,
        value: Object.freeze({ items: Object.freeze([]), unreadableCount: 0 }),
    });
}

describe('useManagedIdentityProviders AccountChange freshness', () => {
    afterEach(() => {
        standardCleanup();
        vi.clearAllMocks();
    });

    it('refreshes a mounted Home-owned query for exact Home governance and Team-consumer wakes', async () => {
        executeMock.mockImplementation(emptyProviderListResult);
        const rendered = await renderHook(() => useManagedIdentityProviders(HOME_SCOPE));
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));

        await act(async () => {
            publishHomeAccountChange('home-b', ['home-governance']);
        });
        expect(executeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            publishHomeAccountChange('home-a', ['teams']);
        });
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(2));

        await act(async () => {
            publishHomeAccountChange('home-a', ['home-governance']);
        });
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(3));

        await act(async () => {
            publishHomeAccountChange('home-a');
        });
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(4));
        await rendered.unmount();
    });

    it('refreshes a Team-owned provider query for a Team or conservative content-free wake', async () => {
        executeMock.mockImplementation(emptyProviderListResult);
        const rendered = await renderHook(() => useManagedIdentityProviders(
            HOME_SCOPE,
            { kind: 'team', teamId: 'team-a' },
        ));
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));

        await act(async () => {
            publishHomeAccountChange('home-a', ['home-governance']);
        });
        await Promise.resolve();
        expect(executeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            publishHomeAccountChange('home-a', ['teams']);
        });
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(2));

        await act(async () => {
            publishHomeAccountChange('home-a');
        });
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(3));
        await rendered.unmount();
    });

    it('releases the wake observer on unmount and reads again on remount', async () => {
        executeMock.mockImplementation(emptyProviderListResult);
        const first = await renderHook(() => useManagedIdentityProviders(HOME_SCOPE));
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
        await first.unmount();

        await act(async () => {
            publishHomeAccountChange('home-a', ['home-governance']);
        });
        expect(executeMock).toHaveBeenCalledTimes(1);

        const second = await renderHook(() => useManagedIdentityProviders(HOME_SCOPE));
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(2));
        await second.unmount();
    });
});
