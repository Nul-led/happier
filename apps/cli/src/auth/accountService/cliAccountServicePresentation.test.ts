import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCliSelectedAccountServicePresentation } from './cliAccountServicePresentation';
import { createCliAccountServiceSessionOwner } from './cliAccountServiceSession';

const fetchServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: (...args: unknown[]) => fetchServerFeaturesSnapshotMock(...args),
}));

const roots: string[] = [];
const originalHome = process.env.HAPPIER_HOME_DIR;

afterEach(async () => {
  fetchServerFeaturesSnapshotMock.mockReset();
  if (originalHome === undefined) delete process.env.HAPPIER_HOME_DIR;
  else process.env.HAPPIER_HOME_DIR = originalHome;
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe('resolveCliSelectedAccountServicePresentation', () => {
  it('returns only a current identity-verified Account Service name', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-presentation-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService({
      endpoint: 'https://accounts.example.test',
      serverIdentityId: 'srv_accounts',
      canonicalServerUrl: 'https://accounts.example.test',
      advertisedMethods: { keyLoginAvailable: true, oauthProviderIds: [], preferredProvisionProviderId: null },
    });
    fetchServerFeaturesSnapshotMock.mockResolvedValue({
      status: 'ready',
      features: {
        features: {},
        capabilities: {
          serverIdentity: { serverIdentityId: 'srv_accounts' },
          server: { canonicalServerUrl: 'https://accounts.example.test' },
          accountDirectory: { version: 1, homeDirectory: true, homeEnrollment: true, deviceApproval: true, homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) } },
        },
        accountServicePresentation: { v: 1, displayName: 'Work Accounts' },
      },
    });
    await expect(resolveCliSelectedAccountServicePresentation()).resolves.toMatchObject({
      displayName: 'Work Accounts',
      serverIdentityId: 'srv_accounts',
    });
  });
});
