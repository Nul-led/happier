import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

installSessionShellCommonModuleMocks();

const layoutState = vi.hoisted(() => ({ isTablet: false }));

// Device-class boundary: the one owner that decides sidebar-with-hub vs phone.
vi.mock('@/utils/platform/responsive', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/platform/responsive')>()),
    useIsTablet: () => layoutState.isTablet,
}));
vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({
    RecoveryKeyReminderBanner: () => React.createElement('RecoveryKeyReminderBanner', { testID: 'recovery-key-reminder' }),
}));

describe('SessionsListHeader recovery-key reminder', () => {
    afterEach(() => {
        layoutState.isTablet = false;
        standardCleanup();
    });

    it('leaves the reminder to the home hub on wide layouts', async () => {
        layoutState.isTablet = true;
        const { SessionsListHeader } = await import('./sessionListChrome');
        const screen = await renderScreen(<SessionsListHeader />);
        expect(screen.findByTestId('recovery-key-reminder')).toBeNull();
    });

    it('keeps the reminder in the phone list, where no hub exists', async () => {
        layoutState.isTablet = false;
        const { SessionsListHeader } = await import('./sessionListChrome');
        const screen = await renderScreen(<SessionsListHeader />);
        expect(screen.findByTestId('recovery-key-reminder')).toBeTruthy();
    });
});
