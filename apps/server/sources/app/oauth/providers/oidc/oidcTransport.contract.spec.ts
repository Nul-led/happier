import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { RequestListener } from 'node:http';
import { createServer } from 'node:https';
import type { TLSSocket } from 'node:tls';

import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import * as oidc from 'openid-client';
import { describe, expect, it, vi } from 'vitest';

import { createEphemeralTlsServerFixture } from '../../../../../../../packages/tests/src/testkit/tls/ephemeralTlsServerFixture.mjs';

// Transport feasibility proof, not the managed endpoint policy. Activation also
// needs the Home policy producer, full address classification and response bounds.
async function withIssuer(run: (input: {
    origin: string;
    ca: Buffer;
    observed: Array<{ path: string; servername: TLSSocket['servername'] }>;
    setHandler: (handler: RequestListener) => void;
}) => Promise<void>) {
    const tls = await createEphemeralTlsServerFixture({ additionalDnsNames: ['issuer.invalid'] });
    const observed: Array<{ path: string; servername: TLSSocket['servername'] }> = [];
    let handler: RequestListener = (_req, res) => res.end('{}');
    const server = createServer({
        key: await readFile(tls.privateKeyPath),
        cert: await readFile(tls.leafCertificatePath),
    }, (req, res) => {
        observed.push({ path: req.url ?? '', servername: (req.socket as TLSSocket).servername });
        handler(req, res);
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test listener');
        await run({
            origin: `https://issuer.invalid:${address.port}`,
            ca: await readFile(tls.caCertificatePath),
            observed,
            setHandler: (next) => { handler = next; },
        });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await tls.cleanup();
    }
}

function pinnedAgent(ca: Buffer, expectedPeer = '127.0.0.1') {
    const connect = buildConnector({ ca });
    return new Agent({
        connect(options, callback) {
            // Deliberately literal: no second DNS lookup can select a different peer.
            connect({ ...options, hostname: '127.0.0.1', servername: options.hostname }, (error, socket) => {
                if (error) {
                    callback(error, null);
                } else if (socket.remoteAddress !== expectedPeer) {
                    socket.destroy();
                    callback(new Error('test_peer_mismatch'), null);
                } else {
                    callback(null, socket);
                }
            });
        },
    });
}

async function fetchWithDispatcher(
    url: string,
    options: oidc.CustomFetchOptions,
    dispatcher: Agent,
): Promise<Response> {
    const response = await undiciFetch(url, { ...options, dispatcher });
    const body = [101, 204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
    });
}

