import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
    ACCOUNT_DIRECTORY_ERROR_CODES_V1,
    createHomeCredentialDestinationDigestV1,
    HOME_LOGIN_HTTP_PATH_V1,
    HomeConnectionDescriptorV1Schema,
    HomeLoginRedemptionRequestV1Schema,
    type HomeConnectionDescriptorV1,
} from '@happier-dev/protocol';
import * as privacyKit from 'privacy-kit';
import {
    Agent as UndiciAgent,
    getGlobalDispatcher,
    setGlobalDispatcher,
    type Dispatcher,
} from 'undici';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import {
    startHttpRequestRecordingProxy,
    type HttpRequestRecordingProxy,
} from '../../src/testkit/httpRequestRecordingProxy';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startFakeGitHubOAuthServer, type StopFn } from '../../src/testkit/oauth/fakeGithubOAuthServer';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import {
    createEphemeralTlsServerFixture,
    type EphemeralTlsServerFixture,
} from '../../src/testkit/tls/ephemeralTlsServerFixture.mjs';

/**
 * Lane 09 / A10 composed adversarial evidence: first-contact Account Service enrollment must be
 * bound to the destination that will actually receive the Home credential.
 *
 * Attack under test (every hop is real production code and real wire traffic):
 *   malicious Account Directory entry keeps the genuine Home identity and canonical URL but
 *   selects an attacker-controlled HTTPS route
 *   → the attacker endpoint claims the real Home identity: it answers `/v1/features` with a
 *     self-consistent forged descriptor carrying the real opaque Home identity and its own
 *     endpoint, matching the poisoned Directory entry, and forwards the exact signed
 *     assertion/redemption bytes to the genuine Home
 *   → the real Home must detect the credential-destination mismatch before approval evaluation
 *   → no approval request, no minted Home token, no stored client credential, no stronger profile.
 *
 * The forged feature answer is required, not decorative: a transparent proxy of the genuine
 * feature response lets the production observation/reconciliation step stop the poisoned
 * descriptor before redemption, so the run would prove routing reconciliation rather than the
 * A10 security boundary.
 *
 * Test principals (ids only, never secrets):
 *   accountService `srv_accountDirectoryDestBindingSvcA1`
 *   home           `srv_accountDirectoryDestBindingHomeA1`
 *   client         `attackRequester` and `benignRequester` (both fresh, zero Home credentials) plus
 *                  `approver` (trusted Home device). Each is a separate production module graph
 *                  with its own storage scope, so the deliberately failing adversarial case cannot
 *                  leak a credential, profile, or pending continuation into the benign case.
 *   attacker       recording endpoint in front of the real Home that forges only `/v1/features`.
 *
 * Production composition exercised: AccountDirectorySession → provisionAuthenticatedHomeLink →
 * refreshAccountHomeDirectory → completeAccountServicePostAuth → enrollDirectoryHome → continueHomeLoginEnrollment →
 * resolveHomeEnrollmentTransport → redeemHomeLoginAssertion → homeDeviceApprovalClient →
 * resumePendingDirectoryHomeEnrollment → adoptHomeProfileWithCredentials. Assertion minting and
 * redemption are the real Account Service and real Home routes; nothing about the security owner
 * is stubbed, and no missing binding is simulated.
 *
 * Placed beside `accountDirectory.homeEnrollment.composedCaller.slow.e2e.test.ts` rather than
 * appended to it: that spec's single sequenced case ends with the Account Service stopped and the
 * directory row deleted, so no later case in that file can reach an enrollment boundary. It shares
 * the same fixtures, the same production caller chain, and the same lane.
 *
 * Mocked boundaries: only the shared vitest production hooks' device keychain
 * (`expo-secure-store`) and react-native/expo host modules. No token bytes are logged.
 */
const run = createRunDirs({ runLabel: 'core' });

type OAuthTokenResponse = Readonly<{
    success?: boolean;
    token?: string;
}>;

function bearer(token: string): Readonly<Record<string, string>> {
    return { Authorization: `Bearer ${token}` };
}

async function followOAuthRedirect(url: string): Promise<URL> {
    const authorizeResponse = await fetch(url, { redirect: 'manual' });
    expect(authorizeResponse.status).toBe(302);
    const callbackUrl = authorizeResponse.headers.get('location');
    expect(callbackUrl).toBeTruthy();

    const callbackResponse = await fetch(callbackUrl!, { redirect: 'manual' });
    expect(callbackResponse.status).toBe(302);
    const completionUrl = callbackResponse.headers.get('location');
    expect(completionUrl).toBeTruthy();
    return new URL(completionUrl!);
}

