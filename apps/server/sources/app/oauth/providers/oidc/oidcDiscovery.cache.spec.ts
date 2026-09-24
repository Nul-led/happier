import { once } from 'node:events';
import { createServer } from 'node:http';
import { refreshTokenGrant } from 'openid-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OidcAuthProviderInstanceConfig } from '@/app/auth/providers/oidc/oidcProviderConfig';
import { discoverOidcConfiguration } from './oidcDiscovery';

describe('OIDC discovery runtime identity', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('uses the rotated secret immediately for a fresh runtime with the same issuer and client', async () => {
        const secrets: Array<string | null> = [];
        let origin = '';
        const server = createServer(async (req, res) => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/.well-known/openid-configuration') {
                res.end(JSON.stringify({
                    issuer: origin,
                    authorization_endpoint: `${origin}/authorize`,
                    token_endpoint: `${origin}/token`,
                    jwks_uri: `${origin}/jwks`,
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: ['RS256'],
                }));
            } else if (req.url === '/token') {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                secrets.push(new URLSearchParams(Buffer.concat(chunks).toString()).get('client_secret'));
                res.end(JSON.stringify({ access_token: 'access', token_type: 'Bearer' }));
            } else {
                res.writeHead(404).end();
            }
        });
        try {
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing test listener');
            origin = `http://127.0.0.1:${address.port}`;
            const instance: OidcAuthProviderInstanceConfig = {
                id: 'rotation-test', type: 'oidc', displayName: 'Rotation test',
                issuer: origin, clientId: 'client', clientSecret: 'before',
                clientAuthenticationMethod: 'client_secret_post',
                redirectUrl: 'https://app.invalid/callback', scopes: 'openid', httpTimeoutSeconds: 5,
                claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null },
            };
            const before = await discoverOidcConfiguration(instance, 'before-fingerprint');
            await refreshTokenGrant(before, 'refresh');
            const after = await discoverOidcConfiguration({ ...instance, clientSecret: 'after' }, 'after-fingerprint');
            await refreshTokenGrant(after, 'refresh');
            expect(secrets).toEqual(['before', 'after']);
            expect(await discoverOidcConfiguration({ ...instance, clientSecret: 'after' }, 'after-fingerprint')).toBe(after);
            const otherProvider = await discoverOidcConfiguration({ ...instance, id: 'other-provider' }, 'before-fingerprint');
            expect(otherProvider).not.toBe(before);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('keeps two simultaneously valid runtimes of one provider instance alive', async () => {
        const secrets: Array<string | null> = [];
        let origin = '';
        const server = createServer(async (req, res) => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/.well-known/openid-configuration') {
                res.end(JSON.stringify({
                    issuer: origin,
                    authorization_endpoint: `${origin}/authorize`,
                    token_endpoint: `${origin}/token`,
                    jwks_uri: `${origin}/jwks`,
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: ['RS256'],
                }));
            } else if (req.url === '/token') {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                secrets.push(new URLSearchParams(Buffer.concat(chunks).toString()).get('client_secret'));
                res.end(JSON.stringify({ access_token: 'access', token_type: 'Bearer' }));
            } else {
                res.writeHead(404).end();
            }
        });
        try {
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing test listener');
            origin = `http://127.0.0.1:${address.port}`;
            const instance: OidcAuthProviderInstanceConfig = {
                id: 'shared-instance', type: 'oidc', displayName: 'Shared instance',
                issuer: origin, clientId: 'client', clientSecret: 'secret',
                clientAuthenticationMethod: 'client_secret_post',
                redirectUrl: 'https://app.invalid/callback', scopes: 'openid', httpTimeoutSeconds: 5,
                claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null },
            };
            // One provider instance reached as a Home method and through a Team connection:
            // the fingerprints differ only in the connection segment, and both are valid now.
            const homeFingerprint = 'managed-oidc:v1:3:home:network';
            const teamFingerprint = 'managed-oidc:v1:3:team:connection-1:4:network';

            const home = await discoverOidcConfiguration(instance, homeFingerprint);
            const team = await discoverOidcConfiguration(instance, teamFingerprint);
            expect(team).not.toBe(home);

            expect(await discoverOidcConfiguration(instance, homeFingerprint)).toBe(home);
            expect(await discoverOidcConfiguration(instance, teamFingerprint)).toBe(team);

            // Neither runtime's transport was destroyed under the other.
            await refreshTokenGrant(home, 'refresh');
            await refreshTokenGrant(team, 'refresh');
            expect(secrets).toEqual(['secret', 'secret']);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('reclaims an expired runtime of the same instance instead of retaining its transport', async () => {
        let origin = '';
        const server = createServer(async (req, res) => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/.well-known/openid-configuration') {
                res.end(JSON.stringify({
                    issuer: origin,
                    authorization_endpoint: `${origin}/authorize`,
                    token_endpoint: `${origin}/token`,
                    jwks_uri: `${origin}/jwks`,
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: ['RS256'],
                }));
            } else if (req.url === '/token') {
                res.end(JSON.stringify({ access_token: 'access', token_type: 'Bearer' }));
            } else {
                res.writeHead(404).end();
            }
        });
        try {
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing test listener');
            origin = `http://127.0.0.1:${address.port}`;
            const instance: OidcAuthProviderInstanceConfig = {
                id: 'revision-bump', type: 'oidc', displayName: 'Revision bump',
                issuer: origin, clientId: 'client', clientSecret: 'secret',
                clientAuthenticationMethod: 'client_secret_post',
                redirectUrl: 'https://app.invalid/callback', scopes: 'openid', httpTimeoutSeconds: 5,
                claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null },
            };
            // A connection revision bump keeps the same credentials and produces a new
            // fingerprint, so the superseded runtime is never looked up again.
            const superseded = await discoverOidcConfiguration(instance, 'managed-oidc:v1:3:team:connection-1:4:network');
            await refreshTokenGrant(superseded, 'refresh');

            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(Date.now() + 11 * 60 * 1000);
            await discoverOidcConfiguration(instance, 'managed-oidc:v1:3:team:connection-1:5:network');

            await expect(refreshTokenGrant(superseded, 'refresh')).rejects.toThrow();
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
