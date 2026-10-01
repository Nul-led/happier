import { describe, expect, it } from 'vitest';

import type { PersonalHomeBootstrapSnapshot } from '../bootstrap/personalHomeBootstrapTypes';
import {
    PERSONAL_HOME_SETUP_MILESTONES,
    derivePersonalHomeSetupProgress,
} from './personalHomeSetupProgress';

const base: PersonalHomeBootstrapSnapshot = {
    shouldGateShell: true,
    homeReady: false,
    daemonReady: false,
    phase: 'checking',
    daemonState: 'not-started',
    action: 'none',
    progressMilestones: {
        runtimeHealthy: false,
        identityVerified: false,
        authenticated: false,
        signupClosed: false,
    },
};

describe('derivePersonalHomeSetupProgress', () => {
    it('advances only on facts the snapshot proves, in quantised milestone steps', () => {
        const total = PERSONAL_HOME_SETUP_MILESTONES.length;
        const checking = derivePersonalHomeSetupProgress(base);
        const runtimeHealthy = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ensuring-home',
            progressMilestones: { ...base.progressMilestones!, runtimeHealthy: true },
        });
        const identityVerified = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ensuring-home',
            progressMilestones: {
                ...base.progressMilestones!,
                runtimeHealthy: true,
                identityVerified: true,
            },
        });
        const authenticated = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ensuring-home',
            progressMilestones: {
                ...base.progressMilestones!,
                runtimeHealthy: true,
                identityVerified: true,
                authenticated: true,
            },
        });
        const preparingComputer = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'preparing-computer',
            homeReady: true,
            shouldGateShell: false,
            progressMilestones: {
                runtimeHealthy: true,
                identityVerified: true,
                authenticated: true,
                signupClosed: true,
            },
        });
        const ready = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ready',
            homeReady: true,
            daemonReady: true,
            daemonState: 'ready',
            shouldGateShell: false,
            progressMilestones: {
                runtimeHealthy: true,
                identityVerified: true,
                authenticated: true,
                signupClosed: true,
            },
        });

        expect(checking.completedMilestones).toBe(0);
        expect(runtimeHealthy.completedMilestones).toBe(1);
        expect(identityVerified.completedMilestones).toBe(2);
        expect(authenticated.completedMilestones).toBe(3);
        expect(preparingComputer.completedMilestones).toBe(4);
        expect(ready.completedMilestones).toBe(total);

        for (const progress of [checking, runtimeHealthy, identityVerified, authenticated, preparingComputer, ready]) {
            expect(progress.totalMilestones).toBe(total);
            // Every fraction is exactly a completed-milestone quotient: no interpolation, no fill.
            expect(progress.fraction).toBe(progress.completedMilestones / total);
        }
    });

    it('never claims a later milestone while an earlier one is unproven', () => {
        // A daemon can be ready for a Home whose profile adoption is still unproven; the ordered
        // milestone prefix must not jump over `ensure-home-ready`.
        const progress = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ensuring-home',
            homeReady: false,
            daemonReady: true,
            daemonState: 'ready',
            progressMilestones: {
                runtimeHealthy: true,
                identityVerified: false,
                authenticated: true,
                signupClosed: true,
            },
        });

        expect(progress.completedMilestones).toBe(1);
        expect(progress.fraction).toBe(1 / 5);
    });

    it('keeps the proven facts visible when setup is blocked and stops the working treatment', () => {
        const blocked = derivePersonalHomeSetupProgress({
            ...base,
            phase: 'blocked',
            action: 'retry',
            detail: { message: 'Needs attention', retryable: true },
        });

        expect(blocked.completedMilestones).toBe(0);
        expect(blocked.working).toBe(false);
    });

    it('marks exactly the operating phases as working', () => {
        expect(derivePersonalHomeSetupProgress(base).working).toBe(true);
        expect(derivePersonalHomeSetupProgress({ ...base, phase: 'ensuring-home' }).working).toBe(true);
        expect(derivePersonalHomeSetupProgress({ ...base, phase: 'preparing-computer', homeReady: true }).working).toBe(true);
        expect(derivePersonalHomeSetupProgress({
            ...base,
            phase: 'ready',
            homeReady: true,
            daemonReady: true,
        }).working).toBe(false);
    });
});