describe('installed OIDC transport contract', () => {
    it('does not follow a discovery redirect through customFetch', async () => {
        await withIssuer(async ({ origin, ca, observed, setHandler }) => {
            setHandler((_req, res) => res.writeHead(302, { location: `${origin}/private` }).end());
            const dispatcher = pinnedAgent(ca);
            try {
                await expect(oidc.discovery(new URL(origin), 'client', 'secret', undefined, {
                    [oidc.customFetch]: (url, options) => fetchWithDispatcher(url, options, dispatcher),
                })).rejects.toThrow();
                expect(observed.map((entry) => entry.path)).toEqual(['/.well-known/openid-configuration']);
            } finally {
                await dispatcher.destroy();
            }
        });
    });

    it('preserves cancellation after headers and the discovery body timeout', async () => {
        await withIssuer(async ({ origin, ca, setHandler }) => {
            setHandler((_req, res) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.write('{');
            });
            const dispatcher = pinnedAgent(ca);
            try {
                const controller = new AbortController();
                const response = await undiciFetch(origin, { dispatcher, signal: controller.signal });
                const body = response.text();
                controller.abort();
                await expect(body).rejects.toMatchObject({ name: 'AbortError' });
                let discoverySignal: AbortSignal | undefined;
                await expect(oidc.discovery(new URL(origin), 'client', 'secret', undefined, {
                    timeout: 0.05,
                    [oidc.customFetch]: (url, options) => {
                        discoverySignal = options.signal;
                        return fetchWithDispatcher(url, options, dispatcher);
                    },
                })).rejects.toThrow();
                expect(discoverySignal?.aborted).toBe(true);
            } finally {
                await dispatcher.destroy();
            }
        });
    });

    it('pins the socket while preserving original TLS SNI and hostname validation', async () => {
        await withIssuer(async ({ origin, ca, observed }) => {
            const dispatcher = pinnedAgent(ca);
            try {
                expect(await (await undiciFetch(origin, { dispatcher })).text()).toBe('{}');
                expect(observed).toEqual([{ path: '/', servername: 'issuer.invalid' }]);
                await expect(undiciFetch(origin.replace('issuer.invalid', 'wrong.invalid'), { dispatcher }))
                    .rejects.toMatchObject({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
                expect(observed).toHaveLength(1);
            } finally {
                await dispatcher.destroy();
            }
        });
    });

    it('can reject the connected peer before releasing an HTTP request', async () => {
        await withIssuer(async ({ origin, ca, observed }) => {
            const dispatcher = pinnedAgent(ca, '127.0.0.2');
            try {
                await expect(undiciFetch(origin, { dispatcher }))
                    .rejects.toMatchObject({ cause: { message: 'test_peer_mismatch' } });
                expect(observed).toEqual([]);
            } finally {
                await dispatcher.destroy();
            }
        });
    });

    it('retains discovery customFetch for code, JWKS rotation, refresh and UserInfo', async () => {
        await withIssuer(async ({ origin, ca, observed, setHandler }) => {
            const dispatcher = pinnedAgent(ca);
            const traffic: string[] = [];
            const keys = [0, 1].map(() => generateKeyPairSync('rsa', { modulusLength: 2048 }));
            let currentKey = 0;
            const token = () => {
                const key = keys[currentKey]!;
                const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: String(currentKey) })).toString('base64url');
                const payload = Buffer.from(JSON.stringify({
                    iss: origin, sub: 'subject', aud: 'client', nonce: 'nonce',
                    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60,
                })).toString('base64url');
                const message = `${header}.${payload}`;
                return `${message}.${sign('RSA-SHA256', Buffer.from(message), key.privateKey).toString('base64url')}`;
            };
            setHandler((req, res) => {
                res.setHeader('content-type', 'application/json');
                switch (req.url) {
                    case '/.well-known/openid-configuration':
                        res.end(JSON.stringify({
                            issuer: origin, authorization_endpoint: `${origin}/authorize`,
                            token_endpoint: `${origin}/token`, jwks_uri: `${origin}/jwks`,
                            userinfo_endpoint: `${origin}/userinfo`, response_types_supported: ['code'],
                            code_challenge_methods_supported: ['S256'],
                            subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
                        }));
                        break;
                    case '/token':
                        res.end(JSON.stringify({ access_token: 'access', token_type: 'Bearer', refresh_token: 'refresh', id_token: token() }));
                        break;
                    case '/jwks':
                        res.end(JSON.stringify({ keys: [{ ...keys[currentKey]!.publicKey.export({ format: 'jwk' }), kid: String(currentKey), alg: 'RS256', use: 'sig' }] }));
                        break;
                    case '/userinfo':
                        res.end(JSON.stringify({ sub: 'subject' }));
                        break;
                    default:
                        res.writeHead(404).end();
                }
            });
            const customFetch: oidc.CustomFetch = async (url, options) => {
                traffic.push(new URL(url).pathname);
                return fetchWithDispatcher(url, options, dispatcher);
            };
            try {
                const config = await oidc.discovery(new URL(origin), 'client', 'secret', undefined, {
                    [oidc.customFetch]: customFetch,
                    execute: [oidc.enableNonRepudiationChecks],
                });
                const grant = () => oidc.authorizationCodeGrant(config,
                    new URL('https://app.invalid/callback?code=code&state=state'),
                    { expectedState: 'state', expectedNonce: 'nonce', pkceCodeVerifier: 'verifier' });
                expect((await grant()).claims()?.sub).toBe('subject');
                expect(oidc.getJwksCache(config)).toBeDefined();
                // Exercise rotation without sleeping through oauth4webapi's cache cooldown.
                const afterCooldown = Date.now() + 120_000;
                const clock = vi.spyOn(Date, 'now').mockReturnValue(afterCooldown);
                try {
                    currentKey = 1;
                    expect((await grant()).claims()?.sub).toBe('subject');
                    expect((await oidc.refreshTokenGrant(config, 'refresh')).access_token).toBe('access');
                    expect((await oidc.fetchUserInfo(config, 'access', 'subject')).sub).toBe('subject');
                } finally {
                    clock.mockRestore();
                }
                expect(traffic).toEqual([
                    '/.well-known/openid-configuration', '/token', '/jwks',
                    '/token', '/jwks', '/token', '/userinfo',
                ]);
                expect(observed.map((entry) => entry.path)).toEqual(traffic);
                expect(observed.every((entry) => entry.servername === 'issuer.invalid')).toBe(true);
            } finally {
                await dispatcher.destroy();
            }
        });
    });
});
