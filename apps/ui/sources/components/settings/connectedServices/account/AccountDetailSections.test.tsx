import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';

import { AccountDetailUsageSectionView, type AccountDetailUsageFacts } from './AccountDetailSections';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());

const FACTS: AccountDetailUsageFacts = {
    meters: [
        { meterId: 'five_hour', label: '5-hour', remainingPct: 60, resetsAt: null, status: 'ok' },
        { meterId: 'seven_day', label: 'Weekly', remainingPct: 10, resetsAt: null, status: 'ok' },
    ],
    fetchedAt: 1_000,
    planLabel: null,
    subscription: null,
    recoveryCredits: null,
    loading: false,
    error: false,
    refreshing: false,
    refresh: null,
};

describe('AccountDetailUsageSectionView', () => {
    it('pins a usage window from its row, showing which windows are pinned', async () => {
        const onTogglePinnedMeter = vi.fn();
        const screen = await renderScreen(
            <AccountDetailUsageSectionView
                facts={FACTS}
                signedOut={false}
                now={2_000}
                pins={{ pinnedMeterIds: ['seven_day'], onToggle: onTogglePinnedMeter }}
            />,
        );

        const pinOf = (meterId: string) => screen.root.findAll((node) => (
            node.props.testID === `account-detail-usage:pin:${meterId}` && typeof node.props.onPress === 'function'
        ))[0];
        expect(pinOf('seven_day')?.props.selected).toBe(true);
        expect(pinOf('five_hour')?.props.selected).toBe(false);

        screen.pressByTestId('account-detail-usage:pin:five_hour');
        expect(onTogglePinnedMeter).toHaveBeenCalledWith('five_hour');
    });

    it('offers no pins without a pin owner', async () => {
        const screen = await renderScreen(<AccountDetailUsageSectionView facts={FACTS} signedOut={false} now={2_000} />);
        expect(screen.findByTestId('account-detail-usage:pin:five_hour')).toBeNull();
        expect(screen.findByTestId('account-detail-usage:meter:five_hour')).toBeTruthy();
    });
});
