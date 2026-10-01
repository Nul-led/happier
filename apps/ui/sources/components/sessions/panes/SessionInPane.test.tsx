import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

/**
 * `SessionView` is the one Session renderer; every transcript and composer subscription lives under
 * it. The probe stands in for it so this test observes exactly what SessionInPane owns: whether that
 * renderer (and so every subscription under it) is mounted, and in which presentation.
 */
const mounted = vi.hoisted(() => ({ count: 0, mounts: 0, lastProps: null as Record<string, unknown> | null }));

vi.mock('@/components/sessions/shell/SessionView', () => ({
    SessionView: (props: Record<string, unknown>) => {
        mounted.lastProps = props;
        React.useEffect(() => {
            mounted.count += 1;
            mounted.mounts += 1;
            return () => {
                mounted.count -= 1;
            };
        }, []);
        return React.createElement('SessionView', props);
    },
}));

describe('SessionInPane', () => {
    afterEach(() => {
        standardCleanup();
        mounted.count = 0;
        mounted.mounts = 0;
        mounted.lastProps = null;
    });

    it('mounts one real Session renderer, embedded with its composer, while active', async () => {
        const { SessionInPane } = await import('./SessionInPane');
        const screen = await renderScreen(
            <SessionInPane sessionId="worker-1" active composer repliesBanner="Replies go to this session" />,
        );

        expect(mounted.count).toBe(1);
        expect(mounted.lastProps).toMatchObject({
            id: 'worker-1',
            presentation: { kind: 'embedded', composer: 'auto', composerControls: 'session', repliesBanner: 'Replies go to this session' },
            routeAnchorOverride: false,
        });
        expect(screen.findByTestId('session-in-pane:worker-1')).not.toBeNull();
    });

    it('holds no transcript or composer subscription while inactive and restores on activation', async () => {
        const { SessionInPane } = await import('./SessionInPane');
        const control: { setActive: ((active: boolean) => void) | null } = { setActive: null };
        function Host() {
            const [active, setActive] = React.useState(true);
            control.setActive = setActive;
            return <SessionInPane sessionId="worker-1" active={active} composer />;
        }
        const screen = await renderScreen(<Host />);
        expect(mounted.count).toBe(1);

        await act(async () => { control.setActive?.(false); });
        expect(mounted.count).toBe(0);
        expect(screen.findByTestId('session-in-pane-inactive:worker-1')).not.toBeNull();

        await act(async () => { control.setActive?.(true); });
        expect(mounted.count).toBe(1);
        // A fresh mount reads the canonical state again; nothing was kept by the pane.
        expect(mounted.mounts).toBe(2);
    });

    it('offers no composer when the host asks for a read-only pane', async () => {
        const { SessionInPane } = await import('./SessionInPane');
        await renderScreen(<SessionInPane sessionId="worker-2" active composer={false} />);
        expect(mounted.lastProps).toMatchObject({ presentation: { kind: 'embedded', composer: 'none' } });
    });
});
