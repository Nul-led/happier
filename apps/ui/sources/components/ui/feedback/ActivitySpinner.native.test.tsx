import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';

/**
 * Core draws native spinners through the same shared dot owner plugins use; the native-driver clock
 * itself is proven at that owner (`packages/plugin-ui/src/presentation/feedback/Spinner.native.test.tsx`).
 * Here the contract is core's: its colour, its setting, and the pause/reduced-motion facts it injects.
 */
const reducedMotionState = vi.hoisted(() => ({ current: false }));
const localSettingValues = vi.hoisted(() => ({}) as Partial<Record<string, unknown>>);
/** `Animated.loop` hands the clock to the native driver; recording start/stop is the observable boundary. */
const animatedLoops = vi.hoisted(() => [] as Array<{ started: number; stopped: number }>);

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotionState.current,
}));

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' }, {
        View: 'View',
        ActivityIndicator: 'ActivityIndicator',
        Animated: {
            loop: () => {
                const record = { started: 0, stopped: 0 };
                animatedLoops.push(record);
                return { start: () => { record.started += 1; }, stop: () => { record.stopped += 1; } };
            },
        },
    });
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

vi.mock('@/sync/store/hooks', async () => {
    const { createUseLocalSettingMock } = await import('@/dev/testkit/mocks/storage');
    return { useLocalSetting: createUseLocalSettingMock({ values: localSettingValues as Partial<LocalSettings> }) };
});

beforeEach(() => {
    reducedMotionState.current = false;
    animatedLoops.length = 0;
    for (const key of Object.keys(localSettingValues)) delete localSettingValues[key];
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce((acc, item) => Object.assign(acc, flattenStyle(item)), {} as Record<string, unknown>);
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

async function renderSpinner(props: Record<string, unknown>) {
    const { ActivitySpinner } = await import('./ActivitySpinner');
    const screen = await renderScreen(<ActivitySpinner testID="spinner" size={18} {...props} />);
    const dots = screen.findAll((node) => (node.props as { testID?: string }).testID === 'happier-spinner-dot');
    const rings = screen.findAllByType('ActivityIndicator' as never);
    return { screen, dots, rings };
}

describe('ActivitySpinner (native)', () => {
    it('draws the H with the shared dot owner in core colour', async () => {
        const { dots, rings } = await renderSpinner({});

        expect(rings).toHaveLength(0);
        expect(dots).toHaveLength(7);
        expect(flattenStyle(dots[0]!.props.style)).toMatchObject({ width: 3, backgroundColor: 'theme-secondary-text' });
    });

    it('holds the full H still when ambient motion is paused', async () => {
        const { dots } = await renderSpinner({ animationEnabled: false });

        expect(dots.map((dot) => flattenStyle(dot.props.style).opacity)).toEqual(Array(7).fill(0.85));
    });

    it('holds the full H still under reduced motion', async () => {
        reducedMotionState.current = true;
        const { dots } = await renderSpinner({});

        expect(dots.map((dot) => flattenStyle(dot.props.style).opacity)).toEqual(Array(7).fill(0.85));
    });

    it('releases its clock while the app is in the background and takes it back on return', async () => {
        // A fresh module graph, so the one app-wide visibility watch subscribes to this AppState.
        vi.resetModules();
        const { AppState } = await import('react-native');
        const { act } = await import('react-test-renderer');
        const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
        const appState = createReactNativeAppStateEmitter();
        const restoreAppState = appState.install(AppState);
        const running = () => animatedLoops.filter((loop) => loop.started > loop.stopped).length;
        try {
            const { dots } = await renderSpinner({});
            expect(running()).toBe(1);

            await act(async () => appState.emit('background'));
            expect(running()).toBe(0);
            expect(dots).toHaveLength(7);

            await act(async () => appState.emit('active'));
            expect(running()).toBe(1);
        } finally {
            restoreAppState();
        }
    });

    describe('classic ring', () => {
        it('animates by default and never hands the platform component an unknown prop', async () => {
            localSettingValues.loadingIndicatorStyle = 'classicRing';
            const { rings } = await renderSpinner({});
            const props = rings[0]!.props as Record<string, unknown>;

            expect(rings).toHaveLength(1);
            expect(props.animating).toBeUndefined();
            expect(props.color).toBe('theme-secondary-text');
            expect(props).not.toHaveProperty('animationEnabled');
            expect(props).not.toHaveProperty('variant');
        });

        it('actually stops the native ring when ambient motion is paused, and keeps it visible', async () => {
            localSettingValues.loadingIndicatorStyle = 'classicRing';
            const { rings } = await renderSpinner({ animationEnabled: false });
            const props = rings[0]!.props as Record<string, unknown>;

            expect(props.animating).toBe(false);
            expect(props.hidesWhenStopped).toBe(false);
        });

        it('leaves an explicitly stopped ring alone, so hiding it stays the caller\'s decision', async () => {
            localSettingValues.loadingIndicatorStyle = 'classicRing';
            const { rings } = await renderSpinner({ animating: false });
            const props = rings[0]!.props as Record<string, unknown>;

            expect(props.animating).toBe(false);
            expect(props.hidesWhenStopped).toBeUndefined();
        });
    });
});
