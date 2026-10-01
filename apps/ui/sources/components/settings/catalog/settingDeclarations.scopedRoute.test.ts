import { describe, expect, it } from 'vitest';

import { buildSettingHref } from './settingDeclarations';

describe('scoped setting links', () => {
    it('uses explicit route context and omits a setting when its destination is unavailable', () => {
        const ref = { anchor: 'teams.oidc.issuer' };
        const route = (context: Readonly<{ pathname: string; params: Readonly<Record<string, string | string[] | undefined>> }>) => (
            context.pathname === '/settings/teams/home-b/team-one/authentication/connection-one/edit'
            && context.params.providerId === 'provider-one'
                ? `${context.pathname}?providerId=provider-one`
                : null
        );
        const context = {
            pathname: '/settings/teams/home-b/team-one/authentication/connection-one/edit',
            params: { providerId: 'provider-one' },
        };

        expect(buildSettingHref(route, ref, context)).toBe(`${context.pathname}?providerId=provider-one&setting=teams.oidc.issuer`);
        expect(buildSettingHref(route, ref, { ...context, pathname: '/settings' })).toBeNull();
        expect(buildSettingHref(route, ref)).toBeNull();
        expect(buildSettingHref('/settings/session?mode=resume', ref)).toBe('/settings/session?mode=resume&setting=teams.oidc.issuer');
    });
});