async function acquireGitHubOAuthToken(params: Readonly<{
    accountServiceBaseUrl: string;
    proof: string;
    accountDirectoryTarget?: Readonly<{
        endpointUrl: string;
        serverIdentityId: string;
        canonicalServerUrl: string;
    }>;
}>): Promise<string> {
    const proofHash = createHash('sha256').update(params.proof, 'utf8').digest('hex');
    const query = new URLSearchParams({ mode: 'keyless', proofHash });
    if (params.accountDirectoryTarget) {
        // The restricted Directory credential is bound to the Account Service's current
        // endpoint, identity, and canonical auth origin; the route rejects any other triple.
        query.set('purpose', 'account_directory');
        query.set('endpointUrl', params.accountDirectoryTarget.endpointUrl);
        query.set('endpointServerIdentityId', params.accountDirectoryTarget.serverIdentityId);
        query.set('canonicalServerUrl', params.accountDirectoryTarget.canonicalServerUrl);
    }

    const start = await fetchJson<{ url?: string }>(
        `${params.accountServiceBaseUrl}/v1/auth/external/github/params?${query.toString()}`,
    );
    expect(start.status).toBe(200);
    expect(start.data.url).toEqual(expect.any(String));

    const completionUrl = await followOAuthRedirect(start.data.url!);
    expect(completionUrl.searchParams.get('error')).toBeNull();
    const pending = completionUrl.searchParams.get('pending');
    expect(pending).toBeTruthy();

    const finalized = await fetchJson<OAuthTokenResponse>(
        `${params.accountServiceBaseUrl}/v1/auth/external/github/finalize-keyless`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pending, proof: params.proof }),
        },
    );
    expect(finalized.status).toBe(200);
    expect(finalized.data.success).toBe(true);
    expect(finalized.data.token).toEqual(expect.any(String));
    return finalized.data.token!;
}

/** One-time dynamic load of the production modules after the storage scope is pinned. */
async function loadProductionModule<T>(label: string, load: () => Promise<T>): Promise<T> {
    try {
        return await load();
    } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new Error(`destination_binding_e2e_module_failed:${label}: ${detail}`, { cause: error });
    }
}

async function loadProductionModules() {
    return {
        tokenStorage: await loadProductionModule('tokenStorage', () => import('@/auth/storage/tokenStorage')),
        approvalClient: await loadProductionModule('approvalClient', () => import('@/auth/approval/homeDeviceApprovalClient')),
        homeEnrollmentTransport: await loadProductionModule('homeEnrollmentTransport', () => import('@/auth/enrollment/homeEnrollmentTransport')),
        serverFeatures: await loadProductionModule('serverFeatures', () => import('@/sync/api/capabilities/serverFeaturesClient')),
        directorySession: await loadProductionModule('directorySession', () => import('@/sync/domains/accountDirectory/accountDirectorySession')),
        serverProfiles: await loadProductionModule('serverProfiles', () => import('@/sync/domains/server/serverProfiles')),
        adoptWithCredentials: await loadProductionModule('adoptWithCredentials', () => import('@/sync/domains/server/adoptHomeProfile')),
        refreshDirectory: await loadProductionModule('refreshDirectory', () => import('@/sync/ops/accountDirectory/refreshAccountHomeDirectory')),
        provisionHomeLink: await loadProductionModule('provisionHomeLink', () => import('@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink')),
        postAuth: await loadProductionModule('postAuth', () => import('@/sync/ops/accountDirectory/completeAccountServicePostAuth')),
        enrollment: await loadProductionModule('enrollment', () => import('@/sync/ops/accountDirectory/enrollDirectoryHome')),
    };
}

type ProductionModules = Awaited<ReturnType<typeof loadProductionModules>>;
type ProductionClient = Readonly<{
    storageScope: string;
    modules: ProductionModules;
}>;
type DirectoryCapability = NonNullable<
    ReturnType<ProductionModules['directorySession']['parseAccountDirectoryCapability']>
>;
type ApprovalTarget = Parameters<
    ProductionModules['approvalClient']['listHomeDeviceApprovals']
>[0];

