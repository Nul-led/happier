import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

const initialState = storage.getState();

function setOrdinaryMembership(membership: Readonly<Record<string, readonly string[]>>): void {
    storage.setState((state) => ({
        ...state,
        sessions: {},
        ordinarySessionListMembershipByServerId: membership,
        sessionListIndexByServerId: {},
        sessionListRowsByServerId: {},
        concurrentSessionListCacheByServerId: {},
    }), true);
}

describe('usePreferredServerIdForSession', () => {
    beforeEach(() => {
        storage.setState(initialState, true);
    });

    afterEach(() => {
        standardCleanup();
        storage.setState(initialState, true);
    });

    it('keeps an exact Home authoritative before and after same-id cache hydration', async () => {
        setOrdinaryMembership({ 'home-a': ['same-session'] });
        const { usePreferredServerIdForSession } = await import('./usePreferredServerIdForSession');
        const hook = await renderHook(() => usePreferredServerIdForSession({
            serverId: 'home-b',
            sessionId: 'same-session',
        }));

        expect(hook.getCurrent()).toBe('home-b');

        setOrdinaryMembership({
            'home-a': ['same-session'],
            'home-b': ['same-session'],
        });
        await hook.rerender();

        expect(hook.getCurrent()).toBe('home-b');
        await hook.unmount();
    });

    it('retains fail-closed ambiguity for a legacy target with no authoritative Home', async () => {
        setOrdinaryMembership({ 'home-a': ['same-session'] });
        const { usePreferredServerIdForSession } = await import('./usePreferredServerIdForSession');
        const hook = await renderHook(() => usePreferredServerIdForSession({
            serverId: null,
            sessionId: 'same-session',
        }));

        expect(hook.getCurrent()).toBe('home-a');

        setOrdinaryMembership({
            'home-a': ['same-session'],
            'home-b': ['same-session'],
        });
        await hook.rerender();

        expect(hook.getCurrent()).toBeNull();
        await hook.unmount();
    });
});
