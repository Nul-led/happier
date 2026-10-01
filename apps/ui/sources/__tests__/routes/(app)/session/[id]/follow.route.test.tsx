import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const followControlSpy = vi.hoisted(() => vi.fn());
const getServerFeaturesSnapshot = vi.hoisted(() => vi.fn(async () => null));
/** The decision the feature runtime currently answers with, including "not yet". */
const featureDecisionState = vi.hoisted(() => ({
    decision: { state: 'enabled', blockerCode: '' } as Readonly<{ state: string; blockerCode: string }> | null,
}));

vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock({
    params: { id: 's1', serverId: 'home-a' },
    router: {
        push: vi.fn(),
        back: vi.fn(),
        replace: vi.fn(),
        setParams: vi.fn(),
    },
}).module);

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => featureDecisionState.decision,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({ getServerFeaturesSnapshot }));

vi.mock('@/components/sessions/follow/AccountSessionFollowControl', () => ({
    AccountSessionFollowControl: (props: unknown) => followControlSpy(props),
}));

describe('direct session Follow route', () => {
    beforeEach(() => {
        followControlSpy.mockClear();
        getServerFeaturesSnapshot.mockClear();
        featureDecisionState.decision = { state: 'enabled', blockerCode: '' };
    });

    afterEach(() => {
        standardCleanup();
    });

    it('mounts the Follow control on a Home that offers Following', async () => {
        const { default: FollowRoute } = await import('@/app/(app)/session/[id]/follow');

        const screen = await renderScreen(<FollowRoute />);

        expect(followControlSpy).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('session-follow-unavailable')).toBeNull();
    });

    it.each([
        ['while the decision has not arrived', null, 'session-follow-checking'],
        ['while the Home has not answered yet', { state: 'unknown', blockerCode: 'not_probed' }, 'session-follow-checking'],
        ['when the probe could not reach the Home', { state: 'unknown', blockerCode: 'probe_failed' }, 'session-follow-unreachable'],
    ] as const)(
        'shows the %s state on the dedicated route instead of nothing',
        async (_name, decision, testID) => {
            featureDecisionState.decision = decision;
            const { default: FollowRoute } = await import('@/app/(app)/session/[id]/follow');

            const screen = await renderScreen(<FollowRoute />);

            // A deep link that lands on a blank screen reads as a broken link. The route
            // says what is happening and keeps the way back to the Session it named.
            expect(followControlSpy).not.toHaveBeenCalled();
            expect(screen.findByTestId(testID)).not.toBeNull();
            expect(screen.findByTestId('session-follow-unavailable')).toBeNull();
        },
    );

    it('offers the canonical feature probe again when it could not reach the Home', async () => {
        featureDecisionState.decision = { state: 'unknown', blockerCode: 'probe_failed' };
        const { default: FollowRoute } = await import('@/app/(app)/session/[id]/follow');

        const screen = await renderScreen(<FollowRoute />);
        const retry = screen.findByTestId('session-follow-unreachable.retry');
        expect(retry).not.toBeNull();
        await screen.pressByTestIdAsync('session-follow-unreachable.retry');

        expect(getServerFeaturesSnapshot).toHaveBeenCalledWith({ serverId: 'home-a', force: true });
    });

    it.each(['disabled', 'unsupported'] as const)(
        'answers a %s Following decision instead of rendering a blank screen',
        async (state) => {
            featureDecisionState.decision = { state, blockerCode: '' };
            const { default: FollowRoute } = await import('@/app/(app)/session/[id]/follow');

            const screen = await renderScreen(<FollowRoute />);

            // The control renders nothing when Following is unavailable; on this dedicated
            // route that reads as a broken link rather than an answer.
            expect(followControlSpy).not.toHaveBeenCalled();
            expect(screen.findByTestId('session-follow-unavailable')).not.toBeNull();
            expect(screen.findByTestId('session-follow-unavailable.back')).not.toBeNull();
        },
    );
});
