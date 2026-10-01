import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { getPersistenceStorage, getPersistenceStorageId } from '@/sync/domains/state/persistenceStorage';

import { dismissHomeReachNudge, recordFailedHomeReach, useHomeReachNudge } from './homeReachFailures';

describe('device-local Home reach nudge subscription', () => {
    beforeEach(() => {
        getPersistenceStorage().delete('home-reach-failures-v2');
        getPersistenceStorage().delete('home-reach-nudge-dismissed-v1');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        getPersistenceStorage().delete('home-reach-failures-v2');
        getPersistenceStorage().delete('home-reach-nudge-dismissed-v1');
    });

    it('mounts, updates and unmounts on native without browser event APIs', async () => {
        vi.stubGlobal('window', globalThis);
        const hook = await renderHook(() => useHomeReachNudge('srv_home_a'));
        try {
            expect(hook.getCurrent()).toEqual({ show: false, failureCount: 0 });
            await act(async () => { recordFailedHomeReach('srv_home_a', Date.now()); });
            expect(hook.getCurrent()).toEqual({ show: false, failureCount: 1 });
        } finally {
            await hook.unmount();
        }
    });

    it('refreshes web readers on cross-tab storage events and detaches on unmount', async () => {
        const browserWindow = new EventTarget();
        vi.stubGlobal('window', browserWindow);
        const hook = await renderHook(() => useHomeReachNudge('srv_home_a'));
        const notifyOtherTab = () => {
            const event = new Event('storage');
            Object.defineProperty(event, 'key', { value: `${getPersistenceStorageId()}\\home-reach-failures-v2` });
            browserWindow.dispatchEvent(event);
        };
        try {
            await act(async () => {
                getPersistenceStorage().set('home-reach-failures-v2', JSON.stringify({
                    srv_home_a: [{ day: Math.floor(Date.now() / 86_400_000), count: 3 }],
                }));
                notifyOtherTab();
            });
            expect(hook.getCurrent()).toEqual({ show: true, failureCount: 3 });
        } finally {
            await hook.unmount();
        }
        getPersistenceStorage().delete('home-reach-failures-v2');
        notifyOtherTab();
        const remounted = await renderHook(() => useHomeReachNudge('srv_home_a'));
        try {
            expect(remounted.getCurrent()).toEqual({ show: false, failureCount: 0 });
        } finally {
            await remounted.unmount();
        }
    });

    it('updates the mounted reader at the third failure and after permanent dismissal', async () => {
        const hook = await renderHook(() => useHomeReachNudge('srv_home_a'));
        try {
            expect(hook.getCurrent()).toEqual({ show: false, failureCount: 0 });
            await act(async () => {
                recordFailedHomeReach('srv_home_a', Date.now());
                recordFailedHomeReach('srv_home_a', Date.now());
            });
            expect(hook.getCurrent()).toEqual({ show: false, failureCount: 2 });
            await act(async () => { recordFailedHomeReach('srv_home_a', Date.now()); });
            expect(hook.getCurrent()).toEqual({ show: true, failureCount: 3 });
            await act(async () => { dismissHomeReachNudge('srv_home_a'); });
            expect(hook.getCurrent()).toEqual({ show: false, failureCount: 3 });
        } finally {
            await hook.unmount();
        }
    });
});