async function createProductionClient(storageScope: string): Promise<ProductionClient> {
    process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = storageScope;
    vi.resetModules();
    try {
        return { storageScope, modules: await loadProductionModules() };
    } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new Error(`destination_binding_e2e_ui_module_load_failed: ${detail}`, { cause: error });
    }
}

function useProductionClient(client: ProductionClient): ProductionModules {
    process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = client.storageScope;
    return client.modules;
}

function homeDescriptor(input: Readonly<{ homeServerIdentityId: string; baseUrl: string }>) {
    return HomeConnectionDescriptorV1Schema.parse({
        v: 1,
        homeServerIdentityId: input.homeServerIdentityId,
        canonicalServerUrl: input.baseUrl,
        revision: 1,
        endpoints: [{ kind: 'https', url: input.baseUrl }],
    });
}

function redemptionEntries(attacker: HttpRequestRecordingProxy) {
    return attacker.entries()
        .filter((entry) => entry.method === 'POST' && entry.path === HOME_LOGIN_HTTP_PATH_V1);
}

/** Redemption requests the attacker endpoint observed, parsed by the canonical protocol owner. */
function assertionsHandedToAttacker(attacker: HttpRequestRecordingProxy) {
    return redemptionEntries(attacker)
        .map((entry) => HomeLoginRedemptionRequestV1Schema.parse(JSON.parse(entry.body?.text ?? '{}')));
}

/** Redemption answers the genuine Home returned through the attacker route. */
function homeAnswersThroughAttacker(attacker: HttpRequestRecordingProxy) {
    return redemptionEntries(attacker)
        .filter((entry) => entry.statusCode !== null && entry.responseBody?.complete === true)
        .map((entry) => entry.statusCode);
}

/** The exact refusal the genuine Home returned through the attacker route, status and wire code. */
function redemptionRefusalsThroughAttacker(attacker: HttpRequestRecordingProxy) {
    return redemptionEntries(attacker).map((entry) => {
        let error: unknown = null;
        try {
            error = (JSON.parse(entry.responseBody?.text ?? '{}') as { error?: unknown }).error ?? null;
        } catch {
            error = null;
        }
        return `${entry.statusCode}:${String(error)}`;
    });
}

/** Responses carrying a minted Home credential that traversed the attacker endpoint. */
function homeTokensMintedThroughAttacker(attacker: HttpRequestRecordingProxy) {
    return attacker.entries()
        .filter((entry) => (entry.responseBody?.text ?? '').includes('sealedHomeTokenBase64Url'))
        .map((entry) => ({ method: entry.method, path: entry.path, statusCode: entry.statusCode }));
}

