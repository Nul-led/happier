import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { DestinationInstanceHost } from '@/components/appShell/workspace/DestinationInstanceHost';
import { useSessionScreenIsFocused } from './useSessionScreenIsFocused';

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

function SessionFocusProbe() {
    return React.createElement('SessionFocusProbe', { focused: useSessionScreenIsFocused() });
}

describe('session destination focus', () => {
    it('uses the individual session tab focus when two session views share one route', async () => {
        const screen = await renderScreen(<>
            <DestinationInstanceHost tabId="a" ref={{ kind: 'session', params: { id: 'A', serverId: 'home-a' } }} pathname="/session/A" focused visible>
                <SessionFocusProbe />
            </DestinationInstanceHost>
            <DestinationInstanceHost tabId="b" ref={{ kind: 'session', params: { id: 'B', serverId: 'home-b' } }} pathname="/session/B" focused={false} visible>
                <SessionFocusProbe />
            </DestinationInstanceHost>
        </>);
        expect(screen.root.findAllByType('SessionFocusProbe').map((node) => node.props.focused)).toEqual([true, false]);
    });
});
