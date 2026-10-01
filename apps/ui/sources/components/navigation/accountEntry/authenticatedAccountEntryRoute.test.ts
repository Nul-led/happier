import { describe, expect, it } from 'vitest';

import {
    buildAuthenticatedAccountEntryHref,
    parseAuthenticatedAccountEntryRoute,
} from './authenticatedAccountEntryRoute';

describe('authenticatedAccountEntryRoute', () => {
    it('round-trips Find as enter/automatic without a Home destination', () => {
        const href = buildAuthenticatedAccountEntryHref({
            service: {
                endpointUrl: 'https://accounts.example.test/',
                serverIdentityId: 'srv_accounts',
            },
            intent: { kind: 'enter', target: { kind: 'automatic' } },
            returnTo: '/',
        });

        expect(href).toEqual({
            pathname: '/homes/sign-in',
            params: {
                accountServiceEndpoint: 'https://accounts.example.test',
                accountServiceIdentity: 'srv_accounts',
                accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'automatic' } }),
                accountEntryReturnTo: '/',
            },
        });
        expect(parseAuthenticatedAccountEntryRoute(href.params)).toEqual({
            service: {
                endpointUrl: 'https://accounts.example.test',
                serverIdentityId: 'srv_accounts',
            },
            intent: { kind: 'enter', target: { kind: 'automatic' } },
            returnTo: '/',
        });
    });

    it('round-trips Link with the exact stable Home identity', () => {
        const href = buildAuthenticatedAccountEntryHref({
            service: {
                endpointUrl: 'https://accounts.example.test',
                serverIdentityId: 'srv_accounts',
            },
            intent: { kind: 'link', homeServerIdentityId: 'srv_home_l2' },
            returnTo: '/settings/account',
        });

        expect(parseAuthenticatedAccountEntryRoute(href.params)?.intent).toEqual({
            kind: 'link',
            homeServerIdentityId: 'srv_home_l2',
        });
    });

    it('round-trips account-only refresh without requiring a Home identity', () => {
        const href = buildAuthenticatedAccountEntryHref({
            service: {
                endpointUrl: 'https://accounts.example.test',
                serverIdentityId: 'srv_accounts',
            },
            intent: { kind: 'refresh' },
            returnTo: '/settings/account',
        });

        expect(parseAuthenticatedAccountEntryRoute(href.params)).toEqual({
            service: {
                endpointUrl: 'https://accounts.example.test',
                serverIdentityId: 'srv_accounts',
            },
            intent: { kind: 'refresh' },
            returnTo: '/settings/account',
        });
    });

    it('round-trips canonical explicit-enter and enroll recovery intents without narrowing their purpose', () => {
        const service = { endpointUrl: 'https://accounts.example.test', serverIdentityId: 'srv_accounts' };
        for (const intent of [
            { kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_home_l2' } },
            { kind: 'enroll', homeServerIdentityId: 'srv_home_l2' },
        ] as const) {
            const href = buildAuthenticatedAccountEntryHref({ service, intent, returnTo: '/settings/account' });
            expect(parseAuthenticatedAccountEntryRoute(href.params)?.intent).toEqual(intent);
        }
    });

    it('rejects malformed, secret-bearing, ambiguous, or unsupported route inputs', () => {
        const valid = {
            accountServiceEndpoint: 'https://accounts.example.test',
            accountServiceIdentity: 'srv_accounts',
            accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'automatic' } }),
            accountEntryReturnTo: '/',
        } as const;

        expect(parseAuthenticatedAccountEntryRoute({ ...valid, token: 'secret' })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountServiceEndpoint: 'https://user:pass@accounts.example.test' })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountServiceIdentity: '   ' })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountIntent: JSON.stringify({ kind: 'link' }) })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountIntent: JSON.stringify({ kind: 'enroll' }) })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountIntent: JSON.stringify({ kind: 'refresh', target: {} }) })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'explicit' } }) })).toBeNull();
        // The sign-in route has no mode; the legacy `/setup/wizard` redirect strips `mode=account-entry`.
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, mode: 'account-entry' })).toBeNull();
        expect(parseAuthenticatedAccountEntryRoute({ ...valid, mode: 'machine' })).toBeNull();
    });
});
