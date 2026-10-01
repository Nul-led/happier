import { describe, expect, it } from 'vitest';

import { resolveTeamIdentityConnectionReturnUrl } from './teamIdentityConnectionUrls';

describe('Team identity connection return URL', () => {
    it('binds nonsecret Portal intent to the exact Home, Team and connection without changing ordinary return routes', () => {
        const input = {
            env: { HAPPIER_WEBAPP_URL: 'https://app.example.test/base?discard=true#discard' },
            homeServerIdentityId: 'home/exact', teamId: 'team/exact', connectionId: 'connection/exact',
        };
        const ordinary = new URL(resolveTeamIdentityConnectionReturnUrl(input)!);
        expect(ordinary.pathname).toBe('/base/settings/teams/home%2Fexact/team%2Fexact/authentication/connection%2Fexact');
        expect(ordinary.search).toBe('');
        expect(ordinary.hash).toBe('');
        const portal = new URL(resolveTeamIdentityConnectionReturnUrl({ ...input, purpose: 'workos_admin_portal' })!);
        expect(portal.pathname).toBe(ordinary.pathname);
        expect([...portal.searchParams]).toEqual([['purpose', 'workos_admin_portal']]);
    });
});
