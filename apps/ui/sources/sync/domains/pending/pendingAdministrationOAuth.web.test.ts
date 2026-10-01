import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadOwner() {
    return await import('./pendingAdministrationOAuth.web');
}

describe('pendingAdministrationOAuth (web)', () => {
    beforeEach(async () => {
        vi.resetModules();
        (await loadOwner()).clearPendingAdministrationOAuth();
        vi.resetModules();
    });

    it('survives the new document the authorize URL opens', async () => {
        const start = await loadOwner();
        start.setPendingAdministrationOAuth({
            kind: 'identity_provider_test',
            test: {
                kind: 'home',
                serverId: 'home-a',
                accountId: 'account-1',
                providerId: 'provider-1',
                attemptId: 'attempt-1',
                returnTo: '/settings/home/home-a/sign-in-providers/identity/provider-1',
            },
        });

        // The return runs in the tab `window.open(url, '_blank', 'noopener')` created, which has
        // its own module registry. A fresh import is that document.
        vi.resetModules();
        const returned = await loadOwner();
        expect(returned.consumePendingAdministrationOAuth('identity_provider_test')?.test).toEqual({
            kind: 'home',
            serverId: 'home-a',
            accountId: 'account-1',
            providerId: 'provider-1',
            attemptId: 'attempt-1',
            returnTo: '/settings/home/home-a/sign-in-providers/identity/provider-1',
        });
        expect(returned.consumePendingAdministrationOAuth('identity_provider_test')).toBeNull();
    });

    it('leaves a handoff of another kind or key in place', async () => {
        const owner = await loadOwner();
        owner.setPendingAdministrationOAuth({
            kind: 'github_app_verification',
            verification: { registrationId: 'registration-1', returnTo: '/settings/home/home-a/app' },
        });

        expect(owner.consumePendingAdministrationOAuth('identity_provider_test')).toBeNull();
        expect(owner.consumePendingAdministrationOAuth(
            'github_app_verification',
            (pending) => pending.verification.registrationId === 'registration-2',
        )).toBeNull();
        expect(owner.consumePendingAdministrationOAuth(
            'github_app_verification',
            (pending) => pending.verification.registrationId === 'registration-1',
        )?.verification).toEqual({ registrationId: 'registration-1', returnTo: '/settings/home/home-a/app' });
    });

    it('rejects a corrupt or incomplete stored record instead of returning a partial handoff', async () => {
        const owner = await loadOwner();
        owner.setPendingAdministrationOAuth({
            kind: 'github_app_manifest_setup',
            setup: { kind: 'team', serverId: 'home-a', teamId: '' },
        });
        expect(owner.consumePendingAdministrationOAuth('github_app_manifest_setup')).toBeNull();
    });
});
