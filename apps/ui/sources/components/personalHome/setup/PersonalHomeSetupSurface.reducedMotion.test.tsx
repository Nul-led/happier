import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { PersonalHomeSetupSurface } from './PersonalHomeSetupSurface';
import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';

const reducedMotionSpy = vi.hoisted(() => vi.fn(() => false));
const withRepeatSpy = vi.hoisted(() => vi.fn());
const withTimingSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotionSpy(),
    readReducedMotionPreference: () => reducedMotionSpy(),
}));

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    const mock = createReanimatedModuleMock();
    return {
        ...mock,
        withRepeat: (...args: Parameters<typeof mock.withRepeat>) => {
            withRepeatSpy(...args);
            return mock.withRepeat(...args);
        },
        withTiming: (...args: Parameters<typeof mock.withTiming>) => {
            withTimingSpy(...args);
            return mock.withTiming(...args);
        },
    };
});

const working: PersonalHomeBootstrapSnapshot = {
    shouldGateShell: true,
    homeReady: false,
    daemonReady: false,
    phase: 'ensuring-home',
    daemonState: 'not-started',
    action: 'none',
};

type SurfaceFacts = Readonly<{ title: string | null; status: string | null; filled: number; activityPresent: boolean }>;

async function readSurfaceFacts(): Promise<SurfaceFacts> {
    const screen = await renderScreen(<PersonalHomeSetupSurface snapshot={working} />);
    const arc = screen.root.findByProps({ testID: 'personal-home-bootstrap-progress-arc' });
    const circumference = Number(String(arc.props.strokeDasharray).split(' ')[0]);
    const header = screen.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header')[0];
    return {
        title: typeof header?.props.children === 'string' ? header.props.children : null,
        status: String(screen.findAllHostsByTestId('personal-home-bootstrap-phase')[0]?.props.children ?? ''),
        filled: 1 - Number(arc.props.strokeDashoffset) / circumference,
        activityPresent: screen.findAllHostsByTestId('personal-home-bootstrap-activity').length === 1,
    };
}

describe('PersonalHomeSetupSurface reduced motion', () => {
    it('keeps every fact and drops only the motion when reduced motion is preferred', async () => {
        reducedMotionSpy.mockReturnValue(false);
        withRepeatSpy.mockClear();
        const animated = await readSurfaceFacts();
        expect(withRepeatSpy).toHaveBeenCalled();

        reducedMotionSpy.mockReturnValue(true);
        withRepeatSpy.mockClear();
        withTimingSpy.mockClear();
        const reduced = await readSurfaceFacts();

        // The working treatment is the only thing that disappears.
        expect(withRepeatSpy).not.toHaveBeenCalled();
        expect(withTimingSpy).not.toHaveBeenCalled();
        // Every fact the animated surface carried survives untouched.
        expect(reduced.title).toBe(animated.title);
        expect(reduced.status).toBe(animated.status);
        expect(reduced.filled).toBeCloseTo(animated.filled, 5);
        expect(reduced.activityPresent).toBe(true);
        expect(animated.activityPresent).toBe(true);
    });
});
