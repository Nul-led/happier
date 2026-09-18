import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

import type { SessionCompanionMutationOutcome } from '../state/useSessionCompanionController';
import {
    SessionCompanionRevealPortProvider,
    useSessionCompanionRevealPort,
} from './SessionCompanionRevealPort';

const outcome = {
    previous: {
        v: 1,
        visible: false,
        collapsed: false,
        edge: 'trailing',
        density: 'comfortable',
        items: [],
    },
    applied: {
        v: 1,
        visible: true,
        collapsed: false,
        edge: 'trailing',
        density: 'comfortable',
        items: [{ kind: 'widget', widgetId: 'item-1' }],
    },
} as const satisfies SessionCompanionMutationOutcome;

describe('SessionCompanionRevealPort', () => {
    it('exposes the shell port only to the exact Home and Session', async () => {
        const reveal = vi.fn();
        const revealBoardItem = vi.fn();
        function Wrapper({ children }: React.PropsWithChildren) {
            return (
                <SessionCompanionRevealPortProvider
                    address={{ serverId: 'home-a', sessionId: 'session-1' }}
                    openFullSurface={() => {}}
                    revealAfterMutation={reveal}
                    revealBoardItem={revealBoardItem}
                >
                    {children}
                </SessionCompanionRevealPortProvider>
            );
        }
        const hook = await renderHook(
            useSessionCompanionRevealPort,
            {
                initialProps: { serverId: 'home-a', sessionId: 'session-1' },
                wrapper: Wrapper,
            },
        );

        hook.getCurrent()?.revealAfterMutation(outcome);
        hook.getCurrent()?.revealBoardItem('item-1');
        expect(reveal).toHaveBeenCalledWith(outcome);
        expect(revealBoardItem).toHaveBeenCalledWith('item-1');
        expect(await hook.rerender({ serverId: 'home-b', sessionId: 'session-1' })).toBeNull();
    });
});
