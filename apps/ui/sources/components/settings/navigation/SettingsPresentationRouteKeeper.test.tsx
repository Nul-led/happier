import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pathnameState = vi.hoisted(() => ({ value: '/settings' }));
const routerReplaceSpy = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        pathname: () => pathnameState.value,
        router: { replace: routerReplaceSpy },
    }).module;
});

type DeviceType = 'phone' | 'tablet';

async function mountKeeper(deviceType: DeviceType, liveDeviceType: () => DeviceType) {
    const { SettingsPresentationRouteKeeper } = await import('./SettingsPresentationRouteKeeper');
    return await renderScreen(<SettingsPresentationRouteKeeper deviceType={deviceType} readLiveDeviceType={liveDeviceType} />);
}

describe('SettingsPresentationRouteKeeper', () => {
    afterEach(() => {
        pathnameState.value = '/settings';
        routerReplaceSpy.mockReset();
    });

    it('reopens the settings page that was showing when a phone/desktop switch remounted Settings', async () => {
        let live: DeviceType = 'tablet';
        pathnameState.value = '/settings/session/transcript';
        const before = await mountKeeper('tablet', () => live);

        // The window narrows: Settings is presented differently and its navigator remounts at the index.
        live = 'phone';
        await act(async () => { before.tree.unmount(); });
        // The pathname still names the old page while the new navigator sits at its index (seen live).
        await mountKeeper('phone', () => live);

        expect(routerReplaceSpy).toHaveBeenCalledWith('/settings/session/transcript');
    });

    it('leaves Settings where it opens after an ordinary close', async () => {
        const live: DeviceType = 'tablet';
        pathnameState.value = '/settings/session/transcript';
        const before = await mountKeeper('tablet', () => live);

        await act(async () => { before.tree.unmount(); });
        pathnameState.value = '/settings';
        await mountKeeper('tablet', () => live);

        expect(routerReplaceSpy).not.toHaveBeenCalled();
    });
});
