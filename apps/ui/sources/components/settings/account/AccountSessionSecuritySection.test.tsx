import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { retireActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

const boundary = vi.hoisted(() => ({
    confirm: vi.fn(async () => false),
    logout: vi.fn(async () => ({ kind: 'completed' as const })),
}));
installSettingsViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { confirm: boundary.confirm } }).module;
    },
});
// The authenticated device session is supplied by the platform auth boundary.
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: { token: 'test-token' }, logout: boundary.logout }),
}));


describe('Account session Security confirmation', () => {
    beforeEach(() => {
        boundary.confirm.mockReset().mockResolvedValue(false);
        boundary.logout.mockClear();
        storage.getState().activateProfileScope({ serverId: getActiveServerSnapshot().serverId, accountId: 'account-a' });
    });
    afterEach(() => {
        retireActiveServerAccountScopeLifetime();
        storage.getState().clearProfileScope();
        standardCleanup();
    });

    it('keeps this device signed in when the person cancels global sign-out', async () => {
        const { AccountSessionSecuritySection } = await import('./AccountSessionSecuritySection');
        const screen = await renderScreen(<AccountSessionSecuritySection />);
        await screen.pressByTestIdAsync('settings-account-sign-out-everywhere');
        expect(boundary.confirm).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ destructive: true }));
        expect(boundary.logout).not.toHaveBeenCalled();
    });

    it('does not apply an old Account confirmation to the newly active Account', async () => {
        boundary.confirm.mockImplementationOnce(async () => {
            storage.getState().activateProfileScope({ serverId: getActiveServerSnapshot().serverId, accountId: 'account-b' });
            return true;
        });
        const { AccountSessionSecuritySection } = await import('./AccountSessionSecuritySection');
        const screen = await renderScreen(<AccountSessionSecuritySection />);
        await screen.pressByTestIdAsync('settings-account-sign-out-everywhere');
        expect(boundary.logout).not.toHaveBeenCalled();
    });
});
