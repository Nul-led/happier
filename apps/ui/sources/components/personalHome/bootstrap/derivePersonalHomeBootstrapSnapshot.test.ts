import { describe, expect, it } from 'vitest';

import { derivePersonalHomeBootstrapSnapshot } from './derivePersonalHomeBootstrapSnapshot';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

const profile = {
    id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:53288',
    serverIdentityId: 'home-1', createdAt: 1, updatedAt: 1, lastUsedAt: 1,
} as const;

function facts(overrides: Partial<PersonalHomeFacts> = {}): PersonalHomeFacts {
    return {
        hostIsDesktop: true,
        isDesktopMainWindow: true,
        explicitlySelectedOtherHome: false,
        completedPersonalHomeProfile: null,
        candidateLocalProfile: profile,
        relayRuntime: {
            relayUrl: 'http://127.0.0.1:53288',
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
    it('requires explicit Retry for an erased Home even when app persistence retains its completion', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: { ...profile, personalHomeBootstrapCompleted: true },
            relayRuntime: { relayUrl: profile.serverUrl, installed: true, healthy: false, dataPresent: false,
                status: 'stopped', purpose: { kind: 'personal-home', canonicalServerUrl: profile.serverUrl } },
            localHomeIdentity: null, localHomeAuth: 'missing', localHomeReachability: 'unreachable',
            anonymousSignup: 'unknown',
        }));
        expect(snapshot).toMatchObject({ homeReady: false, phase: 'blocked', action: 'retry',
            detail: { code: 'personal_home_erased' } });
    });
    it('gates while the managed Home runtime is missing', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ relayRuntime: null }));
        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.shouldGateShell).toBe(true);
    });

    it('shows idle unhealthy runtime state as actionable recovery instead of active progress', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
                installed: true,
                healthy: false,
                status: 'needs-repair',
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
            },
        }));

        expect(snapshot).toMatchObject({ phase: 'blocked', action: 'retry' });
    });

    it('resumes at app connection when runtime is healthy but profile/auth is missing', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            localHomeIdentity: null,
            localHomeAuth: 'missing',
        }));
        expect(snapshot.phase).toBe('ensuring-home');
    });

    it('closes signup before releasing the shell', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ anonymousSignup: 'enabled' }));
        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.shouldGateShell).toBe(true);
        expect(snapshot.homeReady).toBe(false);
    });

    it.each([
        {
            name: 'runtime preparation',
            overrides: { relayRuntime: null },
            phase: 'ensuring-home',
        },
        {
            name: 'app connection',
            overrides: { localHomeIdentity: null, localHomeAuth: 'missing' as const },
            phase: 'ensuring-home',
        },
        {
            name: 'signup closure',
            overrides: { anonymousSignup: 'enabled' as const },
            phase: 'ensuring-home',
        },
    ])('keeps daemon failure out of the $name Home phase', ({ overrides, phase }) => {
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
    });

    it('never reopens the gate for a completed Home that is temporarily offline', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: profile,
            relayRuntime: { relayUrl: 'http://127.0.0.1:53288', installed: true, healthy: false, status: 'unhealthy' },
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
            relayRuntime: { relayUrl: 'http://127.0.0.1:53288', installed: true, healthy: true, status: 'healthy' },
        }));
        expect(snapshot.phase).toBe('blocked');
        expect(snapshot.action).toBe('choose-existing-runtime');
    });

    // R10 D4: a 0.2 Cloud user (implicit, credentialed selection) is asked once before a Personal
    // Home is created, instead of having one created and focused on first launch.
    it('asks before creating a Personal Home for a user already signed in to another Home', () => {
        const signedIn = facts({
            relayRuntime: null,
            candidateLocalProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            anonymousSignup: 'unknown',
            signedInOtherHome: { serverId: 'cloud', label: 'Happier Cloud' },
        });
        expect(derivePersonalHomeBootstrapSnapshot(signedIn)).toMatchObject({
            shouldGateShell: true,
            phase: 'blocked',
            action: 'choose-signed-in-home',
            signedInHomeLabel: 'Happier Cloud',
        });
        // Once a Personal Home runtime exists, the choice was already made: setup resumes.
        expect(derivePersonalHomeBootstrapSnapshot(facts({
            signedInOtherHome: { serverId: 'cloud', label: 'Happier Cloud' },
        })).action).not.toBe('choose-signed-in-home');
    });

    it('releases first-run setup when the user has explicitly selected another Home', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            explicitlySelectedOtherHome: true,
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
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

    it('preserves completed Personal Home readiness while another Home remains explicitly focused', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            explicitlySelectedOtherHome: true,
            completedPersonalHomeProfile: profile,
        }));

        expect(snapshot).toMatchObject({
            shouldGateShell: false,
            homeReady: true,
            phase: 'ready',
            action: 'none',
        });
    });

    it('routes retained managed data into recovery before the runtime is reinstalled', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: null,
            completedPersonalHomeProfile: null,
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
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

    it('keeps an explicitly erased Personal Home blocked until the user deliberately retries', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: null,
            completedPersonalHomeProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            anonymousSignup: 'unknown',
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
                installed: true,
                dataPresent: false,
                healthy: false,
                status: 'stopped',
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
                anonymousSignupEnabled: null,
            },
        }));

        expect(snapshot).toMatchObject({
            shouldGateShell: true,
            homeReady: false,
            phase: 'blocked',
            action: 'retry',
            detail: { code: 'personal_home_erased', retryable: true },
        });
    });

    it('blocks on an installed generic runtime even when it has no provisional profile', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            candidateLocalProfile: null,
            completedPersonalHomeProfile: null,
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
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
                relayUrl: 'http://127.0.0.1:53288',
                installed: true,
                healthy: true,
                status: 'healthy',
                purpose: {
                    kind: 'personal-home',
                    canonicalServerUrl: 'http://127.0.0.1:53288',
                },
            } as unknown as PersonalHomeFacts['relayRuntime'],
        }));
        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.action).toBe('none');
    });

    it('resumes a classified Personal Home with retained data after an interrupted bootstrap', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:53288',
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

        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.action).toBe('none');
    });

    it('never gates a non-desktop host', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({ hostIsDesktop: false, relayRuntime: null }));
        expect(snapshot.shouldGateShell).toBe(false);
        expect(snapshot.phase).toBe('ready');
    });

    it('keeps a verified runtime gated until the canonical profile has been adopted', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            candidateLocalProfile: null,
        }));
        expect(snapshot.homeReady).toBe(false);
        expect(snapshot.shouldGateShell).toBe(true);
        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.action).toBe('none');
    });

    it('releases the shell once a canonical candidate is adopted while durable source classification retries', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            candidateLocalProfile: profile,
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
        expect(snapshot.phase).toBe('ensuring-home');
        expect(snapshot.action).toBe('retry');
    });

    it('keeps a URL-matching candidate gated when its identity differs from the observed Home', () => {
        const snapshot = derivePersonalHomeBootstrapSnapshot(facts({
            completedPersonalHomeProfile: null,
            candidateLocalProfile: { ...profile, serverIdentityId: 'different-home' },
        }));

        expect(snapshot).toMatchObject({
            shouldGateShell: true,
            homeReady: false,
            phase: 'ensuring-home',
            action: 'none',
        });
    });
});
