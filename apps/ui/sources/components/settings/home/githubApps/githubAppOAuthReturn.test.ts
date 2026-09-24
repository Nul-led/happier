import { beforeEach, describe, expect, it } from 'vitest';

import {
    consumePendingGitHubAppVerification,
    recordPendingGitHubAppVerification,
    recordPendingGitHubAppManifestSetup,
    consumePendingGitHubAppManifestSetup,
} from './githubAppOAuthReturn';
import {
    clearPendingAdministrationOAuth,
    peekPendingAdministrationOAuth,
} from '@/sync/domains/pending/pendingAdministrationOAuth';

describe('GitHub App OAuth return custody', () => {
    beforeEach(() => clearPendingAdministrationOAuth());

    it('hands both handoffs to the durable administration custody the return document reads', () => {
        // GitHub is reached through a new `noopener` document on web; module state does not
        // reach the return route.
        recordPendingGitHubAppVerification({ registrationId: 'registration-1', returnTo: '/settings/home/1/app' });
        expect(peekPendingAdministrationOAuth()).toEqual({
            kind: 'github_app_verification',
            verification: { registrationId: 'registration-1', returnTo: '/settings/home/1/app' },
        });

        recordPendingGitHubAppManifestSetup({ kind: 'team', serverId: 'home-1', teamId: 'team-1' });
        expect(peekPendingAdministrationOAuth()).toEqual({
            kind: 'github_app_manifest_setup',
            setup: { kind: 'team', serverId: 'home-1', teamId: 'team-1' },
        });
    });

    it('returns a pending verification once for its exact registration', () => {
        recordPendingGitHubAppVerification({ registrationId: 'registration-1', returnTo: '/settings/home/1/app' });

        expect(consumePendingGitHubAppVerification('registration-2')).toBeNull();
        expect(consumePendingGitHubAppVerification('registration-1')).toEqual({
            registrationId: 'registration-1', returnTo: '/settings/home/1/app',
        });
        expect(consumePendingGitHubAppVerification('registration-1')).toBeNull();
    });

    it('returns manifest setup custody once', () => {
        recordPendingGitHubAppManifestSetup({ kind: 'home', serverId: 'home-1' });
        expect(consumePendingGitHubAppManifestSetup()).toEqual({ kind: 'home', serverId: 'home-1' });
        expect(consumePendingGitHubAppManifestSetup()).toBeNull();
    });

    it('retains a Team return destination without treating it as a Home registration route', () => {
        recordPendingGitHubAppManifestSetup({ kind: 'team', serverId: 'home-1', teamId: 'team-1' });
        expect(consumePendingGitHubAppManifestSetup()).toEqual({
            kind: 'team', serverId: 'home-1', teamId: 'team-1',
        });
    });
});
