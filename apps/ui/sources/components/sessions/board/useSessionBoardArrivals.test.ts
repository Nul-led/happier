import { describe, expect, it } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { renderHook } from '@/dev/testkit/hooks/renderHook';

import { useSessionBoardArrivals } from './useSessionBoardArrivals';

type Props = Readonly<{ ids: readonly string[] | null }>;

describe('useSessionBoardArrivals (lab WA: the card that arrives while you look)', () => {
    it('marks only items that appear after the Board first showed its items', async () => {
        const hook = await renderHook((props: Props) => useSessionBoardArrivals(props.ids), {
            initialProps: { ids: null },
        });
        // Hydration is not an arrival: what is already there on first sight never rings.
        let arrivals = await hook.rerender({ ids: ['note', 'chart'] });
        expect([...arrivals]).toEqual([]);

        arrivals = await hook.rerender({ ids: ['note', 'chart', 'failures'] });
        expect([...arrivals]).toEqual(['failures']);

        // It stays marked for this mount (its ring fades by itself) and never spreads to the others.
        arrivals = await hook.rerender({ ids: ['note', 'failures', 'chart'] });
        expect([...arrivals]).toEqual(['failures']);
        standardCleanup();
    });

    it('starts over for a new mount: a remounted Board does not replay old arrivals', async () => {
        const first = await renderHook((props: Props) => useSessionBoardArrivals(props.ids), {
            initialProps: { ids: ['note'] },
        });
        await first.rerender({ ids: ['note', 'failures'] });
        await first.unmount();
        const second = await renderHook((props: Props) => useSessionBoardArrivals(props.ids), {
            initialProps: { ids: ['note', 'failures'] },
        });
        expect([...second.getCurrent()]).toEqual([]);
        standardCleanup();
    });
});
