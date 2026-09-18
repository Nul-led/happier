import { describe, expect, it, vi } from 'vitest';

import {
    notifyExecutionRunActivity,
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
});
