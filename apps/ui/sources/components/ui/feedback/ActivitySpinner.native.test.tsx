import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import type { ActivityIndicatorProps } from 'react-native';

/**
 * `animationEnabled` shipped as a web-only branch, and the native path spread the whole prop bag
 * into `ActivityIndicator`. So every call site that threaded the flag to pause ambient motion
 * paused nothing at all on iOS or Android — the spinner kept turning and an unknown prop went to
 * the platform component. A pause flag that silently does nothing on two of three platforms is
 * worse than no flag: it makes the corridor *look* gated.
 */

const reducedMotionBoundary = vi.hoisted(() => ({
    listener: null as ((enabled: boolean) => void) | null,
}));
const nativeBoundary = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    const React = await import('react');
    return createReactNativeNativeMock({ platformOS: 'ios' }, {
        Platform: { get OS() { return nativeBoundary.os; } },
        View: 'View',
        // RN 0.81 Android ProgressBarContainerView.apply() hides every animating=false widget;
        // hidesWhenStopped is iOS-only. Observe that OS output, rather than just incoming props.
        ActivityIndicator: (props: ActivityIndicatorProps) => React.createElement('ActivityIndicator', {
            ...props,
            nativeVisibility: nativeBoundary.os === 'android' && props.animating === false ? 'invisible' : 'visible',
        }),
        AccessibilityInfo: {
            isReduceMotionEnabled: async () => false,
            addEventListener: (_event: string, listener: (enabled: boolean) => void) => {
                reducedMotionBoundary.listener = listener;
                return { remove: () => { reducedMotionBoundary.listener = null; } };
            },
        },
    });
});

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                text: { secondary: 'theme-secondary-text' },
                accent: { indigo: 'accent-indigo', purple: 'accent-purple', orange: 'accent-orange' },
            },
        },
    });
});

const localSettingValues: Partial<LocalSettings> = {};

vi.mock('@/sync/store/hooks', async () => {
    const { createUseLocalSettingMock } = await import('@/dev/testkit/mocks/storage');
    const useLocalSetting = createUseLocalSettingMock();
    return {
        useLocalSetting: (key: keyof LocalSettings) => (key in localSettingValues ? localSettingValues[key] : useLocalSetting(key)),
    };
});

