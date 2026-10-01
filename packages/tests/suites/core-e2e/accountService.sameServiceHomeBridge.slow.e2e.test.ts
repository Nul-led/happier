import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Agent as UndiciAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { startHttpRequestRecordingProxy, type HttpRequestRecordingProxy } from '../../src/testkit/httpRequestRecordingProxy';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { createEphemeralTlsServerFixture, type EphemeralTlsServerFixture } from '../../src/testkit/tls/ephemeralTlsServerFixture.mjs';
import { startFakeGitHubOAuthServer, type StopFn } from '../../src/testkit/oauth/fakeGithubOAuthServer';
import { buildAccountStoredContentCompatibilityHttpHeadersV1, CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION } from '@happier-dev/protocol';
import { sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import tweetnacl from 'tweetnacl';

const run = createRunDirs({ runLabel: 'core' });
const homeIdentity = 'srv_sameServiceBridgeE2e';
const storedContentHeaders = buildAccountStoredContentCompatibilityHttpHeadersV1(
    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
);

async function startLoopbackMailServer() {
    const messages: string[] = [];
    const sockets = new Set<Socket>();
    const listener = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.setEncoding('utf8');
        socket.write('220 localhost ESMTP test\r\n');
        let pending = '';
        let data: string[] | null = null;
        socket.on('data', (chunk: string) => {
            pending += chunk;
            while (pending.includes('\r\n')) {
                const end = pending.indexOf('\r\n');
                const line = pending.slice(0, end);
                pending = pending.slice(end + 2);
                if (data !== null) {
                    if (line === '.') {
                        messages.push(data.join('\r\n'));
                        data = null;
                        socket.write('250 message accepted\r\n');
                    } else data.push(line.replace(/^\.\./, '.'));
                } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
                else if (/^MAIL FROM:|^RCPT TO:/i.test(line)) socket.write('250 accepted\r\n');
                else if (line === 'DATA') {
                    data = [];
                    socket.write('354 end with dot\r\n');
                } else if (line === 'QUIT') socket.end('221 bye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
    });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Loopback SMTP listener has no port');
    return {
        messages,
        port: address.port,
        async stop() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
        },
    };
}

describe('core e2e: existing Account signs in to its Account Service and reaches the same Home', () => {
    let server: StartedServer | null = null;
    let ingress: HttpRequestRecordingProxy | null = null;
    let tlsFixture: EphemeralTlsServerFixture | null = null;
    let tlsDispatcher: UndiciAgent | null = null;
    let previousDispatcher: Dispatcher | null = null;
    let previousStorageScope: string | undefined;
    let stopOAuth: StopFn | null = null;
    let mail: Awaited<ReturnType<typeof startLoopbackMailServer>> | null = null;
    let baseUrl = '';

    async function authenticateWithOAuth(purpose: 'account' | 'account_directory'): Promise<string> {
        const proof = randomBytes(32).toString('base64');
        const query = new URLSearchParams({ mode: 'keyless', proofHash: createHash('sha256').update(proof).digest('hex') });
        if (purpose === 'account_directory') {
            query.set('purpose', purpose);
            query.set('endpointUrl', baseUrl);
            query.set('endpointServerIdentityId', homeIdentity);
            query.set('canonicalServerUrl', baseUrl);
        }
        const params = await fetchJson<{ url?: string }>(`${baseUrl}/v1/auth/external/github/params?${query}`);
        expect(params.status).toBe(200);
        expect(params.data.url).toEqual(expect.any(String));
        const authorizeResponse = await fetch(params.data.url!, { redirect: 'manual' });
        expect(authorizeResponse.status).toBe(302);
        const callbackResponse = await fetch(authorizeResponse.headers.get('location')!, { redirect: 'manual' });
        expect(callbackResponse.status).toBe(302);
        const pending = new URL(callbackResponse.headers.get('location')!).searchParams.get('pending');
        expect(pending).toBeTruthy();
        const finalized = await fetchJson<{ success?: boolean; token?: string }>(
            `${baseUrl}/v1/auth/external/github/finalize-keyless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pending, proof }),
            },
        );
        expect(finalized.status).toBe(200);
        expect(finalized.data.success).toBe(true);
        expect(finalized.data.token).toEqual(expect.any(String));
        return finalized.data.token!;
    }

    async function createExistingSession(token: string, mode: 'e2ee' | 'plain', accountMachineKey?: Uint8Array): Promise<string> {
        const metadata = JSON.stringify({ v: 1 });
        const dataEncryptionKey = mode === 'e2ee' && accountMachineKey
            ? Buffer.from(sealEncryptedDataKeyEnvelopeV1({
                dataKey: tweetnacl.randomBytes(32),
                recipientPublicKey: tweetnacl.box.keyPair.fromSecretKey(accountMachineKey).publicKey,
                randomBytes: (length) => tweetnacl.randomBytes(length),
            })).toString('base64')
            : null;
        const created = await fetchJson<{ session?: { id?: string }; error?: string }>(`${baseUrl}/v1/sessions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...storedContentHeaders },
            body: JSON.stringify({
                tag: `same-service-bridge-${randomUUID()}`,
                metadataLayoutVersion: 1,
                sharedMetadata: { ciphertext: metadata },
                ownerMetadata: mode === 'plain'
                    ? { t: 'plain', v: { v: 1 } }
                    : { t: 'encrypted', c: 'oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==' },
                encryptionMode: mode,
                dataEncryptionKey,
                agentState: null,
            }),
        });
        expect(created.status, created.data.error).toBe(200);
        expect(created.data.session?.id).toEqual(expect.any(String));
        return created.data.session!.id!;
    }

    async function provisionPasswordAccount(email: string, credentialTarget?: 'account_directory') {
        const request = await fetchJson<{ accepted?: boolean }>(`${baseUrl}/v1/auth/email/verify/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ v: 1, email, purpose: 'account_service' }),
        });
        expect(request.status).toBe(200);
        await vi.waitFor(() => expect(mail!.messages.some((message) => message.includes(email))).toBe(true));
        const message = mail!.messages.findLast((value) => value.includes(email))!;
        const bearer = message.replace(/=\r\n/g, '').match(/\/auth\/email\/verify\/([A-Za-z0-9_-]+)/)?.[1];
        expect(bearer).toEqual(expect.any(String));
        const password = 'Bridge password with spaces 42';
        const provisioned = await fetchJson<{ token?: string; accountId?: string; error?: string }>(`${baseUrl}/v1/auth/email/provision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                v: 1, email,
                admission: { kind: 'native_email_verification', token: bearer },
                account: { mode: 'plain', password },
                ...(credentialTarget ? { credentialTarget } : {}),
            }),
        });
        expect(provisioned.status, provisioned.data.error).toBe(200);
        expect(provisioned.data.token).toEqual(expect.any(String));
        return { token: provisioned.data.token!, password };
    }

    async function loginWithPassword(email: string, password: string, credentialTarget?: 'account_directory') {
        const result = await fetchJson<{ token?: string; error?: string }>(`${baseUrl}/v1/auth/email/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ v: 1, email, password, ...(credentialTarget ? { credentialTarget } : {}) }),
        });
        expect(result.status, result.data.error).toBe(200);
        expect(result.data.token).toEqual(expect.any(String));
        return result.data.token!;
    }

    async function savePlainSettings(token: string) {
        const current = await fetchJson<{ version?: number }>(`${baseUrl}/v2/account/settings`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(current.status).toBe(200);
        const content = { t: 'plain' as const, v: { schemaVersion: 2, backendEnabledById: {},
            notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: false } } };
        const saved = await fetchJson<{ success?: boolean }>(`${baseUrl}/v2/account/settings`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...storedContentHeaders },
            body: JSON.stringify({ expectedVersion: current.data.version ?? 0, content }),
        });
        expect(saved.status).toBe(200);
        expect(saved.data.success).toBe(true);
        return content;
    }

    async function enterFromFreshClient(directoryToken: string, expectedSessionId: string) {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `same_service_home_bridge_password_${randomUUID()}`;
        vi.resetModules();
        const ui = {
            serverFeatures: await import('@/sync/api/capabilities/serverFeaturesClient'),
            directorySession: await import('@/sync/domains/accountDirectory/accountDirectorySession'),
            postAuth: await import('@/sync/ops/accountDirectory/completeAccountServicePostAuth'),
            tokenStorage: await import('@/auth/storage/tokenStorage'),
            profiles: await import('@/sync/domains/server/serverProfiles'),
        };
        const observed = await ui.serverFeatures.probeServerFeaturesAtUrl({ endpointUrl: baseUrl, force: true });
        expect(observed.status).toBe('ready');
        if (observed.status !== 'ready') throw new Error('Account Service features unavailable');
        const capability = ui.directorySession.parseAccountDirectoryCapability(observed.features.capabilities.accountDirectory);
        expect(capability?.homeDirectory).toBe(true);
        if (!capability) throw new Error('Account Service directory unavailable');
        const service = { endpointUrl: baseUrl, serverIdentityId: homeIdentity, canonicalServerUrl: baseUrl,
            capability, snapshot: observed };
        const target = { endpoint: baseUrl, serverIdentityId: homeIdentity };
        const otherProfileIdsBefore = ui.profiles.listServerProfiles()
            .filter((profile) => profile.serverIdentityId !== homeIdentity)
            .map((profile) => profile.id).sort();
        expect(await ui.tokenStorage.TokenStorage.accountDirectoryAuthCredentials.set(target, { token: directoryToken })).toBe(true);
        const directory = await fetchJson<{ homes?: Array<{ homeServerIdentityId: string }>; preferredHomeServerIdentityId?: string }>(
            `${baseUrl}/v1/account-directory/homes`, { headers: { Authorization: `Bearer ${directoryToken}` } },
        );
        expect(directory.status).toBe(200);
        expect(directory.data.homes).toEqual([expect.objectContaining({ homeServerIdentityId: homeIdentity })]);
        expect(directory.data.preferredHomeServerIdentityId).toBe(homeIdentity);
        const result = await ui.postAuth.completeAccountServicePostAuth({
            service,
            session: ui.directorySession.createAccountDirectorySession(target, { capability }),
            credentialTokenDigest: await ui.tokenStorage.digestAccountDirectoryCredentialToken(directoryToken),
            intent: { kind: 'enter', target: { kind: 'automatic' } },
        });
        expect(result).toEqual({ kind: 'home_entered', homeServerIdentityId: homeIdentity, selection: 'preferred' });
        expect(ui.profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === homeIdentity))
            .toHaveLength(1);
        expect(ui.profiles.listServerProfiles()
            .filter((profile) => profile.serverIdentityId !== homeIdentity)
            .map((profile) => profile.id).sort()).toEqual(otherProfileIdsBefore);
        const homeCredential = await ui.tokenStorage.TokenStorage.getCredentialsForServerUrl(baseUrl, { serverId: homeIdentity });
        expect(homeCredential?.token).toEqual(expect.any(String));
        const sessions = await fetchJson<{ sessions?: Array<{ id: string }> }>(`${baseUrl}/v2/sessions`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}`, ...storedContentHeaders },
        });
        expect(sessions.status).toBe(200);
        expect(sessions.data.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: expectedSessionId })]));
        const settings = await fetchJson<{ content?: { t: string } }>(`${baseUrl}/v2/account/settings`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}` },
        });
        expect(settings.status).toBe(200);
        expect(settings.data.content?.t).toBe('plain');
    }

    beforeAll(async () => {
        previousStorageScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `same_service_home_bridge_${randomUUID()}`;
        const testDir = run.testDir('same-service-home-bridge');
        const serverPort = await reserveAvailablePort();
        const internalUrl = `http://127.0.0.1:${serverPort}`;
        tlsFixture = await createEphemeralTlsServerFixture();
        const [key, cert, ca] = await Promise.all([
            readFile(tlsFixture.privateKeyPath),
            readFile(tlsFixture.leafCertificatePath),
            readFile(tlsFixture.caCertificatePath),
        ]);
        ingress = await startHttpRequestRecordingProxy({ targetBaseUrl: internalUrl, tls: { key, cert } });
        baseUrl = ingress.baseUrl;
        const oauth = await startFakeGitHubOAuthServer();
        stopOAuth = oauth.stop;
        mail = await startLoopbackMailServer();
        server = await startServerLight({
            testDir: `${testDir}/dual-role-home`,
            dbProvider: 'sqlite',
            __portAllocator: async () => serverPort,
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: homeIdentity,
                HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'self',
                HAPPIER_CANONICAL_SERVER_URL: baseUrl,
                HAPPIER_PUBLIC_SERVER_URL: baseUrl,
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
                AUTH_SIGNUP_PROVIDERS: 'github',
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
                HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'e2ee',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: '1',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: 'github',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: '1',
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: '1',
                HAPPIER_AUTH_EMAIL_SMTP_HOST: '127.0.0.1',
                HAPPIER_AUTH_EMAIL_SMTP_PORT: String(mail.port),
                HAPPIER_AUTH_EMAIL_FROM_ADDRESS: 'bridge@example.test',
                GITHUB_CLIENT_ID: 'same_service_bridge_client',
                GITHUB_CLIENT_SECRET: 'same_service_bridge_secret',
                GITHUB_REDIRECT_URL: `${baseUrl}/v1/oauth/github/callback`,
                HAPPIER_WEBAPP_URL: baseUrl,
                GITHUB_OAUTH_AUTHORIZE_URL: `${oauth.baseUrl}/login/oauth/authorize`,
                GITHUB_OAUTH_TOKEN_URL: `${oauth.baseUrl}/login/oauth/access_token`,
                GITHUB_API_USER_URL: `${oauth.baseUrl}/user`,
            },
        });
        previousDispatcher = getGlobalDispatcher();
        tlsDispatcher = new UndiciAgent({ connect: { ca } });
        setGlobalDispatcher(tlsDispatcher);
    }, 300_000);

    afterAll(async () => {
        if (previousDispatcher) setGlobalDispatcher(previousDispatcher);
        await tlsDispatcher?.close();
        await ingress?.stop();
        await server?.stop();
        await stopOAuth?.();
        await mail?.stop();
        await tlsFixture?.cleanup();
        if (previousStorageScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousStorageScope;
    });

    it('backfills the historical Home on key sign-in and enrolls it from a fresh client state', async () => {
        const oldHomeAuth = await createTestAuth(baseUrl);
        const oldSessionId = await createExistingSession(oldHomeAuth.token, 'e2ee', oldHomeAuth.accountMachineKey);
        const oldSettings = await fetchJson<Record<string, unknown>>(`${baseUrl}/v1/account/settings`, {
            headers: { Authorization: `Bearer ${oldHomeAuth.token}` },
        });
        expect(oldSettings.status).toBe(200);

        const ui = {
            keyAuth: await import('@/auth/accountDirectory/accountDirectoryKeyAuth'),
            serverFeatures: await import('@/sync/api/capabilities/serverFeaturesClient'),
            directorySession: await import('@/sync/domains/accountDirectory/accountDirectorySession'),
            postAuth: await import('@/sync/ops/accountDirectory/completeAccountServicePostAuth'),
            tokenStorage: await import('@/auth/storage/tokenStorage'),
            profiles: await import('@/sync/domains/server/serverProfiles'),
        };
        const observed = await ui.serverFeatures.probeServerFeaturesAtUrl({ endpointUrl: baseUrl, force: true });
        expect(observed.status).toBe('ready');
        if (observed.status !== 'ready') throw new Error('Account Service features unavailable');
        const capability = ui.directorySession.parseAccountDirectoryCapability(observed.features.capabilities.accountDirectory);
        expect(capability?.homeDirectory).toBe(true);
        if (!capability) throw new Error('Account Service directory unavailable');
        const service = { endpointUrl: baseUrl, serverIdentityId: homeIdentity, canonicalServerUrl: baseUrl,
            capability, snapshot: observed };
        const profilesBefore = new Set(ui.profiles.listServerProfiles().map((profile) => profile.id));

        const keyResult = await ui.keyAuth.authenticateSelectedAccountServiceWithKey({
            service, secret: oldHomeAuth.accountSigningSeed,
        });
        expect(keyResult.kind).toBe('authenticated');
        if (keyResult.kind !== 'authenticated') throw new Error(`Account Service key sign-in: ${keyResult.kind}`);
        const directory = await fetchJson<{ homes?: Array<{ homeServerIdentityId: string }>; preferredHomeServerIdentityId?: string }>(
            `${baseUrl}/v1/account-directory/homes`,
            { headers: { Authorization: `Bearer ${(await ui.tokenStorage.TokenStorage.accountDirectoryAuthCredentials.get({ endpoint: baseUrl, serverIdentityId: homeIdentity }))?.token}` } },
        );
        expect(directory.status).toBe(200);
        expect(directory.data.homes).toEqual([expect.objectContaining({ homeServerIdentityId: homeIdentity })]);
        expect(directory.data.preferredHomeServerIdentityId).toBe(homeIdentity);

        const result = await ui.postAuth.completeAccountServicePostAuth({
            service, session: keyResult.session,
            credentialTokenDigest: keyResult.credentialTokenDigest,
            intent: { kind: 'enter', target: { kind: 'automatic' } },
        });
        expect(result).toEqual({ kind: 'home_entered', homeServerIdentityId: homeIdentity, selection: 'preferred' });
        const addedProfiles = ui.profiles.listServerProfiles().filter((profile) => !profilesBefore.has(profile.id));
        expect(addedProfiles).toEqual([expect.objectContaining({ serverIdentityId: homeIdentity })]);
        const homeCredential = await ui.tokenStorage.TokenStorage.getCredentialsForServerUrl(baseUrl, { serverId: homeIdentity });
        expect(homeCredential?.token).toEqual(expect.any(String));

        const newSettings = await fetchJson<Record<string, unknown>>(`${baseUrl}/v1/account/settings`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}` },
        });
        expect(newSettings.status).toBe(200);
        expect(newSettings.data).toEqual(oldSettings.data);
        const sessions = await fetchJson<{ sessions?: Array<{ id: string }> }>(`${baseUrl}/v2/sessions`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}`, ...storedContentHeaders },
        });
        expect(sessions.status).toBe(200);
        expect(sessions.data.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: oldSessionId })]));
    }, 180_000);

    it('backfills the historical Home after OAuth sign-in while keeping a preexisting local Home', async () => {
        const oldHomeToken = await authenticateWithOAuth('account');
        const oldSessionId = await createExistingSession(oldHomeToken, 'plain');
        const settingsBefore = await fetchJson<{ version?: number }>(`${baseUrl}/v2/account/settings`, {
            headers: { Authorization: `Bearer ${oldHomeToken}` },
        });
        expect(settingsBefore.status).toBe(200);
        const savedSettings = { schemaVersion: 2, backendEnabledById: {},
            notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: false } };
        const writeSettings = await fetchJson<{ success?: boolean }>(`${baseUrl}/v2/account/settings`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${oldHomeToken}`, 'Content-Type': 'application/json', ...storedContentHeaders },
            body: JSON.stringify({ expectedVersion: settingsBefore.data.version ?? 0, content: { t: 'plain', v: savedSettings } }),
        });
        expect(writeSettings.status).toBe(200);
        expect(writeSettings.data.success).toBe(true);
        const oldSettings = await fetchJson<Record<string, unknown>>(`${baseUrl}/v2/account/settings`, {
            headers: { Authorization: `Bearer ${oldHomeToken}` },
        });
        expect(oldSettings.status).toBe(200);
        expect(oldSettings.data).toMatchObject({ content: { t: 'plain', v: savedSettings } });

        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `same_service_home_bridge_oauth_${randomUUID()}`;
        vi.resetModules();
        const ui = {
            serverFeatures: await import('@/sync/api/capabilities/serverFeaturesClient'),
            directorySession: await import('@/sync/domains/accountDirectory/accountDirectorySession'),
            postAuth: await import('@/sync/ops/accountDirectory/completeAccountServicePostAuth'),
            tokenStorage: await import('@/auth/storage/tokenStorage'),
            profiles: await import('@/sync/domains/server/serverProfiles'),
        };
        const localIdentity = 'srv_existingLocalPersonalHome';
        const localUrl = 'https://local-personal-home.example.test';
        const localProfile = await ui.profiles.adoptHomeProfile({
            descriptor: { v: 1, homeServerIdentityId: localIdentity, canonicalServerUrl: localUrl,
                revision: 1, endpoints: [{ kind: 'https', url: localUrl }] },
            source: 'manual',
        });
        await ui.tokenStorage.TokenStorage.setCredentialsForServerUrl(localUrl, { serverId: localIdentity }, { token: 'local-home-token' });
        await ui.profiles.setActiveServerId(localProfile.id);
        const focusBefore = ui.profiles.getActiveServerSnapshot().serverId;
        expect(focusBefore).toBe(localIdentity);

        const observed = await ui.serverFeatures.probeServerFeaturesAtUrl({ endpointUrl: baseUrl, force: true });
        expect(observed.status).toBe('ready');
        if (observed.status !== 'ready') throw new Error('Account Service features unavailable');
        const capability = ui.directorySession.parseAccountDirectoryCapability(observed.features.capabilities.accountDirectory);
        expect(capability?.homeDirectory).toBe(true);
        if (!capability) throw new Error('Account Service directory unavailable');
        const service = { endpointUrl: baseUrl, serverIdentityId: homeIdentity, canonicalServerUrl: baseUrl,
            capability, snapshot: observed };
        const directoryToken = await authenticateWithOAuth('account_directory');
        const target = { endpoint: baseUrl, serverIdentityId: homeIdentity };
        expect(await ui.tokenStorage.TokenStorage.accountDirectoryAuthCredentials.set(target, { token: directoryToken })).toBe(true);
        const directory = await fetchJson<{ homes?: Array<{ homeServerIdentityId: string }> }>(`${baseUrl}/v1/account-directory/homes`, {
            headers: { Authorization: `Bearer ${directoryToken}` },
        });
        expect(directory.status).toBe(200);
        expect(directory.data.homes).toEqual([expect.objectContaining({ homeServerIdentityId: homeIdentity })]);

        const result = await ui.postAuth.completeAccountServicePostAuth({
            service,
            session: ui.directorySession.createAccountDirectorySession(target, { capability }),
            credentialTokenDigest: await ui.tokenStorage.digestAccountDirectoryCredentialToken(directoryToken),
            intent: { kind: 'enter', target: { kind: 'automatic' } },
        });
        expect(result).toEqual({ kind: 'home_entered', homeServerIdentityId: homeIdentity, selection: 'preferred' });
        expect(ui.profiles.resolveServerProfileForPortableIdentity(localIdentity).kind).toBe('resolved');
        expect(ui.profiles.resolveServerProfileForPortableIdentity(homeIdentity).kind).toBe('resolved');
        expect(ui.profiles.getActiveServerSnapshot().serverId).toBe(homeIdentity);
        const homeCredential = await ui.tokenStorage.TokenStorage.getCredentialsForServerUrl(baseUrl, { serverId: homeIdentity });
        expect(homeCredential?.token).toEqual(expect.any(String));
        const newSettings = await fetchJson<Record<string, unknown>>(`${baseUrl}/v2/account/settings`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}` },
        });
        expect(newSettings.status).toBe(200);
        expect(newSettings.data).toEqual(oldSettings.data);
        const sessions = await fetchJson<{ sessions?: Array<{ id: string }> }>(`${baseUrl}/v2/sessions`, {
            headers: { Authorization: `Bearer ${homeCredential!.token}`, ...storedContentHeaders },
        });
        expect(sessions.status).toBe(200);
        expect(sessions.data.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: oldSessionId })]));
    }, 180_000);

    it('backfills the Home after existing native password sign-in and enters it on a fresh client', async () => {
        const email = `bridge-existing-${randomUUID()}@example.test`;
        const created = await provisionPasswordAccount(email);
        const oldSessionId = await createExistingSession(created.token, 'plain');
        await savePlainSettings(created.token);
        const directoryToken = await loginWithPassword(email, created.password, 'account_directory');
        await enterFromFreshClient(directoryToken, oldSessionId);
    }, 180_000);

    it('adds the Home during native account provision and enters it on a fresh client', async () => {
        const email = `bridge-new-${randomUUID()}@example.test`;
        const created = await provisionPasswordAccount(email, 'account_directory');
        const homeToken = await loginWithPassword(email, created.password);
        const sessionId = await createExistingSession(homeToken, 'plain');
        await savePlainSettings(homeToken);
        await enterFromFreshClient(created.token, sessionId);
    }, 180_000);
});
