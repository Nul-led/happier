import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const accessibilityState = vi.hoisted(() => ({
    reduceMotion: false,
    listeners: [] as Array<(enabled: boolean) => void>,
}));

const contentState = vi.hoisted(() => ({
    mounts: 0,
}));

/**
 * The recede is the native switcher's answer, so this runs on a native platform, and the
 * reduced-motion preference is driven through the accessibility boundary its canonical
 * hook listens to rather than by mocking the hook itself.
 */
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' }, {
        AccessibilityInfo: {
            isReduceMotionEnabled: () => Promise.resolve(accessibilityState.reduceMotion),
            addEventListener: (event: string, listener: (enabled: boolean) => void) => {
                if (event === 'reduceMotionChanged') accessibilityState.listeners.push(listener);
                return { remove: () => {} };
            },
        },
    });
});

function setReducedMotion(enabled: boolean): void {
    accessibilityState.reduceMotion = enabled;
    for (const listener of [...accessibilityState.listeners]) {
        listener(enabled);
    }
}

function SessionContentProbe(): React.ReactElement {
    // Mount-counting on purpose: the whole point of a container-level transform is that
    // the session tree under it is never re-created by the gesture.
    React.useEffect(() => {
        contentState.mounts += 1;
    }, []);
    return React.createElement('SessionContentProbe', { testID: 'session-content-probe' });
}

type Harness = {
    open?: { value: number };
    rerender?: () => void;
};

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function readContentMotion(screen: Awaited<ReturnType<typeof renderScreen>>) {
    const host = screen.findHostByTestId('session-cockpit-swipe-content');
    const style = flattenStyle(host?.props.style);
    const transform = (style.transform ?? []) as ReadonlyArray<Record<string, number>>;
    return {
        translateY: transform.find((entry) => 'translateY' in entry)?.translateY,
        scale: transform.find((entry) => 'scale' in entry)?.scale,
    };
}

async function renderSwitcherContent() {
    const harness: Harness = {};
    const { SessionSwitcherContent } = await import('./SessionSwitcherContent');
    const { SessionCockpitChromeRegistryProvider, useSessionSwitcherState } = await import(
        '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry'
    );

    function SwitcherContentHarness() {
        const switcher = useSessionSwitcherState();
        const [, force] = React.useReducer((current: number) => current + 1, 0);
        harness.open = switcher.open;
        harness.rerender = force;
        return (
            <SessionSwitcherContent>
                <SessionContentProbe />
            </SessionSwitcherContent>
        );
    }

    const screen = await renderScreen(
        <SessionCockpitChromeRegistryProvider>
            <SwitcherContentHarness />
        </SessionCockpitChromeRegistryProvider>,
    );
    return { harness, screen };
}

describe('SessionSwitcherContent', () => {
    afterEach(() => {
        standardCleanup();
        // The preference store keeps ONE process-wide platform listener, so the
        // listener list is not test state to clear — only the value is.
        setReducedMotion(false);
        contentState.mounts = 0;
    });

    it('adds nothing to the session content while the switcher is closed', async () => {
        const { screen } = await renderSwitcherContent();

        expect(screen.findAllHostsByTestId('session-content-probe')).toHaveLength(1);
        expect(readContentMotion(screen)).toEqual({ translateY: 0, scale: 1 });
    });

    it('steps the session back while the switcher is open', async () => {
        const { harness, screen } = await renderSwitcherContent();

        act(() => {
            harness.open!.value = 1;
            harness.rerender!();
        });

        const motion = readContentMotion(screen);
        expect(motion.scale).toBeCloseTo(0.94, 5);
        expect(motion.translateY).toBeLessThan(0);
    });

    it('keeps the session subtree mounted across the whole gesture', async () => {
        const { harness, screen } = await renderSwitcherContent();

        expect(contentState.mounts).toBe(1);
        for (const value of [0.4, 1, 0]) {
            act(() => {
                harness.open!.value = value;
                harness.rerender!();
            });
        }

        // A remount here would throw away the transcript the motion exists to protect.
        expect(contentState.mounts).toBe(1);
        expect(screen.findAllHostsByTestId('session-content-probe')).toHaveLength(1);
    });

    it('does not move the session under reduced motion', async () => {
        const { harness, screen } = await renderSwitcherContent();

        await act(async () => {
            setReducedMotion(true);
        });
        act(() => {
            harness.open!.value = 1;
            harness.rerender!();
        });

        expect(readContentMotion(screen)).toEqual({ translateY: 0, scale: 1 });
        expect(screen.findAllHostsByTestId('session-content-probe')).toHaveLength(1);
    });
});
