import { describe, expect, it } from 'vitest';

import {
    INITIAL_MANAGED_GITHUB_APPS_STATE,
    beginManagedGitHubAppsRefresh,
    settleManagedGitHubAppsRefresh,
} from './managedGitHubAppsState';

const registration = {
    id: 'registration-1', owner: { kind: 'home' as const }, githubHost: 'https://github.com',
    githubAppId: '12', githubClientId: 'Iv1.client', githubAppSlug: 'happier',
    githubOwnerId: '22', githubOwnerLogin: 'happier-dev', revision: 2, securityRevision: 1,
    state: 'verified' as const,
    secretHealth: { clientSecretConfigured: true, privateKeyConfigured: true, webhookSecretConfigured: true },
    lastVerifiedAt: '2026-09-01T10:00:00.000Z', createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
};

describe('managedGitHubAppsState', () => {
    it('retains the last known registrations and installations when refresh fails', () => {
        const ready = settleManagedGitHubAppsRefresh(INITIAL_MANAGED_GITHUB_APPS_STATE, {
            kind: 'succeeded',
            value: { registrations: [registration], installations: [] },
        });
        const refreshing = beginManagedGitHubAppsRefresh(ready);
        const failed = settleManagedGitHubAppsRefresh(refreshing, {
            kind: 'failed',
            failure: { code: 'home_unreachable', retryable: true },
        });

        expect(failed).toMatchObject({
            kind: 'ready', registrations: [registration], installations: [],
            refreshing: false, stale: true,
        });
    });

    it('never treats an impossible read approval as GitHub App data', () => {
        const state = settleManagedGitHubAppsRefresh(INITIAL_MANAGED_GITHUB_APPS_STATE, {
            kind: 'approval_pending',
            artifactId: 'approval-1',
            approval: {
                artifactId: 'approval-1',
                onExecuted: async () => 'ignored',
            },
        });

        expect(state).toEqual({
            kind: 'unavailable',
            failure: { code: 'invalid_action_output', retryable: false },
        });
    });
});
