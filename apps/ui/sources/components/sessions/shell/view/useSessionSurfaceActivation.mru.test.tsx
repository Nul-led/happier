import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { loadLocalSettings } from '@/sync/domains/state/settingsPersistence';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { resetSessionSurfaceVisibilityForTests, setFocusedSessionId } from '@/sync/domains/session/sessionSurfaceVisibility';
import { resolveSessionSwitcherRecentPool } from '@/sync/domains/session/navigation/sessionSwitcherOrder';
import { useSessionSurfaceActivation, type UseSessionSurfaceActivationInput } from './useSessionSurfaceActivation';

const key = (sessionId: string, serverId = 'home-a') => sessionAddressKey({ sessionId, serverId });

beforeEach(() => {
    resetSessionSurfaceVisibilityForTests();
    storage.getState().applyLocalSettings({ sessionMruOrderV1: [] });
});

afterEach(async () => {
    await standardCleanup();
    resetSessionSurfaceVisibilityForTests();
    storage.getState().applyLocalSettings({ sessionMruOrderV1: [] });
});

describe('focused session MRU without a Sessions list participant', () => {
    it('persists route opens and retained tab activation for the switcher Recent source', async () => {
        // Switcher, notification and deep-link routes mount/retarget this same surface;
        // a retained workspace tab instead becomes focused without remounting.
        const surface = (sessionId: string, focused = true): UseSessionSurfaceActivationInput => ({
            sessionId, serverId: 'home-a', surfaceVisible: true, surfaceFocused: focused, routeAnchor: focused,
        });
        const hook = await renderHook(useSessionSurfaceActivation, { initialProps: surface('switcher-open') });
        expect(loadLocalSettings().sessionMruOrderV1).toEqual([key('switcher-open')]);

        await hook.rerender(surface('tab-open', false));
        expect(loadLocalSettings().sessionMruOrderV1).toEqual([key('switcher-open')]);
        await hook.rerender(surface('tab-open'));
        expect(loadLocalSettings().sessionMruOrderV1).toEqual([key('tab-open'), key('switcher-open')]);

        await hook.rerender(surface('notification-open'));
        expect(loadLocalSettings().sessionMruOrderV1).toEqual([
            key('notification-open'), key('tab-open'), key('switcher-open'),
        ]);
        await hook.unmount();
        // Cold route entry, as with a deep link, does not need a list or existing session record.
        const deepLink = await renderHook(useSessionSurfaceActivation, { initialProps: surface('deep-link-open') });
        const expected = [key('deep-link-open'), key('notification-open'), key('tab-open'), key('switcher-open')];
        expect(loadLocalSettings().sessionMruOrderV1).toEqual(expected);
        expect(resolveSessionSwitcherRecentPool({
            currentKey: key('deep-link-open'), mruSessionKeys: storage.getState().localSettings.sessionMruOrderV1, openTabs: [],
        }).map((entry) => entry.sessionKey)).toEqual(expected);
        await deepLink.unmount();
    });

    it('preserves other Homes and unloaded history, deduplicates revisits, and suppresses same-focus writes', () => {
        const unloaded = key('unloaded', 'home-b');
        storage.getState().applyLocalSettings({ sessionMruOrderV1: [unloaded] });
        setFocusedSessionId('same-id', 'home-a');
        setFocusedSessionId('same-id', 'home-b');
        setFocusedSessionId('same-id', 'home-a');
        expect(loadLocalSettings().sessionMruOrderV1).toEqual([key('same-id'), key('same-id', 'home-b'), unloaded]);
        const snapshot = storage.getState();
        setFocusedSessionId('same-id', 'home-a');
        setFocusedSessionId(null);
        expect(storage.getState()).toBe(snapshot);
    });
});
