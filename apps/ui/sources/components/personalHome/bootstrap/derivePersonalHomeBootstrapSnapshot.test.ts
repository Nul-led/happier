import { describe, expect, it } from 'vitest';

import { derivePersonalHomeBootstrapSnapshot } from './derivePersonalHomeBootstrapSnapshot';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

const profile = {
    id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:53288',
    createdAt: 1, updatedAt: 1, lastUsedAt: 1,
} as const;

function facts(overrides: Partial<PersonalHomeFacts> = {}): PersonalHomeFacts {
    return {
        hostIsDesktop: true,
        isDesktopMainWindow: true,
        explicitlySelectedOtherHome: false,
        completedPersonalHomeProfile: null,
        candidateLocalProfile: null,
        relayRuntime: {
            installed: true,
            healthy: true,
            status: 'healthy',
            purpose: {
                kind: 'personal-home',
                canonicalServerUrl: 'http://127.0.0.1:53288',
            },
        },
        localHomeReachability: 'reachable',
        localHomeIdentity: 'home-1',
        localHomeAuth: 'present',
        anonymousSignup: 'disabled',
        daemon: null,
        activeTask: null,
        ...overrides,
    };
}

describe('derivePersonalHomeBootstrapSnapshot', () => {
    it('gates while the managed Home runtime is missing', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ relayRuntime: null }));
        expect(snapshot.phase).toBe('preparing-home');
        expect(snapshot.shouldGateShell).toBe(true);
        expect(snapshot.rows[0]).toMatchObject({ id: 'home', status: 'active' });
    });

    it('shows idle unhealthy runtime state as actionable recovery instead of active progress', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            relayRuntime: {
                installed: true,
                healthy: false,
                status: 'needs-repair',
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
            },
        }));

        expect(snapshot).toMatchObject({ phase: 'blocked', action: 'retry' });
        expect(snapshot.rows[0]).toMatchObject({ id: 'home', status: 'blocked' });
    });

    it('resumes at app connection when runtime is healthy but profile/auth is missing', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            localHomeIdentity: null,
            localHomeAuth: 'missing',
        }));
        expect(snapshot.phase).toBe('connecting-app');
        expect(snapshot.rows).toEqual([
            { id: 'home', status: 'complete' },
            { id: 'app', status: 'active' },
            { id: 'computer', status: 'pending' },
        ]);
    });

    it('closes signup before releasing the shell', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ anonymousSignup: 'enabled' }));
        expect(snapshot.phase).toBe('closing-signup');
        expect(snapshot.shouldGateShell).toBe(true);
        expect(snapshot.homeReady).toBe(false);
    });

    it.each([
        {
            name: 'prepare-home',
            overrides: { relayRuntime: null },
            phase: 'preparing-home',
            activeRow: 'home',
            activeRowStatus: 'active',
        },
        {
            name: 'connect-app',
            overrides: { localHomeIdentity: null, localHomeAuth: 'missing' as const },
            phase: 'connecting-app',
            activeRow: 'app',
            activeRowStatus: 'active',
        },
        {
            name: 'close-signup',
            overrides: { anonymousSignup: 'enabled' as const },
            phase: 'closing-signup',
            activeRow: 'app',
            activeRowStatus: 'active',
        },
    ])('keeps daemon failure out of the $name Home phase', ({ overrides, phase, activeRow, activeRowStatus }) => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            ...overrides,
            daemon: {
                serviceInstalled: true,
                daemonRunning: false,
                needsAuth: false,
                machineId: null,
                error: 'background service unavailable',
            },
        }));

        expect(snapshot).toMatchObject({
            shouldGateShell: true,
            homeReady: false,
            phase,
            action: 'none',
            daemonState: 'blocked',
        });
        expect(snapshot.rows.find((row) => row.id === activeRow)).toMatchObject({ status: activeRowStatus });
        expect(snapshot.detail).toBeUndefined();
    });

    it('releases the shell while daemon setup remains pending', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ completedPersonalHomeProfile: profile }));
        expect(snapshot.phase).toBe('preparing-computer');
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.homeReady).toBe(true);
        expect(snapshot.daemonReady).toBe(false);
    });

    it('keeps the shell usable while reporting daemon failure as a blocked secondary row', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: profile,
            daemon: {
                serviceInstalled: true,
                daemonRunning: false,
                needsAuth: false,
                machineId: null,
                error: 'service failed',
            },
        }));
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.homeReady).toBe(true);
        expect(snapshot.phase).toBe('preparing-computer');
        expect(snapshot.daemonState).toBe('blocked');
        expect(snapshot.rows[2]).toMatchObject({ id: 'computer', status: 'blocked', detail: 'service failed' });
    });

    it('never reopens the gate for a completed Home that is temporarily offline', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: profile,
            relayRuntime: { installed: true, healthy: false, status: 'unhealthy' },
            localHomeReachability: 'unreachable',
            localHomeIdentity: null,
            localHomeAuth: 'unknown',
        }));
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.homeReady).toBe(true);
    });

    it('blocks on an unclassified local runtime without rewriting it', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: profile,
            completedPersonalHomeProfile: null,
            relayRuntime: { installed: true, healthy: true, status: 'healthy' },
        }));
        expect(snapshot.phase).toBe('blocked');
        expect(snapshot.action).toBe('choose-existing-runtime');
    });

    it('releases first-run setup when the user has explicitly selected another Home', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            explicitlySelectedOtherHome: true,
            relayRuntime: {
                installed: true,
                healthy: true,
                status: 'healthy',
                purpose: { kind: 'generic' },
            },
        }));

        expect(snapshot).toMatchObject({
            shouldGateShell: false,
            homeReady: false,
            phase: 'ready',
            action: 'none',
        });
    });

    it('routes retained managed data into recovery before the runtime is reinstalled', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: null,
            completedPersonalHomeProfile: null,
            relayRuntime: {
                installed: false,
                healthy: false,
                dataPresent: true,
                status: 'absent',
                purpose: null,
            },
        }));
        expect(snapshot.phase).toBe('blocked');
        expect(snapshot.action).toBe('choose-existing-runtime');
    });

    it('blocks on an installed generic runtime even when it has no provisional profile', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: null,
            completedPersonalHomeProfile: null,
            relayRuntime: {
                installed: true,
                healthy: true,
                status: 'healthy',
                purpose: { kind: 'generic' },
            } as unknown as PersonalHomeFacts['relayRuntime'],
        }));
        expect(snapshot.phase).toBe('blocked');
        expect(snapshot.action).toBe('choose-existing-runtime');
    });

    it('resumes a persisted Personal Home runtime instead of treating its provisional profile as a conflict', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: profile,
            completedPersonalHomeProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            relayRuntime: {
                installed: true,
                healthy: true,
                status: 'healthy',
                purpose: {
                    kind: 'personal-home',
                    canonicalServerUrl: 'http://127.0.0.1:53288',
                },
            } as unknown as PersonalHomeFacts['relayRuntime'],
        }));
        expect(snapshot.phase).toBe('connecting-app');
        expect(snapshot.action).toBe('none');
    });

    it('resumes a classified Personal Home with retained data after an interrupted bootstrap', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            relayRuntime: {
                installed: true,
                healthy: true,
                dataPresent: true,
                status: 'healthy',
                purpose: {
                    kind: 'personal-home',
                    canonicalServerUrl: 'http://127.0.0.1:53288',
                },
            },
        }));

        expect(snapshot.phase).toBe('connecting-app');
        expect(snapshot.action).toBe('none');
    });

    it('never gates a non-desktop host', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ hostIsDesktop: false, relayRuntime: null }));
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.phase).toBe('ready');
    });

    it('treats a verified runtime with an unadopted profile as a post-shell completion retry state', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ completedPersonalHomeProfile: null }));
        expect(snapshot.homeReady).toBe(true);
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.phase).toBe('connecting-app');
        expect(snapshot.action).toBe('retry');
        expect(snapshot.rows[0]).toMatchObject({ id: 'home', status: 'complete' });
        expect(snapshot.rows[1]).toMatchObject({ id: 'app', status: 'active' });
    });

    it('never gates the shell for profile completion even when the daemon is blocked', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            daemon: {
                serviceInstalled: true,
                daemonRunning: false,
                needsAuth: false,
                machineId: null,
                error: 'service failed',
            },
        }));
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.homeReady).toBe(true);
    });
});