beforeEach(() => {
    nativeBoundary.os = 'ios';
    for (const key of Object.keys(localSettingValues)) delete localSettingValues[key as keyof LocalSettings];
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce((acc, item) => Object.assign(acc, flattenStyle(item)), {} as Record<string, unknown>);
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

async function renderClassicSpinner(props: Record<string, unknown>) {
    localSettingValues.loadingIndicatorStyle = 'classicRing';
    const { ActivitySpinner } = await import('./ActivitySpinner');
    const screen = await renderScreen(<ActivitySpinner testID="spinner" size={16} {...props} />);
    mountedScreens.push(screen);
    const nodes = screen.findAllByType('ActivityIndicator' as never);
    expect(nodes.length).toBe(1);
    return nodes[0]!.props as Record<string, unknown>;
}

type MountedScreen = Awaited<ReturnType<typeof renderScreen>>;
const mountedScreens: MountedScreen[] = [];

/** The shared clocks live at module level, so every test leaves nothing mounted behind it. */
async function unmountAll() {
    for (const screen of mountedScreens.splice(0)) await screen.unmount();
}

afterEach(unmountAll);

type InterpolationStub = { parent: unknown; config: { inputRange: number[]; outputRange: (number | string)[] } };

function findDots(screen: MountedScreen) {
    return screen.findAllByType('Animated.View' as never).filter((node) => (node.props as { testID?: string }).testID === 'activity-spinner-dot');
}

async function runningNativeLoops(): Promise<number> {
    const { animatedLoops } = await import('@/dev/reactNativeStub');
    return animatedLoops.size;
}

async function renderDotSpinner(props: Record<string, unknown>) {
    const { ActivitySpinner } = await import('./ActivitySpinner');
    const screen = await renderScreen(<ActivitySpinner testID="spinner" size={18} {...props} />);
    mountedScreens.push(screen);
    return { screen, dots: findDots(screen), running: await runningNativeLoops() };
}

describe('ActivitySpinner (native)', () => {
    it('draws the H with seven dots whose brightness the native driver reads from the frame table', async () => {
        const { getDotSpinnerFrames, readDotSeries } = await import('./activitySpinner/dotSpinnerFrames');
        const { screen, dots, running } = await renderDotSpinner({});

        expect(screen.findAllByType('ActivityIndicator' as never)).toHaveLength(0);
        expect(dots).toHaveLength(7);
        expect(running).toBe(1);
        const firstDot = flattenStyle(dots[0]!.props.style);
        expect(firstDot.backgroundColor).toBe('theme-secondary-text');
        expect(firstDot.width).toBe(3);

        const frames = getDotSpinnerFrames('wave');
        const series = readDotSeries(frames.opacity, 0, frames.frameCount);
        const opacity = firstDot.opacity as InterpolationStub;
        expect(opacity.config.outputRange).toEqual([...series, series[0]]);
        expect(opacity.config.inputRange[0]).toBe(0);
        expect(opacity.config.inputRange.at(-1)).toBe(1);
    });

    it('drives every spinner of a style from one shared native loop and stops it when the last one leaves', async () => {
        const { ActivitySpinner } = await import('./ActivitySpinner');
        const screen = await renderScreen(
            <>
                <ActivitySpinner size={18} />
                <ActivitySpinner size={12} />
            </>,
        );
        mountedScreens.push(screen);

        expect(findDots(screen)).toHaveLength(14);
        expect(await runningNativeLoops()).toBe(1);

        await unmountAll();
        expect(await runningNativeLoops()).toBe(0);
    });

    it('runs no loop and holds the full H when ambient motion is paused', async () => {
        const { dots, running } = await renderDotSpinner({ animationEnabled: false });

        expect(running).toBe(0);
        expect(dots.map((dot) => flattenStyle(dot.props.style).opacity)).toEqual(Array(7).fill(0.85));
    });

    it('releases its loop while the app is in the background and takes it back on return', async () => {
        const { AppState } = await import('react-native');
        const { act } = await import('react-test-renderer');
        const { createReactNativeAppStateEmitter } = await import('@/dev/testkit');
        const appState = createReactNativeAppStateEmitter();
        const restoreAppState = appState.install(AppState);
        try {
            await renderDotSpinner({});
            expect(await runningNativeLoops()).toBe(1);

            await act(async () => appState.emit('background'));
            expect(await runningNativeLoops()).toBe(0);

            await act(async () => appState.emit('active'));
            expect(await runningNativeLoops()).toBe(1);
        } finally {
            restoreAppState();
        }
    });

    it('keeps the layout box but draws nothing when stopped and hidden', async () => {
        const { dots, running } = await renderDotSpinner({ animating: false });

        expect(dots).toHaveLength(0);
        expect(running).toBe(0);
    });

    it('animates aurora colour on the native driver too, through the theme accents', async () => {
        const { dots } = await renderDotSpinner({ variant: 'aurora' });

        const color = flattenStyle(dots[0]!.props.style).backgroundColor as InterpolationStub;
        // Clock -> unwrapped hue -> accent gradient: both steps are interpolations, so no JS runs per frame.
        expect((color.parent as InterpolationStub).config.inputRange[0]).toBe(0);
        expect(color.config.outputRange).toEqual(expect.arrayContaining(['accent-indigo', 'accent-purple', 'accent-orange']));
    });

    it('breathes the still H from one shared loop under reduced motion', async () => {
        const { DotSpinnerNative } = await import('./activitySpinner/DotSpinnerNative');
        const screen = await renderScreen(
            <DotSpinnerNative styleId="wave" size={18} ink={{ color: 'ink' }} motion="breathe" hidden={false} viewProps={{ testID: 'spinner' }} />,
        );
        mountedScreens.push(screen);

        expect(await runningNativeLoops()).toBe(1);
        expect(findDots(screen).map((dot) => flattenStyle(dot.props.style).opacity)).toEqual(Array(7).fill(0.85));
        const layer = screen.findAllByType('Animated.View' as never).find((node) => (node.props as { testID?: string }).testID === 'spinner');
        expect((flattenStyle(layer!.props.style).opacity as InterpolationStub).config.outputRange).toEqual([1, 0.45]);
    });

    describe('classic ring', () => {
        it.each([
            { pause: 'ambient', size: 'small', expectedSize: 20 },
            { pause: 'reduced motion', size: 'large', expectedSize: 36 },
            { pause: 'explicit stop', size: 16, expectedSize: 16 },
        ] as const)('keeps a visible still Android ring during $pause', async ({ pause, size, expectedSize }) => {
            nativeBoundary.os = 'android';
            localSettingValues.loadingIndicatorStyle = 'classicRing';
            const { ActivitySpinner } = await import('./ActivitySpinner');
            const { act } = await import('react-test-renderer');
            const screen = await renderScreen(<ActivitySpinner
                testID="spinner"
                accessibilityLabel="Working"
                size={size}
                color="#2468ab"
                style={{ marginLeft: 7 }}
                animationEnabled={pause !== 'ambient'}
                {...(pause === 'explicit stop' ? { animating: false, hidesWhenStopped: false } : {})}
            />);
            mountedScreens.push(screen);
            try {
                if (pause === 'reduced motion') await act(async () => reducedMotionBoundary.listener?.(true));
                const nativeWidgets = screen.findAllByType('ActivityIndicator' as never);
                const rings = screen.findAllByType('View' as never).filter((node) => flattenStyle(node.props.style).borderWidth);
                expect(nativeWidgets.some((node) => node.props.nativeVisibility === 'visible') || rings.length > 0).toBe(true);
                expect(nativeWidgets).toHaveLength(0);
                expect(rings).toHaveLength(1);
                const ring = rings[0]!;
                expect(flattenStyle(ring.props.style)).toMatchObject({ width: expectedSize, height: expectedSize, borderColor: '#2468ab', marginLeft: 7, opacity: 1 });
                expect(flattenStyle(ring.props.style)).not.toHaveProperty('animationName');
                expect(ring.props).toMatchObject({ testID: 'spinner', accessibilityRole: 'progressbar', accessibilityLabel: 'Working' });
            } finally {
                if (pause === 'reduced motion') await act(async () => reducedMotionBoundary.listener?.(false));
            }
        });

        it('retains the Android platform widget when turning or explicitly stopped and hidden', async () => {
            nativeBoundary.os = 'android';
            expect((await renderClassicSpinner({})).nativeVisibility).toBe('visible');
            expect((await renderClassicSpinner({ animating: false })).nativeVisibility).toBe('invisible');
            expect((await renderClassicSpinner({ animating: false, hidesWhenStopped: true })).nativeVisibility).toBe('invisible');
        });

        it('animates by default and never hands the platform component an unknown prop', async () => {
            const props = await renderClassicSpinner({});

            expect(props.animating).toBeUndefined();
            expect(props).not.toHaveProperty('animationEnabled');
            expect(props).not.toHaveProperty('variant');
        });

        it('actually stops the native spinner when ambient motion is paused, and keeps it visible', async () => {
            const props = await renderClassicSpinner({ animationEnabled: false });

            // Stopped, not hidden: `hidesWhenStopped` defaults to true, so pausing without this would
            // make the running mark vanish — the row would read as "no longer working".
            expect(props.animating).toBe(false);
            expect(props.hidesWhenStopped).toBe(false);
            expect(props).not.toHaveProperty('animationEnabled');
        });

        it('preserves explicit stopped visibility under reduced motion and ambient pause', async () => {
            const { act } = await import('react-test-renderer');
            await renderClassicSpinner({});
            try {
                await act(async () => reducedMotionBoundary.listener?.(true));
                const running = await renderClassicSpinner({});
                expect(running.animating).toBe(false);
                expect(running.hidesWhenStopped).toBe(false);

                const hidden = await renderClassicSpinner({ animating: false, animationEnabled: false });
                expect(hidden.animating).toBe(false);
                expect(hidden.hidesWhenStopped).toBeUndefined();
                const explicitlyHidden = await renderClassicSpinner({ animating: false, hidesWhenStopped: true });
                expect(explicitlyHidden.hidesWhenStopped).toBe(true);
                const visible = await renderClassicSpinner({ animating: false, hidesWhenStopped: false });
                expect(visible.hidesWhenStopped).toBe(false);
            } finally {
                await act(async () => reducedMotionBoundary.listener?.(false));
            }
        });

        it('leaves an explicitly stopped spinner alone, so hiding it stays the caller\'s decision', async () => {
            const props = await renderClassicSpinner({ animating: false });

            expect(props.animating).toBe(false);
            expect(props.hidesWhenStopped).toBeUndefined();
        });
    });
});
