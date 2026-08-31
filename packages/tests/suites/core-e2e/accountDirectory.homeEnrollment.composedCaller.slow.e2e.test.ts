import { createHash, randomBytes } from 'node:crypto';

import {
    AccountDirectoryMeResponseV1Schema,
    HomeConnectionDescriptorV1Schema,
} from '@happier-dev/protocol';
import * as privacyKit from 'privacy-kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startFakeGitHubOAuthServer, type StopFn } from '../../src/testkit/oauth/fakeGithubOAuthServer';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';

/**
 * Lane 02 composed caller proof: the real production Account Directory enrollment
 * caller chain runs against a real Account Service and a real approval-gated Home.
 *
 * Production composition under test (no internal logic is mocked):
 *   AccountDirectorySession (real HTTP client + real credential namespace)
 *   → provisionAuthenticatedHomeLink (authenticated Home link PUT through
 *     resolveDirectoryHomeTransport/HomeEnrollmentTransport, then Account
 *     Service directory Home PUT; the first published Home becomes preferred
 *     server-side as a consequence of that PUT)
 *   → refreshAccountHomeDirectory → enrollPreferredDirectoryHome
 *   → continueHomeLoginEnrollment → resolveDirectoryHomeTransport
 *   → frozen one-shot redeemHomeLoginAssertion → approval_required
 *   → homeDeviceApprovalClient list/decision through the real Home routes
 *   → resumePendingPreferredHomeEnrollment → strict authorized response
 *   → sealed-token open → adoptHomeProfileWithCredentials (explicit target
 *     credential write + Lane 04 non-focusing adoption)
 *
 * Requester and approver load separate production module graphs and use distinct
 * storage scopes, matching two client processes without reproducing any client
 * behavior in this test. Mocked boundaries (all genuine device/host persistence seams owned by the
 * shared vitest production hooks setup, never logic under test):
 *   - `expo-secure-store` (device keychain) via the shared ui dev vitestSetup
 *     in-memory backing. Credential assertions compare shape/values in memory
 *     and never log token bytes.
 *   - react-native/expo host modules stubbed by that same canonical setup.
 * Everything else is real: Account Service, Home A, Home B processes, the fake
 * GitHub OAuth boundary, and all assertion/redemption/approval wire traffic.
 * No DTO or protocol logic is reproduced in this file.
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
    }>;
}>): Promise<string> {
    const proofHash = createHash('sha256').update(params.proof, 'utf8').digest('hex');
    const query = new URLSearchParams({ mode: 'keyless', proofHash });
    if (params.accountDirectoryTarget) {
        query.set('purpose', 'account_directory');
        query.set('endpointUrl', params.accountDirectoryTarget.endpointUrl);
        query.set('endpointServerIdentityId', params.accountDirectoryTarget.serverIdentityId);
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
async function loadProductionModules() {
    return {
        tokenStorage: await import('@/auth/storage/tokenStorage'),
        approvalClient: await import('@/auth/approval/homeDeviceApprovalClient'),
        serverFeatures: await import('@/sync/api/capabilities/serverFeaturesClient'),
        directorySession: await import('@/sync/domains/accountDirectory/accountDirectorySession'),
        serverProfiles: await import('@/sync/domains/server/serverProfiles'),
        adoptWithCredentials: await import('@/sync/domains/server/adoptHomeProfile'),
        refreshDirectory: await import('@/sync/ops/accountDirectory/refreshAccountHomeDirectory'),
        provisionHomeLink: await import('@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink'),
        enrollment: await import('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome'),
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

async function createProductionClient(storageScope: string): Promise<ProductionClient> {
    process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = storageScope;
    vi.resetModules();
    return { storageScope, modules: await loadProductionModules() };
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

describe('core e2e: Account Directory Home enrollment through the production caller', () => {
    let accountService: StartedServer | null = null;
    let homeA: StartedServer | null = null;
    let homeB: StartedServer | null = null;
    let stopOAuth: StopFn | null = null;

    let requesterClient!: ProductionClient;
    let approverClient!: ProductionClient;
    let directoryCapability!: DirectoryCapability;
    let previousStorageScope: string | undefined;

    let accountServiceBaseUrl = '';
    let accountServiceIdentity = '';
    let homeABaseUrl = '';
    let homeAIdentity = '';
    let homeBBaseUrl = '';
    let homeBIdentity = '';
    let accountAAccountId = '';
    let accountAFullToken = '';
    let directoryToken = '';
    let approverHomeBToken = '';
    let homeACredentialToken = '';
    let directoryTarget: Readonly<{ endpoint: string; serverIdentityId: string }> | null = null;
    let activeBefore: Readonly<{ serverId: string; serverUrl: string }> = { serverId: '', serverUrl: '' };
    let focusedServerId = '';
    let firstApprovalId = '';
    let enrolledHomeBToken = '';

    beforeAll(async () => {
        previousStorageScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        const clientScopeSuffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        requesterClient = await createProductionClient(
            `account_directory_home_enrollment_requester_${clientScopeSuffix}`,
        );
        approverClient = await createProductionClient(
            `account_directory_home_enrollment_approver_${clientScopeSuffix}`,
        );
        const modules = useProductionClient(requesterClient);

        const testDir = run.testDir('account-directory-home-enrollment-composed-caller');
        const oauth = await startFakeGitHubOAuthServer();
        stopOAuth = oauth.stop;

        const accountServicePort = await reserveAvailablePort();
        accountServiceBaseUrl = `http://127.0.0.1:${accountServicePort}`;
        accountService = await startServerLight({
            testDir: `${testDir}/account-service`,
            dbProvider: 'sqlite',
            __portAllocator: async () => accountServicePort,
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryComposedCallerA1',
                HAPPIER_PUBLIC_SERVER_URL: accountServiceBaseUrl,
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
                AUTH_SIGNUP_PROVIDERS: 'github',
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
                HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: '1',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: 'github',
                HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: '1',
                GITHUB_CLIENT_ID: 'account_directory_composed_client',
                GITHUB_CLIENT_SECRET: 'account_directory_composed_secret',
                GITHUB_REDIRECT_URL: `${accountServiceBaseUrl}/v1/oauth/github/callback`,
                HAPPIER_WEBAPP_URL: accountServiceBaseUrl,
                GITHUB_OAUTH_AUTHORIZE_URL: `${oauth.baseUrl}/login/oauth/authorize`,
                GITHUB_OAUTH_TOKEN_URL: `${oauth.baseUrl}/login/oauth/access_token`,
                GITHUB_API_USER_URL: `${oauth.baseUrl}/user`,
            },
        });
        homeA = await startServerLight({
            testDir: `${testDir}/home-a`,
            dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryComposedHomeAA1',
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
            },
        });
        homeABaseUrl = homeA.baseUrl;
        homeB = await startServerLight({
            testDir: `${testDir}/home-b`,
            dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryComposedHomeBA1',
                // Home-owned approval policy: the v1 source of truth.
                HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '1',
            },
        });
        homeBBaseUrl = homeB.baseUrl;

        // Real production feature probe (the same caller the Account Service
        // settings surface uses) establishes identities and capabilities.
        const directoryProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: accountServiceBaseUrl,
            force: true,
        });
        expect(directoryProbe.status).toBe('ready');
        expect(directoryProbe.serverIdentityId).toBe('srv_accountDirectoryComposedCallerA1');
        accountServiceIdentity = directoryProbe.serverIdentityId!.trim();
        directoryCapability = modules.directorySession.parseAccountDirectoryCapability(
            directoryProbe.features.capabilities.accountDirectory,
        )!;
        expect(directoryCapability.homeDirectory).toBe(true);
        expect(directoryCapability.homeEnrollment).toBe(true);
        expect(directoryCapability.homeLoginAssertion.keyId).toEqual(expect.any(String));

        const homeAProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: homeABaseUrl,
            force: true,
        });
        expect(homeAProbe.status).toBe('ready');
        expect(homeAProbe.serverIdentityId).toBe('srv_accountDirectoryComposedHomeAA1');
        homeAIdentity = homeAProbe.serverIdentityId!.trim();

        const homeBProbe = await modules.serverFeatures.probeServerFeaturesAtUrl({
            endpointUrl: homeBBaseUrl,
            force: true,
        });
        expect(homeBProbe.status).toBe('ready');
        expect(homeBProbe.serverIdentityId).toBe('srv_accountDirectoryComposedHomeBA1');
        homeBIdentity = homeBProbe.serverIdentityId!.trim();

        // A trusted, already-enrolled full Home B user (the approver). The token
        // is server-side state captured here; the Home B profile and its
        // ordinary full Home credential are adopted inside the test body
        // because client-local storage is scoped per test.
        const approver = await createTestAuth(homeBBaseUrl);
        approverHomeBToken = approver.token;
    }, 300_000);

    it('enrolls, rejects a second request, and survives Account Service outage while Home A stays focused', async () => {
        const requesterModules = useProductionClient(requesterClient);

        // --- Focused Home A with existing credentials and group selection ---
        const homeAAccount = await createTestAuth(homeABaseUrl);
        homeACredentialToken = homeAAccount.token;
        const adoptedA = await requesterModules.adoptWithCredentials.adoptHomeProfileWithCredentials({
            descriptor: homeDescriptor({ homeServerIdentityId: homeAIdentity, baseUrl: homeABaseUrl }),
            source: 'manual',
            credentials: { token: homeAAccount.token },
        });
        requesterModules.serverProfiles.setActiveServerId(adoptedA.id);
        const snapshotBefore = requesterModules.serverProfiles.getActiveServerSnapshot();
        activeBefore = { serverId: snapshotBefore.serverId, serverUrl: snapshotBefore.serverUrl };
        focusedServerId = snapshotBefore.serverId;
        expect(focusedServerId).toBe(homeAIdentity);
        requesterModules.serverProfiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focusedServerId,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focusedServerId] }],
        });

        // --- A separate trusted client is already enrolled in Home B. Its
        // production module graph and credential/profile storage are disjoint
        // from the requester, as they would be in a separate client process. ---
        const approverModules = useProductionClient(approverClient);
        const adoptedB = await approverModules.adoptWithCredentials.adoptHomeProfileWithCredentials({
            descriptor: homeDescriptor({ homeServerIdentityId: homeBIdentity, baseUrl: homeBBaseUrl }),
            source: 'manual',
            credentials: { token: approverHomeBToken },
            suggestedName: 'Home B',
        });
        expect(adoptedB.serverIdentityId).toBe(homeBIdentity);
        const storedApproverHomeB = await approverModules.tokenStorage.TokenStorage
            .getCredentialsForServerUrl(homeBBaseUrl, { serverId: homeBIdentity });
        expect(storedApproverHomeB?.token).toBe(approverHomeBToken);

        // --- Directory facts: account A signs in; the full-account OAuth first
        // creates the Account Service account, then the restricted Directory
        // credential for the continuation is stored in its dedicated namespace.
        // The Home relationship itself is never prepared manually. ---
        accountAFullToken = await acquireGitHubOAuthToken({
            accountServiceBaseUrl,
            proof: privacyKit.encodeBase64(randomBytes(32)),
        });
        const meResponse = await fetchJson<unknown>(`${accountServiceBaseUrl}/v1/account-directory/me`, {
            headers: bearer(accountAFullToken),
        });
        expect(meResponse.status).toBe(200);
        accountAAccountId = AccountDirectoryMeResponseV1Schema.parse(meResponse.data).accountId;

        directoryToken = await acquireGitHubOAuthToken({
            accountServiceBaseUrl,
            proof: privacyKit.encodeBase64(randomBytes(32)),
            accountDirectoryTarget: {
                endpointUrl: accountServiceBaseUrl,
                serverIdentityId: accountServiceIdentity,
            },
        });
        directoryTarget = { endpoint: accountServiceBaseUrl, serverIdentityId: accountServiceIdentity };
        const storedApproverDirectory = await approverModules.tokenStorage.TokenStorage
            .accountDirectoryAuthCredentials
            .set(directoryTarget, { token: directoryToken });
        expect(storedApproverDirectory).toBe(true);

        // --- The already-trusted client provisions the Home relationship
        // through the production operation —
        // authenticated Home link PUT via the canonical enrollment transport,
        // then the Account Service directory Home PUT. The captured stable Home
        // B identity is passed explicitly; no mutable-focus lookup and no
        // manual relationship or preference writes. ---
        const provisioningSession = approverModules.directorySession.createAccountDirectorySession(
            directoryTarget,
            { capability: directoryCapability },
        );
        const provisioned = await approverModules.provisionHomeLink.provisionAuthenticatedHomeLink({
            session: provisioningSession,
            homeServerIdentityId: homeBIdentity,
            issuerServerIdentityId: accountServiceIdentity,
            capability: directoryCapability,
        });
        expect(provisioned).toEqual({ kind: 'linked', homeServerIdentityId: homeBIdentity });

        // The second client receives only the restricted Account Service
        // credential. It has no Home B credential before enrollment.
        useProductionClient(requesterClient);
        const storedRequesterDirectory = await requesterModules.tokenStorage.TokenStorage
            .accountDirectoryAuthCredentials
            .set(directoryTarget, { token: directoryToken });
        expect(storedRequesterDirectory).toBe(true);
        const requesterHomeBBeforeEnrollment = await requesterModules.tokenStorage.TokenStorage
            .getCredentialsForServerUrl(homeBBaseUrl, { serverId: homeBIdentity });
        expect(requesterHomeBBeforeEnrollment).toBeNull();

        const session = requesterModules.directorySession.createAccountDirectorySession(
            directoryTarget,
            { capability: directoryCapability },
        );

        // --- Directory refresh: the first published Home became preferred
        // server-side as a consequence of the directory Home PUT, and the
        // canonical profile owner re-adopts it idempotently without touching
        // focus or duplicating the profile ---
        const refreshed = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(session);
        expect(refreshed.status).toBe('ready');
        expect(refreshed.preferredHomeServerIdentityId).toBe(homeBIdentity);
        expect(refreshed.account?.accountId).toBe(accountAAccountId);
        expect(refreshed.homes).toHaveLength(1);
        expect(refreshed.homes[0]).toMatchObject({
            homeServerIdentityId: homeBIdentity,
            label: 'Home B',
            preferred: true,
        });
        const homeBProfiles = requesterModules.serverProfiles.listServerProfiles().filter(
            (profile) => profile.serverIdentityId === homeBIdentity,
        );
        expect(homeBProfiles).toHaveLength(1);
        expect(homeBProfiles[0]!.name).toBe('Home B');
        expect(requesterModules.serverProfiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });

        const enrollment = await requesterModules.enrollment.enrollPreferredDirectoryHome(session);
        expect(enrollment.kind).toBe('approval_required');
        if (enrollment.kind !== 'approval_required') throw new Error('unreachable');
        expect(enrollment.homeServerIdentityId).toBe(homeBIdentity);
        expect(enrollment.approvalId).toEqual(expect.any(String));
        expect(enrollment.expiresAtMs).toBeGreaterThan(Date.now());
        firstApprovalId = enrollment.approvalId;

        // Pending state is published for Lane 05 scheduling; no token exists.
        const pending = requesterModules.enrollment.getPendingPreferredHomeEnrollment();
        expect(pending?.approvalId).toBe(firstApprovalId);
        expect(pending?.homeServerIdentityId).toBe(homeBIdentity);

        // --- The separate trusted Home B client lists the request. Its module
        // singleton cannot observe the requester's continuation state. ---
        useProductionClient(approverClient);
        expect(approverModules.enrollment.getPendingPreferredHomeEnrollment()).toBeNull();
        const approvalTarget = { endpointUrl: homeBBaseUrl, serverId: homeBIdentity };
        const listedBeforeDecision = await approverModules.approvalClient.listHomeDeviceApprovals(approvalTarget);
        expect(listedBeforeDecision.ok).toBe(true);
        if (!listedBeforeDecision.ok) throw new Error('unreachable');
        expect(listedBeforeDecision.items).toHaveLength(1);
        const listed = listedBeforeDecision.items[0]!;
        expect(listed.approvalId).toBe(firstApprovalId);
        expect(listed.flow).toBe('account_assertion');
        expect(listed.status).toBe('pending');
        expect(listed.issuerServerIdentityId).toBe(accountServiceIdentity);
        expect(listed.issuerSubjectId).toBe(accountAAccountId);
        expect(listed.expiresAtMs).toBe(enrollment.expiresAtMs);

        const decision = await approverModules.approvalClient.decideHomeDeviceApproval(
            approvalTarget,
            firstApprovalId,
            'approve',
        );
        expect(decision).toMatchObject({ ok: true, status: 'approved' });

        // --- Lane 05 resume: same assertion + approval id, strict authorized response ---
        useProductionClient(requesterClient);
        const resumed = await requesterModules.enrollment.resumePendingPreferredHomeEnrollment();
        expect(resumed).toEqual({ kind: 'enrolled', homeServerIdentityId: homeBIdentity });
        expect(requesterModules.enrollment.getPendingPreferredHomeEnrollment()).toBeNull();

        // --- Non-focusing adoption and explicit target credential write ---
        expect(requesterModules.serverProfiles.listServerProfiles().filter(
            (profile) => profile.serverIdentityId === homeBIdentity,
        )).toHaveLength(1);
        expect(requesterModules.serverProfiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                serverIdentityId: homeBIdentity,
                name: 'Home B',
            }),
        ]));
        expect(requesterModules.serverProfiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
        expect(requesterModules.serverProfiles.loadHomeViewState()).toMatchObject({
            activeTargetId: focusedServerId,
            groups: [{ id: 'g', serverIds: [focusedServerId] }],
        });

        // The requester's new B credential is token-only and never contains
        // Directory material.
        const storedB = await requesterModules.tokenStorage.TokenStorage.getCredentialsForServerUrl(
            homeBBaseUrl,
            { serverId: homeBIdentity },
        );
        expect(storedB).not.toBeNull();
        expect(Object.keys(storedB!)).toEqual(['token']);
        expect(storedB!.token).toEqual(expect.any(String));
        expect(storedB!.token!.length).toBeGreaterThan(0);
        expect(storedB!.token).not.toBe(approverHomeBToken);
        expect(storedB!.token).not.toBe(directoryToken);
        enrolledHomeBToken = storedB!.token!;

        // Requester persistence cannot overwrite the approver's ordinary Home
        // credential in the other client storage scope.
        useProductionClient(approverClient);
        const approverHomeBAfterRequesterEnrollment = await approverModules.tokenStorage.TokenStorage
            .getCredentialsForServerUrl(homeBBaseUrl, { serverId: homeBIdentity });
        expect(approverHomeBAfterRequesterEnrollment?.token).toBe(approverHomeBToken);

        // Home A credentials and selection state remain untouched.
        useProductionClient(requesterClient);
        const storedA = await requesterModules.tokenStorage.TokenStorage.getCredentialsForServerUrl(
            homeABaseUrl,
            { serverId: homeAIdentity },
        );
        expect(storedA?.token).toBe(homeACredentialToken);

        // --- The enrolled credential reaches the real ordinary Home API ---
        const profileWithEnrolledToken = await fetchJson<unknown>(`${homeBBaseUrl}/v1/account/profile`, {
            headers: bearer(enrolledHomeBToken),
        });
        expect(profileWithEnrolledToken.status).toBe(200);

        // --- A Directory credential cannot use ordinary Home APIs or approvals ---
        const directoryOnOrdinaryHomeApi = await fetchJson<unknown>(`${homeBBaseUrl}/v1/account/profile`, {
            headers: bearer(directoryToken),
        });
        expect([401, 403]).toContain(directoryOnOrdinaryHomeApi.status);
        const directoryOnApprovalList = await fetchJson<unknown>(
            `${homeBBaseUrl}/v1/auth/home-login/approvals`,
            { headers: bearer(directoryToken) },
        );
        expect([401, 403]).toContain(directoryOnApprovalList.status);
        const directoryOnApprovalDecision = await fetchJson<unknown>(
            `${homeBBaseUrl}/v1/auth/home-login/approvals/${firstApprovalId}/decision`,
            {
                method: 'POST',
                headers: { ...bearer(directoryToken), 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: 'approve' }),
            },
        );
        expect([401, 403]).toContain(directoryOnApprovalDecision.status);

        expect(directoryTarget).not.toBeNull();
        const directoryCredentialsBeforeRetry = await requesterModules.tokenStorage.TokenStorage
            .accountDirectoryAuthCredentials.get(directoryTarget!);
        expect(directoryCredentialsBeforeRetry?.token === directoryToken).toBe(true);

        // Second enrollment round against the same directory: new assertion,
        // new requester key, fresh pending approval.
        const retrySession = requesterModules.directorySession.createAccountDirectorySession(
            directoryTarget!,
            { capability: directoryCapability },
        );
        const retryRefresh = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(retrySession);
        expect(retryRefresh).toMatchObject({ status: 'ready' });
        expect(retryRefresh.preferredHomeServerIdentityId).toBe(homeBIdentity);
        const retryEnrollment = await requesterModules.enrollment.enrollPreferredDirectoryHome(retrySession);
        expect(retryEnrollment).toMatchObject({ kind: 'approval_required' });
        if (retryEnrollment.kind !== 'approval_required') throw new Error('unreachable');
        expect(retryEnrollment.approvalId).not.toBe(firstApprovalId);

        useProductionClient(approverClient);
        const retryApprovalTarget = { endpointUrl: homeBBaseUrl, serverId: homeBIdentity };
        const retryListed = await approverModules.approvalClient.listHomeDeviceApprovals(retryApprovalTarget);
        expect(retryListed.ok).toBe(true);
        if (!retryListed.ok) throw new Error('unreachable');
        expect(retryListed.items.map((item) => item.approvalId)).toEqual([retryEnrollment.approvalId]);

        const rejected = await approverModules.approvalClient.decideHomeDeviceApproval(
            retryApprovalTarget,
            retryEnrollment.approvalId,
            'reject',
        );
        expect(rejected).toMatchObject({ ok: true, status: 'rejected' });

        useProductionClient(requesterClient);
        const resumedAfterReject = await requesterModules.enrollment.resumePendingPreferredHomeEnrollment();
        expect(resumedAfterReject).toEqual({ kind: 'rejected' });
        expect(requesterModules.enrollment.getPendingPreferredHomeEnrollment()).toBeNull();

        // Rejection issued no second credential: the enrolled token from the
        // positive round is still the only Home B credential in storage.
        const storedBAfterReject = await requesterModules.tokenStorage.TokenStorage.getCredentialsForServerUrl(
            homeBBaseUrl,
            { serverId: homeBIdentity },
        );
        expect(storedBAfterReject?.token).toBe(enrolledHomeBToken);

        // --- Directory mutations are idempotent Account Service metadata only. ---
        // Exercise the production session/client/routes twice per mutation and prove
        // that removing the Directory row does not remove the already adopted Home,
        // its Home-local credential, or the independently focused Home A state.
        const updatedHomeB = {
            homeServerIdentityId: homeBIdentity,
            label: 'Home B updated',
            connectionDescriptor: homeDescriptor({ homeServerIdentityId: homeBIdentity, baseUrl: homeBBaseUrl }),
        };
        const firstUpdate = await session.putHome(updatedHomeB);
        const secondUpdate = await session.putHome(updatedHomeB);
        expect(firstUpdate).toEqual(secondUpdate);
        expect(secondUpdate).toMatchObject({
            homeServerIdentityId: homeBIdentity,
            label: 'Home B updated',
            preferred: true,
        });

        const firstPreferred = await session.setPreferredHome(homeBIdentity);
        const secondPreferred = await session.setPreferredHome(homeBIdentity);
        expect(firstPreferred).toEqual(secondPreferred);
        expect(secondPreferred.preferredHomeServerIdentityId).toBe(homeBIdentity);

        const afterUpdates = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(session);
        expect(afterUpdates.status).toBe('ready');
        expect(afterUpdates.preferredHomeServerIdentityId).toBe(homeBIdentity);
        expect(afterUpdates.homes).toEqual([
            expect.objectContaining({
                homeServerIdentityId: homeBIdentity,
                label: 'Home B updated',
                preferred: true,
            }),
        ]);

        const firstDelete = await session.deleteHome(homeBIdentity);
        const secondDelete = await session.deleteHome(homeBIdentity);
        expect(firstDelete).toEqual(secondDelete);
        expect(secondDelete).toMatchObject({
            deleted: true,
            homeServerIdentityId: homeBIdentity,
            preferredHomeServerIdentityId: null,
        });

        const afterDeletes = await requesterModules.refreshDirectory.refreshAccountHomeDirectory(session);
        expect(afterDeletes).toMatchObject({
            status: 'ready',
            preferredHomeServerIdentityId: null,
            homes: [],
        });
        expect(requesterModules.serverProfiles.listServerProfiles().filter(
            (profile) => profile.serverIdentityId === homeBIdentity,
        )).toHaveLength(1);
        const storedBAfterDirectoryDelete = await requesterModules.tokenStorage.TokenStorage.getCredentialsForServerUrl(
            homeBBaseUrl,
            { serverId: homeBIdentity },
        );
        expect(storedBAfterDirectoryDelete?.token).toBe(enrolledHomeBToken);
        const profileAfterDirectoryDelete = await fetchJson<unknown>(`${homeBBaseUrl}/v1/account/profile`, {
            headers: bearer(enrolledHomeBToken),
        });
        expect(profileAfterDirectoryDelete.status).toBe(200);
        expect(requesterModules.serverProfiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
        expect(requesterModules.serverProfiles.loadHomeViewState()).toMatchObject({
            activeTargetId: focusedServerId,
            groups: [{ id: 'g', serverIds: [focusedServerId] }],
        });
        const storedAAfterDirectoryDelete = await requesterModules.tokenStorage.TokenStorage.getCredentialsForServerUrl(
            homeABaseUrl,
            { serverId: homeAIdentity },
        );
        expect(storedAAfterDirectoryDelete?.token).toBe(homeACredentialToken);

        // --- Account Service outage: the enrolled Home credential keeps working ---
        await accountService!.stop();
        accountService = null;
        const profileAfterOutage = await fetchJson<unknown>(`${homeBBaseUrl}/v1/account/profile`, {
            headers: bearer(enrolledHomeBToken),
        });
        expect(profileAfterOutage.status).toBe(200);
        expect(requesterModules.serverProfiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
    }, 300_000);

    afterAll(async () => {
        await accountService?.stop().catch(() => {});
        await homeA?.stop().catch(() => {});
        await homeB?.stop().catch(() => {});
        await stopOAuth?.().catch(() => {});
        if (previousStorageScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousStorageScope;
    });
});
