import { describe, expect, it, vi } from 'vitest';

import {
    notifyExecutionRunActivity,
    notifyExecutionRunActivityReconnect,
    subscribeExecutionRunActivity,
} from './executionRunActivityBus';

describe('executionRunActivityBus', () => {
    it('isolates listeners for duplicate raw Session ids across Homes', () => {
        const homeAListener = vi.fn();
        const homeBListener = vi.fn();
        const unsubscribeHomeA = subscribeExecutionRunActivity(
            { serverId: 'home-a', sessionId: 'same-session' },
            homeAListener,
        );
        const unsubscribeHomeB = subscribeExecutionRunActivity(
            { serverId: 'home-b', sessionId: 'same-session' },
            homeBListener,
        );

        notifyExecutionRunActivity({ serverId: 'home-b', sessionId: 'same-session' });

        expect(homeAListener).not.toHaveBeenCalled();
        expect(homeBListener).toHaveBeenCalledTimes(1);

        unsubscribeHomeA();
        unsubscribeHomeB();
    });

    it('catches up only demanded addresses in the reconnected Home', () => {
        const homeAListener = vi.fn();
        const homeBListener = vi.fn();
        const unsubscribeA = subscribeExecutionRunActivity({ serverId: 'home-a', sessionId: 's1' }, homeAListener);
        const unsubscribeB = subscribeExecutionRunActivity({ serverId: 'home-b', sessionId: 's1' }, homeBListener);
        notifyExecutionRunActivityReconnect('home-b');
        expect(homeAListener).not.toHaveBeenCalled();
        expect(homeBListener).toHaveBeenCalledWith({ runId: null });
        unsubscribeB();
        homeBListener.mockClear();
        notifyExecutionRunActivityReconnect('home-b');
        expect(homeBListener).not.toHaveBeenCalled();
        unsubscribeA();
    });
});
