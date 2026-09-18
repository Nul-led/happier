import { describe, expect, it } from 'vitest';

import { validateManagedGitHubAppDraft } from './ManagedGitHubAppEditorScreen';

describe('validateManagedGitHubAppDraft', () => {
    it('requires a secure host, decimal App id, client id, and private key for creation', () => {
        expect(validateManagedGitHubAppDraft({
            githubHost: 'http://github.example', githubAppId: 'abc', githubClientId: '',
            githubAppSlug: '', githubOwnerLogin: '', clientSecret: '', privateKey: '', webhookSecret: '',
        }, true)).toBe('required');
        expect(validateManagedGitHubAppDraft({
            githubHost: 'https://github.example', githubAppId: '123', githubClientId: 'Iv1.client',
            githubAppSlug: '', githubOwnerLogin: '', clientSecret: '', privateKey: 'private-key', webhookSecret: '',
        }, true)).toBeNull();
    });

    it('does not require replacement secrets when editing', () => {
        expect(validateManagedGitHubAppDraft({
            githubHost: 'https://github.example', githubAppId: '123', githubClientId: 'Iv1.client',
            githubAppSlug: 'app', githubOwnerLogin: 'org', clientSecret: '', privateKey: '', webhookSecret: '',
        }, false)).toBeNull();
    });
});
