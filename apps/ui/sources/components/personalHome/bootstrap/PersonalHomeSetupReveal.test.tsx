import * as React from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';

import { PersonalHomeBootstrapGate } from './PersonalHomeBootstrapGate';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

const reducedMotionSpy = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotionSpy(),
    readReducedMotionPreference: () => reducedMotionSpy(),
}));

const pendingFacts: PersonalHomeFacts = {
    hostIsDesktop: true,
    isDesktopMainWindow: true,
    explicitlySelectedOtherHome: false,
    completedPersonalHomeProfile: null,
    candidateLocalProfile: null,
    relayRuntime: null,
    localHomeReachability: 'unknown',
    localHomeIdentity: null,
    localHomeAuth: 'unknown',
    anonymousSignup: 'unknown',
    daemon: null,
    activeTask: null,
};

const homeReadyFacts: PersonalHomeFacts = {
    ...pendingFacts,
    relayRuntime: {
        relayUrl: 'http://127.0.0.1:3005',
        installed: true,
        healthy: true,
        serviceActive: true,
        status: 'healthy',
        anonymousSignupEnabled: false,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:3005' },
    },
    localHomeReachability: 'reachable',
    localHomeIdentity: 'srv_home_b',
    localHomeAuth: 'present',
    anonymousSignup: 'disabled',
    completedPersonalHomeProfile: {
        id: 'p1',
        name: 'Personal Home',
        serverUrl: 'http://127.0.0.1:3005',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
        source: 'desktop-personal-home',
    },
    daemon: { serviceInstalled: true, daemonRunning: true, needsAuth: false, machineId: 'machine_1' },
};

/** Runs the real first-run path: gated on `ensure-home-ready`, then released by its completion. */
async function renderBootstrapThroughHomeReady() {
    let homeReady = false;
    let releaseHome!: () => void;
    const ensureHomeReady = vi.fn(() => new Promise<void>((resolve) => {
        releaseHome = () => {
            homeReady = true;
            resolve();
        };
    }));
    const screen = await renderScreen(
        <PersonalHomeBootstrapGate
            isDesktopHost
            isDesktopMainWindow
            readFacts={async () => homeReady ? homeReadyFacts : pendingFacts}
            operations={{ 'ensure-home-ready': ensureHomeReady }}
        >
            <View testID="normal-shell" />
        </PersonalHomeBootstrapGate>,
    );

    await flushHookEffects({ cycles: 4, turns: 2 });
    // The user is reading the setup frame while `ensure-home-ready` runs; nothing is released yet.
    expect(ensureHomeReady).toHaveBeenCalled();
    expect(screen.findByTestId('personal-home-setup-surface')).not.toBeNull();
    expect(screen.findByTestId('normal-shell')).toBeNull();

    releaseHome();
    await flushHookEffects({ cycles: 6, turns: 3 });
    return screen;
}

describe('Personal Home shell reveal', () => {
    it('settles the departing setup frame over the released shell instead of cutting to it', async () => {
        reducedMotionSpy.mockReturnValue(false);
        const screen = await renderBootstrapThroughHomeReady();

        // The shell is live underneath while the setup frame is still on screen: a crossfade, not a cut.
        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        const reveal = screen.findAllHostsByTestId('personal-home-setup-reveal');
        expect(reveal).toHaveLength(1);
        expect(reveal[0]?.props.pointerEvents).toBe('none');
        expect(screen.findByTestId('personal-home-setup-surface')).not.toBeNull();
    });

    it('swaps immediately under reduced motion, with the shell as the only frame', async () => {
        reducedMotionSpy.mockReturnValue(true);
        const screen = await renderBootstrapThroughHomeReady();

        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        expect(screen.findByTestId('personal-home-setup-reveal')).toBeNull();
        expect(screen.findByTestId('personal-home-setup-surface')).toBeNull();
    });
});
