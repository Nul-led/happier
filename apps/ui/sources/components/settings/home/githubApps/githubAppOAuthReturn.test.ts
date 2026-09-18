import { describe, expect, it } from 'vitest';

import {
    consumePendingGitHubAppVerification,
    recordPendingGitHubAppVerification,
    recordPendingGitHubAppManifestSetup,
    consumePendingGitHubAppManifestSetup,
} from './githubAppOAuthReturn';

describe('GitHub App OAuth return custody', () => {
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
