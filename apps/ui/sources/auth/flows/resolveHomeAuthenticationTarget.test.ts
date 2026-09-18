import { describe, expect, it } from 'vitest';

import { resolveHomeAuthenticationTarget } from './resolveHomeAuthenticationTarget';

describe('resolveHomeAuthenticationTarget', () => {
    it('preserves descriptor identity and separates request endpoint from canonical audience', () => {
        expect(resolveHomeAuthenticationTarget({
            kind: 'descriptor',
            authority: 'account_directory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'home-b',
                canonicalServerUrl: 'https://home-b.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://edge-b.example.test' }],
            },
        })).toEqual({
            endpointUrl: 'https://edge-b.example.test',
            canonicalServerUrl: 'https://home-b.example.test',
            // A scanned or pasted descriptor vouches for its own canonical URL, so
            // first contact may be judged against it rather than the edge endpoint.
            addressAnchorUrl: 'https://home-b.example.test',
            serverId: 'home-b',
            serverIdentityId: 'home-b',
        });
    });

    it('rejects URL-only targets that lack stable Home identity', () => {
        expect(resolveHomeAuthenticationTarget({ kind: 'https_url', url: 'https://unknown.example.test' })).toBeNull();
    });
});
