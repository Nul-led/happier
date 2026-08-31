import { createHash, randomBytes } from 'node:crypto';

import {
  AccountDirectoryHomesResponseV1Schema,
  AccountDirectoryMeResponseV1Schema,
  FeaturesResponseSchema,
  HomeConnectionDescriptorV1Schema,
  HomeLoginAssertionV1Schema,
  HomeLoginRedemptionResponseV1Schema,
  decodeBase64,
  openBoxBundle,
} from '@happier-dev/protocol';
import * as privacyKit from 'privacy-kit';
import tweetnacl from 'tweetnacl';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startFakeGitHubOAuthServer, type StopFn } from '../../src/testkit/oauth/fakeGithubOAuthServer';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';

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
  if (params.accountDirectoryTarget) {
    expect(completionUrl.searchParams.get('purpose')).toBe('account_directory');
    expect(completionUrl.searchParams.get('credentialTarget')).toBe('account_directory');
    expect(completionUrl.searchParams.get('endpointUrl')).toBe(params.accountDirectoryTarget.endpointUrl);
    expect(completionUrl.searchParams.get('endpointServerIdentityId')).toBe(
      params.accountDirectoryTarget.serverIdentityId,
    );
  }

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

describe('core e2e: Account Directory enrollment survives Account Service outage', () => {
  let accountService: StartedServer | null = null;
  let home: StartedServer | null = null;
  let stopOAuth: StopFn | null = null;

  afterAll(async () => {
    await accountService?.stop().catch(() => {});
    await home?.stop().catch(() => {});
    await stopOAuth?.().catch(() => {});
  });

  it('redeems a restricted Directory session into an independent Home credential', async () => {
    const testDir = run.testDir('account-directory-enrollment-outage');
    const oauth = await startFakeGitHubOAuthServer();
    stopOAuth = oauth.stop;

    const accountServicePort = await reserveAvailablePort();
    const accountServiceBaseUrl = `http://127.0.0.1:${accountServicePort}`;
    accountService = await startServerLight({
      testDir: `${testDir}/account-service`,
      dbProvider: 'sqlite',
      __portAllocator: async () => accountServicePort,
      extraEnv: {
        HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryE2eA1',
        HAPPIER_PUBLIC_SERVER_URL: accountServiceBaseUrl,
        HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
        AUTH_SIGNUP_PROVIDERS: 'github',
        HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
        HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_PROVIDERS: 'github',
        HAPPIER_FEATURE_AUTH_OAUTH__KEYLESS_AUTO_PROVISION: '1',
        GITHUB_CLIENT_ID: 'account_directory_e2e_client',
        GITHUB_CLIENT_SECRET: 'account_directory_e2e_secret',
        GITHUB_REDIRECT_URL: `${accountServiceBaseUrl}/v1/oauth/github/callback`,
        HAPPIER_WEBAPP_URL: accountServiceBaseUrl,
        GITHUB_OAUTH_AUTHORIZE_URL: `${oauth.baseUrl}/login/oauth/authorize`,
        GITHUB_OAUTH_TOKEN_URL: `${oauth.baseUrl}/login/oauth/access_token`,
        GITHUB_API_USER_URL: `${oauth.baseUrl}/user`,
      },
    });
    home = await startServerLight({
      testDir: `${testDir}/home`,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_SERVER_IDENTITY_ID: 'srv_accountDirectoryHomeE2eA1',
        HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: '0',
      },
    });

    const accountServiceFeaturesResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/features`);
    expect(accountServiceFeaturesResponse.status).toBe(200);
    const accountServiceFeatures = FeaturesResponseSchema.parse(accountServiceFeaturesResponse.data);
    const accountServiceIdentity = accountServiceFeatures.capabilities.serverIdentity?.serverIdentityId;
    const directoryCapability = accountServiceFeatures.capabilities.accountDirectory;
    expect(accountServiceIdentity).toBe('srv_accountDirectoryE2eA1');
    expect(directoryCapability).toBeDefined();
    expect(directoryCapability?.homeDirectory).toBe(true);
    expect(directoryCapability?.homeEnrollment).toBe(true);

    const homeFeaturesResponse = await fetchJson<unknown>(`${home.baseUrl}/v1/features`);
    expect(homeFeaturesResponse.status).toBe(200);
    const homeFeatures = FeaturesResponseSchema.parse(homeFeaturesResponse.data);
    const homeIdentity = homeFeatures.capabilities.serverIdentity?.serverIdentityId;
    expect(homeIdentity).toBe('srv_accountDirectoryHomeE2eA1');

    const accountAFullToken = await acquireGitHubOAuthToken({
      accountServiceBaseUrl: accountService.baseUrl,
      proof: privacyKit.encodeBase64(randomBytes(32)),
    });
    const accountAResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/account-directory/me`, {
      headers: bearer(accountAFullToken),
    });
    expect(accountAResponse.status).toBe(200);
    const accountA = AccountDirectoryMeResponseV1Schema.parse(accountAResponse.data);

    const accountB = await createTestAuth(accountService.baseUrl);

    const homeAccount = await createTestAuth(home.baseUrl);
    const linkResponse = await fetchJson<unknown>(
      `${home.baseUrl}/v1/account/directory-links/${accountServiceIdentity}`,
      {
        method: 'PUT',
        headers: { ...bearer(homeAccount.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          issuerServerIdentityId: accountServiceIdentity,
          issuerSubjectId: accountA.accountId,
          issuerSigningKeyId: directoryCapability!.homeLoginAssertion.keyId,
          issuerSigningPublicKeyBase64Url: directoryCapability!.homeLoginAssertion.publicKeyBase64Url,
        }),
      },
    );
    expect(linkResponse.status).toBe(200);

    const descriptor = HomeConnectionDescriptorV1Schema.parse({
      v: 1,
      homeServerIdentityId: homeIdentity,
      canonicalServerUrl: home.baseUrl,
      revision: 1,
      endpoints: [{ kind: 'https', url: home.baseUrl }],
    });
    const directoryPutResponse = await fetchJson<unknown>(
      `${accountService.baseUrl}/v1/account-directory/homes/${homeIdentity}`,
      {
        method: 'PUT',
        headers: { ...bearer(accountAFullToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: 1, label: 'Enrollment outage Home', connectionDescriptor: descriptor }),
      },
    );
    expect(directoryPutResponse.status).toBe(200);

    const preferredResponse = await fetchJson<unknown>(
      `${accountService.baseUrl}/v1/account-directory/homes/preferred`,
      {
        method: 'PATCH',
        headers: { ...bearer(accountAFullToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: 1, homeServerIdentityId: homeIdentity }),
      },
    );
    expect(preferredResponse.status).toBe(200);

    const accountBDirectoryResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/account-directory/homes`, {
      headers: bearer(accountB.token),
    });
    expect(accountBDirectoryResponse.status).toBe(200);
    expect(AccountDirectoryHomesResponseV1Schema.parse(accountBDirectoryResponse.data).homes).toEqual([]);

    const directoryToken = await acquireGitHubOAuthToken({
      accountServiceBaseUrl: accountService.baseUrl,
      proof: privacyKit.encodeBase64(randomBytes(32)),
      accountDirectoryTarget: {
        endpointUrl: accountService.baseUrl,
        serverIdentityId: accountServiceIdentity!,
      },
    });

    const restrictedMeResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/account-directory/me`, {
      headers: bearer(directoryToken),
    });
    expect(restrictedMeResponse.status).toBe(200);
    expect(AccountDirectoryMeResponseV1Schema.parse(restrictedMeResponse.data).accountId).toBe(accountA.accountId);

    const forbiddenPresentUserResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/account/profile`, {
      headers: bearer(directoryToken),
    });
    expect(forbiddenPresentUserResponse.status).toBe(403);

    const directoryResponse = await fetchJson<unknown>(`${accountService.baseUrl}/v1/account-directory/homes`, {
      headers: bearer(directoryToken),
    });
    expect(directoryResponse.status).toBe(200);
    const directory = AccountDirectoryHomesResponseV1Schema.parse(directoryResponse.data);
    expect(directory.preferredHomeServerIdentityId).toBe(homeIdentity);
    expect(directory.homes).toHaveLength(1);
    expect(directory.homes[0]?.connectionDescriptor).toEqual(descriptor);

    const clientBoxKeyPair = tweetnacl.box.keyPair();
    const clientBoxPublicKeyBase64 = privacyKit.encodeBase64(Uint8Array.from(clientBoxKeyPair.publicKey));
    expect(clientBoxPublicKeyBase64.endsWith('=')).toBe(true);
    const assertionResponse = await fetchJson<unknown>(
      `${accountService.baseUrl}/v1/account-directory/homes/${homeIdentity}/login-assertion`,
      {
        method: 'POST',
        headers: { ...bearer(directoryToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: 1, homeServerIdentityId: homeIdentity, clientBoxPublicKeyBase64 }),
      },
    );
    expect(assertionResponse.status).toBe(200);
    const assertion = HomeLoginAssertionV1Schema.parse(assertionResponse.data);
    expect(assertion.issuerSubjectId).toBe(accountA.accountId);
    expect(assertion.audienceHomeServerIdentityId).toBe(homeIdentity);
    expect(assertion.clientBoxPublicKeyBase64).toBe(clientBoxPublicKeyBase64);

    const redemptionResponse = await fetchJson<unknown>(`${home.baseUrl}/v1/auth/home-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, assertion }),
    });
    expect(redemptionResponse.status).toBe(200);
    const redemption = HomeLoginRedemptionResponseV1Schema.parse(redemptionResponse.data);
    expect(redemption.homeServerIdentityId).toBe(homeIdentity);

    const sealedBundle = decodeBase64(redemption.sealedHomeTokenBase64Url, 'base64url');
    const opened = openBoxBundle({
      bundle: sealedBundle,
      recipientSecretKeyOrSeed: clientBoxKeyPair.secretKey,
    });
    expect(opened).not.toBeNull();
    const parsedCredentials: unknown = JSON.parse(new TextDecoder().decode(opened!));
    expect(parsedCredentials).toEqual({ token: expect.any(String) });
    const credentialRecord = parsedCredentials as Record<string, unknown>;
    expect(Object.keys(credentialRecord)).toEqual(['token']);
    const homeToken = credentialRecord.token;
    expect(typeof homeToken).toBe('string');

    const homeBeforeOutage = await fetchJson<unknown>(`${home.baseUrl}/v1/account/profile`, {
      headers: bearer(homeToken as string),
    });
    expect(homeBeforeOutage.status).toBe(200);

    await accountService.stop();
    accountService = null;

    const homeAfterOutage = await fetchJson<unknown>(`${home.baseUrl}/v1/account/profile`, {
      headers: bearer(homeToken as string),
    });
    expect(homeAfterOutage.status).toBe(200);
  }, 300_000);
});
