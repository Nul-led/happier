import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit';

import {
    publishSessionCompanionCardBounds,
    useSessionCompanionCardBounds,
} from './sessionCompanionCardMeasurement';

const identityA = {
    sessionId: 'session-a',
    serverId: 'server-a',
    paneScopeId: 'pane-a',
    density: 'compact' as const,
    fontScale: 1,
};
const identityB = {
    sessionId: 'session-b',
    serverId: 'server-a',
    paneScopeId: 'pane-a',
    density: 'compact' as const,
    fontScale: 1,
};

describe('sessionCompanionCardMeasurement', () => {
    it('updates only the mounted placement identity whose cards were measured', async () => {
        let rendersA = 0;
        let rendersB = 0;
        const probeA = await renderHook(() => {
            rendersA += 1;
            return useSessionCompanionCardBounds(identityA);
        });
        const probeB = await renderHook(() => {
            rendersB += 1;
            return useSessionCompanionCardBounds(identityB);
        });
        const initialRendersA = rendersA;
        const initialRendersB = rendersB;

        act(() => publishSessionCompanionCardBounds(identityA, { widthPx: 279.2, heightPx: 167.1 }));

        expect(probeA.getCurrent()).toEqual({ widthPx: 280, heightPx: 168 });
        expect(probeB.getCurrent()).toBeNull();
        expect(rendersA).toBe(initialRendersA + 1);
        expect(rendersB).toBe(initialRendersB);
        await probeA.unmount();
        await probeB.unmount();
    });

    it('retains a rail measurement only while that exact placement consumer is mounted', async () => {
        publishSessionCompanionCardBounds(identityA, { widthPx: 300, heightPx: 180 });
        const first = await renderHook(() => useSessionCompanionCardBounds(identityA));
        expect(first.getCurrent()).toEqual({ widthPx: 300, heightPx: 180 });
        await first.unmount();

        const remounted = await renderHook(() => useSessionCompanionCardBounds(identityA));
        expect(remounted.getCurrent()).toBeNull();
        await remounted.unmount();
    });

    it('invalidates measurement across density and font-scale changes without coupling window width', async () => {
        const comfortableIdentity = { ...identityA, density: 'comfortable' as const };
        const largeTextIdentity = { ...identityA, fontScale: 2 };
        const compact = await renderHook(() => useSessionCompanionCardBounds(identityA));
        const comfortable = await renderHook(() => useSessionCompanionCardBounds(comfortableIdentity));
        const largeText = await renderHook(() => useSessionCompanionCardBounds(largeTextIdentity));

        act(() => publishSessionCompanionCardBounds(identityA, { widthPx: 264, heightPx: 180 }));

        expect(compact.getCurrent()).toEqual({ widthPx: 264, heightPx: 180 });
        expect(comfortable.getCurrent()).toBeNull();
        expect(largeText.getCurrent()).toBeNull();

        await compact.unmount();
        await comfortable.unmount();
        await largeText.unmount();
    });
});
