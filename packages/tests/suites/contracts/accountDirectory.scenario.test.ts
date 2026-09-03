import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DIRECTORY_ASSERTION_MAX_LIFETIME_MS,
  ACCOUNT_DIRECTORY_ASSERTION_MIN_LIFETIME_MS,
  ACCOUNT_DIRECTORY_ASSERTION_SIGNING_DOMAIN_V1,
  ACCOUNT_DIRECTORY_HOME_LOGIN_ASSERTION_HTTP_PATH_V1,
  ACCOUNT_DIRECTORY_HOMES_HTTP_PATH_V1,
  ACCOUNT_DIRECTORY_LINKS_HTTP_PATH_V1,
  ACCOUNT_DIRECTORY_ME_HTTP_PATH_V1,
  ACCOUNT_DIRECTORY_PREFERRED_HOME_HTTP_PATH_V1,
  HOME_LOGIN_HTTP_PATH_V1,
  AccountDirectoryCapabilitiesSchema,
  AccountDirectoryHomeEntryV1Schema,
  AccountDirectoryHomesResponseV1Schema,
  AccountDirectoryLinkPutRequestV1Schema,
  AccountDirectoryMeResponseV1Schema,
  HomeConnectionDescriptorV1Schema,
  HomeLoginAssertionV1Schema,
  createHomeCredentialDestinationDigestV1,
} from '@happier-dev/protocol';

const keyBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const keyBase64Url = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const keyId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const httpsDescriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_https',
  canonicalServerUrl: 'https://home.example.test',
  revision: 1,
  endpoints: [{ kind: 'https' as const, url: 'https://home.example.test' }],
};

const irohDescriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_iroh',
  canonicalServerUrl: 'http://127.0.0.1:43123',
  revision: 2,
  endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
};

/**
 * Ordinary supporting protocol contracts for the Account Directory corridor. These names
 * describe the boundary each check exercises; acceptance IDs and run status are owned by the
 * Lane 09 plan and its sole release report, not by test titles or source registries.
 */
describe('Account Directory supporting protocol contracts', () => {
  it('accepts closed HTTPS and Iroh descriptors and rejects unknown fields and non-HTTP URLs', () => {
    expect(HomeConnectionDescriptorV1Schema.safeParse(httpsDescriptor).success).toBe(true);
    expect(HomeConnectionDescriptorV1Schema.safeParse(irohDescriptor).success).toBe(true);
    expect(HomeConnectionDescriptorV1Schema.safeParse({ ...httpsDescriptor, extra: true }).success).toBe(false);
    expect(HomeConnectionDescriptorV1Schema.safeParse({
      ...httpsDescriptor,
      canonicalServerUrl: 'ftp://home.example.test',
    }).success).toBe(false);
  });

  it('keeps directory entries, preferred state, and Home identity consistent', () => {
    const home = {
      v: 1 as const,
      homeServerIdentityId: httpsDescriptor.homeServerIdentityId,
      canonicalServerUrl: httpsDescriptor.canonicalServerUrl,
      label: 'Personal Home',
      connectionDescriptor: httpsDescriptor,
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_000_001,
      preferred: true,
    };
    expect(AccountDirectoryHomeEntryV1Schema.safeParse(home).success).toBe(true);
    expect(AccountDirectoryHomesResponseV1Schema.safeParse({
      v: 1,
      homes: [home],
      preferredHomeServerIdentityId: home.homeServerIdentityId,
    }).success).toBe(true);
    expect(AccountDirectoryHomesResponseV1Schema.safeParse({
      v: 1,
      homes: [home],
      preferredHomeServerIdentityId: 'srv_other',
    }).success).toBe(false);
    expect(AccountDirectoryHomeEntryV1Schema.safeParse({
      ...home,
      canonicalServerUrl: 'https://other.example.test',
    }).success).toBe(false);
  });

  it('keeps the /me response closed without caller-supplied identity', () => {
    const value = {
      v: 1 as const,
      accountId: 'account-1',
      displayName: 'Ada Lovelace',
      avatar: null,
      linkedAuthenticationMethods: [{ providerId: 'github', login: 'ada' }],
    };
    expect(AccountDirectoryMeResponseV1Schema.safeParse(value).success).toBe(true);
    expect(AccountDirectoryMeResponseV1Schema.safeParse({ ...value, unexpected: true }).success).toBe(false);
  });

  it('keeps issuer-link input strict with explicit relinking', () => {
    const link = {
      v: 1 as const,
      issuerServerIdentityId: 'srv_account_service',
      issuerSubjectId: 'account-subject-1',
      issuerSigningKeyId: keyId,
      issuerSigningPublicKeyBase64Url: keyBase64Url,
    };
    expect(AccountDirectoryLinkPutRequestV1Schema.safeParse(link).success).toBe(true);
    expect(AccountDirectoryLinkPutRequestV1Schema.parse({ ...link, relink: true }).relink).toBe(true);
    expect(AccountDirectoryLinkPutRequestV1Schema.safeParse({ ...link, accountId: 'caller-supplied' }).success).toBe(false);
  });

  it('bounds login-assertion lifetime and keeps the independent signing domain', () => {
    const issuedAtMs = 1_700_000_000_000;
    expect(HomeLoginAssertionV1Schema.safeParse({
      v: 1,
      purpose: 'happier.home-login',
      issuerServerIdentityId: 'srv_account_service',
      issuerSubjectId: 'account-subject-1',
      audienceHomeServerIdentityId: httpsDescriptor.homeServerIdentityId,
      credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(httpsDescriptor),
      clientBoxPublicKeyBase64: keyBase64,
      issuedAtMs,
      expiresAtMs: issuedAtMs + ACCOUNT_DIRECTORY_ASSERTION_MIN_LIFETIME_MS,
      keyId,
      signatureBase64Url: 'A'.repeat(86),
    }).success).toBe(true);
    expect(ACCOUNT_DIRECTORY_ASSERTION_MAX_LIFETIME_MS).toBeGreaterThanOrEqual(
      ACCOUNT_DIRECTORY_ASSERTION_MIN_LIFETIME_MS,
    );
    expect(ACCOUNT_DIRECTORY_ASSERTION_SIGNING_DOMAIN_V1).toMatch(/^happier\.account-directory\./u);
  });

  it('keeps Account Directory routes and capability vocabulary on protocol-owned paths', () => {
    expect(ACCOUNT_DIRECTORY_ME_HTTP_PATH_V1).toBe('/v1/account-directory/me');
    expect(ACCOUNT_DIRECTORY_HOMES_HTTP_PATH_V1).toBe('/v1/account-directory/homes');
    expect(ACCOUNT_DIRECTORY_PREFERRED_HOME_HTTP_PATH_V1).toContain('/preferred');
    expect(ACCOUNT_DIRECTORY_HOME_LOGIN_ASSERTION_HTTP_PATH_V1).toContain('login-assertion');
    expect(ACCOUNT_DIRECTORY_LINKS_HTTP_PATH_V1).toMatch(/^\/v1\/account\/directory-links\//u);
    expect(HOME_LOGIN_HTTP_PATH_V1).toBe('/v1/auth/home-login');
    expect(AccountDirectoryCapabilitiesSchema.safeParse({
      version: 1,
      homeDirectory: true,
      extra: true,
    }).success).toBe(false);
  });
});