describe('core e2e: Account Directory Home enrollment is bound to its credential destination', () => {
    let accountService: StartedServer | null = null;
    let home: StartedServer | null = null;
    let homeIngress: HttpRequestRecordingProxy | null = null;
    let attacker: HttpRequestRecordingProxy | null = null;
    let stopOAuth: StopFn | null = null;
    let tlsFixture: EphemeralTlsServerFixture | null = null;
    let exactCaDispatcher: UndiciAgent | null = null;
    let previousDispatcher: Dispatcher | null = null;

    let attackRequesterClient!: ProductionClient;
    let benignRequesterClient!: ProductionClient;
    let approverClient!: ProductionClient;
    let directoryCapability!: DirectoryCapability;
    let directoryService!: Parameters<ProductionModules['postAuth']['completeAccountServicePostAuth']>[0]['service'];
    let previousStorageScope: string | undefined;

    let accountServiceBaseUrl = '';
    let accountServiceIdentity = '';
    let homeBaseUrl = '';
    let homeIdentity = '';
    let attackerBaseUrl = '';
    let approverHomeToken = '';
    let directoryToken = '';
    let directoryTarget!: Readonly<{ endpoint: string; serverIdentityId: string }>;
    let approvalTarget!: ApprovalTarget;
    let publishedDescriptor!: HomeConnectionDescriptorV1;
    let poisonedDescriptor!: HomeConnectionDescriptorV1;
    /** Armed once the poisoned entry exists; the attacker then self-asserts that exact descriptor. */
    let forgedHomeDescriptor: HomeConnectionDescriptorV1 | null = null;

    /**
     * Device-local principal state, re-established for every case.
     *
     * The shared UI production hooks clear the mocked device keychain and persisted storage before
     * each test, so client credentials and Home profiles cannot be shared through `beforeAll`.
     * Server-side facts — the Account Service account, the Home link, the published directory
     * entry, and the approver's Home token — are created once and survive.
     */
    async function establishClientPrincipals(): Promise<ProductionModules> {
        const approverModules = useProductionClient(approverClient);
        expect(await approverModules.tokenStorage.TokenStorage.accountDirectoryAuthCredentials
            .set(directoryTarget, { token: directoryToken })).toBe(true);
        await approverModules.adoptWithCredentials.adoptHomeProfileWithCredentials({
            descriptor: homeDescriptor({ homeServerIdentityId: homeIdentity, baseUrl: homeBaseUrl }),
            source: 'manual',
            credentials: { token: approverHomeToken },
            suggestedName: 'Home Prime',
        });
        await approvalTarget?.transport.close().catch(() => {});
        const approvalTransportResolution = await approverModules.homeEnrollmentTransport
            .resolveHomeEnrollmentTransport(
                homeDescriptor({ homeServerIdentityId: homeIdentity, baseUrl: homeBaseUrl }),
            );
        expect(approvalTransportResolution.ok).toBe(true);
        if (!approvalTransportResolution.ok) throw new Error('unreachable');
        approvalTarget = {
            transport: approvalTransportResolution.transport,
            credentials: { token: approverHomeToken },
        };

        // Each requester principal holds only the restricted Account Service credential and has no
        // Home credential of its own.
        for (const requester of [attackRequesterClient, benignRequesterClient]) {
            const requesterModules = useProductionClient(requester);
            expect(await requesterModules.tokenStorage.TokenStorage.accountDirectoryAuthCredentials
                .set(directoryTarget, { token: directoryToken })).toBe(true);
            expect(await requesterModules.tokenStorage.TokenStorage
                .getCredentialsForServerUrl(homeBaseUrl, { serverId: homeIdentity })).toBeNull();
        }
        useProductionClient(approverClient);
        return approverModules;
    }

    beforeAll(async () => {
        previousStorageScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const clientScopeSuffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        attackRequesterClient = await createProductionClient(
            `account_directory_destination_binding_attack_requester_${clientScopeSuffix}`,
        );
        benignRequesterClient = await createProductionClient(
            `account_directory_destination_binding_benign_requester_${clientScopeSuffix}`,
        );
        approverClient = await createProductionClient(
            `account_directory_destination_binding_approver_${clientScopeSuffix}`,
        );
        const modules = useProductionClient(attackRequesterClient);

        const testDir = run.testDir('account-directory-home-enrollment-destination-binding');
        const oauth = await startFakeGitHubOAuthServer();
        stopOAuth = oauth.stop;

        const accountServicePort = await reserveAvailablePort();
        accountServiceBaseUrl = `http://127.0.0.1:${accountServicePort}`;
        accountService = await startServerLight({
            testDir: `${testDir}/account-service`,
            dbProvider: 'sqlite',
            __portAllocator: async () => accountServicePort,
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryDestBindingSvcA1',
                HAPPIER_PUBLIC_SERVER_URL: accountServiceBaseUrl,
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
                AUTH_SIGNUP_PROVIDERS: 'github',
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
                HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: '1',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: 'github',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: '1',
                GITHUB_CLIENT_ID: 'account_directory_destination_binding_client',
                GITHUB_CLIENT_SECRET: 'account_directory_destination_binding_secret',
                GITHUB_REDIRECT_URL: `${accountServiceBaseUrl}/v1/oauth/github/callback`,
                HAPPIER_WEBAPP_URL: accountServiceBaseUrl,
                GITHUB_OAUTH_AUTHORIZE_URL: `${oauth.baseUrl}/login/oauth/authorize`,
                GITHUB_OAUTH_TOKEN_URL: `${oauth.baseUrl}/login/oauth/access_token`,
                GITHUB_API_USER_URL: `${oauth.baseUrl}/user`,
            },
        });
        const homePort = await reserveAvailablePort();
        const homeInternalBaseUrl = `http://127.0.0.1:${homePort}`;
        tlsFixture = await createEphemeralTlsServerFixture();
        const [tlsKey, tlsCert, tlsCa] = await Promise.all([
            readFile(tlsFixture.privateKeyPath),
            readFile(tlsFixture.leafCertificatePath),
            readFile(tlsFixture.caCertificatePath),
        ]);
        const ingressTls = { key: tlsKey, cert: tlsCert };
        homeIngress = await startHttpRequestRecordingProxy({
            targetBaseUrl: homeInternalBaseUrl,
            tls: ingressTls,
        });
        homeBaseUrl = homeIngress.baseUrl;

        home = await startServerLight({
            testDir: `${testDir}/home`,
            dbProvider: 'sqlite',
            __portAllocator: async () => homePort,
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryDestBindingHomeA1',
                HAPPIER_PUBLIC_SERVER_URL: homeBaseUrl,
                // Home-owned approval policy: the v1 source of truth. A destination mismatch must
                // be refused before this policy is ever evaluated.
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '1',
            },
        });

        // Production UI requests use global fetch. Install this only after the testkit has
        // completed its loopback HTTP readiness probe: the scoped dispatcher exists solely for
        // this fixture's HTTPS ingress. Restore the previous owner in afterAll; certificate
        // validation remains enabled and no unrelated CA is trusted by this dispatcher.
        previousDispatcher = getGlobalDispatcher();
        exactCaDispatcher = new UndiciAgent({ connect: { ca: tlsCa } });
        setGlobalDispatcher(exactCaDispatcher);

        // Attacker route in front of the genuine Home. Only the unauthenticated feature probe is
        // forged, and only once the poisoned directory entry exists; the assertion/redemption
        // bytes are relayed untouched, so every decision the real Home makes is preserved.
        attacker = await startHttpRequestRecordingProxy({
            targetBaseUrl: home.baseUrl,
            tls: ingressTls,
            captureRequestBody: true,
            captureResponseBody: true,
            rewriteResponseBody: {
                when: (request) => forgedHomeDescriptor !== null
                    && request.method === 'GET'
                    && request.path.split('?')[0] === '/v1/features',
                rewrite: (_request, upstreamBody) => JSON.stringify({
                    ...JSON.parse(upstreamBody),
                    homeConnectionDescriptor: forgedHomeDescriptor,
                }),
            },
        });
        attackerBaseUrl = attacker.baseUrl;

        const directoryProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: accountServiceBaseUrl,
            force: true,
        });
        expect(directoryProbe.status).toBe('ready');
        if (directoryProbe.status !== 'ready') throw new Error('unreachable');
        accountServiceIdentity = directoryProbe.serverIdentityId!.trim();
        expect(accountServiceIdentity).toBe('srv_accountDirectoryDestBindingSvcA1');
        directoryCapability = modules.directorySession.parseAccountDirectoryCapability(
            directoryProbe.features.capabilities.accountDirectory,
        )!;
        expect(directoryCapability.homeEnrollment).toBe(true);
        directoryService = {
            endpointUrl: accountServiceBaseUrl,
            serverIdentityId: accountServiceIdentity,
            canonicalServerUrl: accountServiceBaseUrl,
            capability: directoryCapability,
            snapshot: directoryProbe,
        };

        const homeProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: homeBaseUrl,
            force: true,
        });
        expect(homeProbe.status).toBe('ready');
        homeIdentity = homeProbe.serverIdentityId!.trim();
        expect(homeIdentity).toBe('srv_accountDirectoryDestBindingHomeA1');

        // --- Trusted, already-enrolled Home device (the approver) ---
        const approver = await createTestAuth(homeBaseUrl);
        approverHomeToken = approver.token;

        // --- Account Service account and the restricted Directory credential ---
        await acquireGitHubOAuthToken({
            accountServiceBaseUrl,
            proof: privacyKit.encodeBase64(randomBytes(32)),
        });
        directoryToken = await acquireGitHubOAuthToken({
            accountServiceBaseUrl,
            proof: privacyKit.encodeBase64(randomBytes(32)),
            accountDirectoryTarget: {
                endpointUrl: accountServiceBaseUrl,
                serverIdentityId: accountServiceIdentity,
                canonicalServerUrl: accountServiceBaseUrl,
            },
        });
        directoryTarget = { endpoint: accountServiceBaseUrl, serverIdentityId: accountServiceIdentity };
        const approverModules = await establishClientPrincipals();

        // --- Honest first-contact linking through the production operation ---
        const provisioningSession = approverModules.directorySession.createAccountDirectorySession(
            directoryTarget,
            { capability: directoryCapability },
        );
        const provisioned = await approverModules.provisionHomeLink.provisionAuthenticatedHomeLink({
            session: provisioningSession,
            homeServerIdentityId: homeIdentity,
            issuerServerIdentityId: accountServiceIdentity,
            capability: directoryCapability,
        });
        expect(provisioned).toEqual({ kind: 'linked', homeServerIdentityId: homeIdentity });

        const publishedSnapshot = await approverModules.refreshDirectory
            .refreshAccountHomeDirectory(provisioningSession);
        expect(publishedSnapshot.status).toBe('ready');
        expect(publishedSnapshot.preferredHomeServerIdentityId).toBe(homeIdentity);
        publishedDescriptor = publishedSnapshot.homes[0]!.connectionDescriptor;
        expect(publishedDescriptor.canonicalServerUrl).toBe(homeBaseUrl);

        // The malicious descriptor: same Home identity, same canonical URL, attacker route. This is
        // exactly what a hostile Account Service or a poisoned directory row produces.
        poisonedDescriptor = HomeConnectionDescriptorV1Schema.parse({
            ...publishedDescriptor,
            revision: publishedDescriptor.revision + 1,
            endpoints: [{ kind: 'https', url: attackerBaseUrl }],
        });
        // Arm the impersonation before anything probes the attacker origin.
        forgedHomeDescriptor = poisonedDescriptor;

        // The attacker answers the production feature probe with the real Home's opaque identity
        // and a descriptor that is self-consistent with the poisoned directory entry.
        const attackerProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: attackerBaseUrl,
            serverId: homeIdentity,
            force: true,
        });
        expect(attackerProbe.status).toBe('ready');
        expect(attackerProbe.serverIdentityId!.trim()).toBe(homeIdentity);
        expect(attackerProbe.features.homeConnectionDescriptor).toEqual(poisonedDescriptor);
    }, 300_000);

    it('refuses a directory entry that retargets first-contact enrollment to an attacker route claiming the real Home identity', async () => {
        const approverModules = await establishClientPrincipals();
        const requesterModules = attackRequesterClient.modules;

        useProductionClient(approverClient);
        const poisonedEntry = await approverModules.directorySession
            .createAccountDirectorySession(directoryTarget, { capability: directoryCapability })
            .putHome({
                homeServerIdentityId: homeIdentity,
                label: 'Home Prime',
                connectionDescriptor: poisonedDescriptor,
            });
        expect(poisonedEntry.connectionDescriptor.endpoints).toEqual([
            { kind: 'https', url: attackerBaseUrl },
        ]);
        expect(poisonedEntry.canonicalServerUrl).toBe(homeBaseUrl);

        useProductionClient(attackRequesterClient);
        const session = requesterModules.directorySession.createAccountDirectorySession(
            directoryTarget,
            { capability: directoryCapability },
        );
        try {
            const refreshed = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(session);
            expect(refreshed.status).toBe('ready');
            expect(refreshed.homes[0]?.connectionDescriptor.endpoints).toEqual([
                { kind: 'https', url: attackerBaseUrl },
            ]);

            const attacked = await requesterModules.postAuth.completeAccountServicePostAuth({
                service: directoryService,
                session,
                intent: { kind: 'enroll', homeServerIdentityId: homeIdentity },
            });

            // Read the Home's approval state before any decision: a request approved later would
            // no longer be listed, so this is the only honest observation point.
            useProductionClient(approverClient);
            const approvalsAfterRedemption = await approverModules.approvalClient
                .listHomeDeviceApprovals(approvalTarget);
            expect(approvalsAfterRedemption.ok).toBe(true);
            if (!approvalsAfterRedemption.ok) throw new Error('unreachable');

            // Drive the attack to its end under whatever behavior is current: a victim looking at a
            // plausible pending request approves it, and the requester resumes through the same
            // attacker route. Under a destination-bound Home this branch is unreachable.
            let outcome: string = attacked.kind;
            if (attacked.kind === 'approval_required') {
                const pending = requesterModules.enrollment.getPendingDirectoryHomeEnrollment();
                expect(pending?.kind).toBe('approval_required');
                if (pending?.kind !== 'approval_required') throw new Error('unreachable');
                expect(pending.approvalId).toEqual(expect.any(String));
                await approverModules.approvalClient.decideHomeDeviceApproval(
                    approvalTarget,
                    pending.approvalId,
                    'approve',
                );
                useProductionClient(attackRequesterClient);
                const resumed = await requesterModules.enrollment.resumePendingDirectoryHomeEnrollment();
                outcome = resumed?.kind ?? outcome;
            }
            useProductionClient(attackRequesterClient);

            // Precondition: the attack really was mounted end to end. The production caller handed a
            // genuine signed Account Service assertion for the real Home to the attacker endpoint,
            // and the real Home answered it through that route. A failure here is a setup or
            // routing-reconciliation failure, not an A10 security result.
            const handed = assertionsHandedToAttacker(attacker!);
            const answered = homeAnswersThroughAttacker(attacker!);
            const attackEvidence = JSON.stringify({
                enrollmentOutcome: outcome,
                enrollmentDetail: 'reason' in attacked ? attacked.reason : null,
                redemptionsHandedToAttacker: handed.length,
                realHomeAnswersThroughAttacker: answered,
            });
            expect(handed.length, `attack was never mounted: ${attackEvidence}`).toBeGreaterThan(0);
            expect(handed[0]!.assertion.audienceHomeServerIdentityId).toBe(homeIdentity);
            expect(handed[0]!.assertion.issuerServerIdentityId).toBe(accountServiceIdentity);
            expect(answered.length, `the real Home never answered through the attacker: ${attackEvidence}`)
                .toBeGreaterThan(0);

            // A10: the real Home rejects the mismatched credential destination before approval
            // evaluation, so no approval request exists.
            expect(approvalsAfterRedemption.items).toEqual([]);

            // A10: the real Home made a credential-destination decision about this redemption.
            // `home_unavailable`/503 would mean it could not evaluate its own destination at all,
            // which fails closed but proves nothing about the binding under test.
            expect([...new Set(redemptionRefusalsThroughAttacker(attacker!))])
                .toEqual([`401:${ACCOUNT_DIRECTORY_ERROR_CODES_V1.invalidAudience}`]);

            // A10: no Home token is minted for the retargeted destination.
            expect(homeTokensMintedThroughAttacker(attacker!)).toEqual([]);

            // A10: no client credential is stored, at either the canonical or the attacker origin.
            expect(await requesterModules.tokenStorage.TokenStorage
                .getCredentialsForServerUrl(homeBaseUrl, { serverId: homeIdentity })).toBeNull();
            expect(await requesterModules.tokenStorage.TokenStorage
                .getCredentialsForServerUrl(attackerBaseUrl, { serverId: homeIdentity })).toBeNull();

            // The production caller reports a terminal failure rather than an enrolled Home or a
            // durable pending approval the user could still confirm.
            expect(outcome).not.toBe('home_enrolled');
            expect(outcome).not.toBe('approval_required');
            expect(requesterModules.enrollment.getPendingDirectoryHomeEnrollment()).toBeNull();

            // A10: the stable canonical auth origin never becomes the attacker route.
            //
            // Descriptor provenance is deliberately not asserted here: the shared UI test hooks
            // back every scoped MMKV instance with one process-wide map, so Home profiles are not
            // isolated between the three client graphs the way credentials are. Credential,
            // token, and approval state above are the isolated A10 observables.
            const homeProfiles = requesterModules.serverProfiles.listServerProfiles()
                .filter((profile) => profile.serverIdentityId === homeIdentity);
            expect(homeProfiles.map((profile) => profile.serverUrl)).not.toContain(attackerBaseUrl);
            expect(homeProfiles.map((profile) => profile.canonicalServerUrl ?? profile.serverUrl))
                .not.toContain(attackerBaseUrl);
        } finally {
            useProductionClient(attackRequesterClient);
            await requesterModules.enrollment.cancelPendingDirectoryHomeEnrollment().catch(() => {});
        }
    }, 300_000);

    it('enrolls across descriptor revision churn and keeps mutable Iroh hints outside the canonical destination digest', async () => {
        const approverModules = await establishClientPrincipals();
        const requesterModules = benignRequesterClient.modules;

        // Same identity, same canonical URL, same HTTPS credential origin; only the descriptor
        // revision advances. Deliberately outside any destination binding.
        useProductionClient(approverClient);
        const rehomedDescriptor = HomeConnectionDescriptorV1Schema.parse({
            ...publishedDescriptor,
            revision: publishedDescriptor.revision + 2,
        });
        // Mutable Iroh relay/direct hints are deliberately outside the signed credential
        // destination. This assertion discriminates that contract without requiring an active
        // native Iroh endpoint in this HTTPS enrollment journey.
        const syntheticIrohDescriptor = HomeConnectionDescriptorV1Schema.parse({
            ...publishedDescriptor,
            endpoints: [
                ...publishedDescriptor.endpoints,
                {
                    kind: 'iroh',
                    endpointId: 'a'.repeat(64),
                    relayUrls: ['https://relay-a.example.test'],
                    directAddresses: ['192.0.2.10:443'],
                },
            ],
        });
        const changedHints = HomeConnectionDescriptorV1Schema.parse({
            ...syntheticIrohDescriptor,
            revision: syntheticIrohDescriptor.revision + 1,
            endpoints: syntheticIrohDescriptor.endpoints.map((endpoint) => endpoint.kind === 'iroh'
                ? {
                    ...endpoint,
                    relayUrls: ['https://relay-b.example.test'],
                    directAddresses: ['192.0.2.11:443'],
                }
                : endpoint),
        });
        expect(createHomeCredentialDestinationDigestV1(changedHints))
            .toBe(createHomeCredentialDestinationDigestV1(syntheticIrohDescriptor));
        await approverModules.directorySession
            .createAccountDirectorySession(directoryTarget, { capability: directoryCapability })
            .putHome({
                homeServerIdentityId: homeIdentity,
                label: 'Home Prime',
                connectionDescriptor: rehomedDescriptor,
            });

        attacker!.clear();
        useProductionClient(benignRequesterClient);
        const session = requesterModules.directorySession.createAccountDirectorySession(
            directoryTarget,
            { capability: directoryCapability },
        );
        const refreshed = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(session);
        expect(refreshed.status).toBe('ready');
        expect(refreshed.homes[0]?.connectionDescriptor).toMatchObject({
            homeServerIdentityId: homeIdentity,
            canonicalServerUrl: publishedDescriptor.canonicalServerUrl,
            revision: publishedDescriptor.revision + 2,
            endpoints: publishedDescriptor.endpoints,
        });

        const enrollment = await requesterModules.postAuth.completeAccountServicePostAuth({
            service: directoryService,
            session,
            intent: { kind: 'enroll', homeServerIdentityId: homeIdentity },
        });
        expect({
            kind: enrollment.kind,
            detail: 'reason' in enrollment ? enrollment.reason : null,
        }).toEqual({ kind: 'approval_required', detail: null });
        if (enrollment.kind !== 'approval_required') throw new Error('unreachable');
        const pending = requesterModules.enrollment.getPendingDirectoryHomeEnrollment();
        expect(pending?.kind).toBe('approval_required');
        if (pending?.kind !== 'approval_required') throw new Error('unreachable');
        expect(pending.approvalId).toEqual(expect.any(String));

        useProductionClient(approverClient);
        const decision = await approverModules.approvalClient.decideHomeDeviceApproval(
            approvalTarget,
            pending.approvalId,
            'approve',
        );
        expect(decision).toMatchObject({ ok: true, status: 'approved' });

        useProductionClient(benignRequesterClient);
        const resumed = await requesterModules.enrollment.resumePendingDirectoryHomeEnrollment();
        // The Home credential commit succeeded; the default-E2EE Home then reports
        // the exact A12 material stage instead of claiming token-only is ready.
        expect(resumed).toEqual({
            kind: 'home_material_required',
            homeServerIdentityId: homeIdentity,
            reason: 'missing_material',
            intent: { kind: 'enroll', homeServerIdentityId: homeIdentity },
        });

        const stored = await requesterModules.tokenStorage.TokenStorage
            .getCredentialsForServerUrl(homeBaseUrl, { serverId: homeIdentity });
        expect(Object.keys(stored ?? {})).toEqual(['token']);
        expect(stored!.token).not.toBe(approverHomeToken);
        expect(stored!.token).not.toBe(directoryToken);
        const profile = await fetchJson<unknown>(`${homeBaseUrl}/v1/account/profile`, {
            headers: bearer(stored!.token!),
        });
        expect(profile.status).toBe(200);

        // The unchanged HTTPS credential origin was used: the attacker route saw nothing.
        expect(attacker!.entries()).toEqual([]);
    }, 300_000);

    afterAll(async () => {
        await approvalTarget?.transport.close().catch(() => {});
        await accountService?.stop().catch(() => {});
        await home?.stop().catch(() => {});
        await homeIngress?.stop().catch(() => {});
        await attacker?.stop().catch(() => {});
        await stopOAuth?.().catch(() => {});
        if (previousDispatcher) setGlobalDispatcher(previousDispatcher);
        await exactCaDispatcher?.close().catch(() => {});
        await tlsFixture?.cleanup().catch(() => {});
        if (previousStorageScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousStorageScope;
    });
});
