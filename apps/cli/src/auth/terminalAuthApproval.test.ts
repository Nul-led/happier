import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tweetnacl from 'tweetnacl';
import { deriveAccountMachineKeyFromRecoverySecret, openTerminalProvisioningV3Response, sealTerminalProvisioningV3Payload } from '@happier-dev/protocol';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

const { mockPost, mockGet } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mockPost,
    get: mockGet,
  },
}));

describe('approveTerminalAuthRequest', () => {
  const envKeys = [
    'HAPPIER_HOME_DIR',
    'HAPPIER_SERVER_URL',
    'HAPPIER_LOCAL_SERVER_URL',
    'HAPPIER_PUBLIC_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_ACTIVE_SERVER_ID',
  ] as const;

  let envScope = createEnvKeyScope(envKeys);

  afterEach(() => {
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    mockPost.mockReset();
    mockGet.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('posts approval response to apiServerUrl when local override is present', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-', async (homeDir) => {
      envScope.patch({
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: 'http://127.0.0.1:53288',
        HAPPIER_LOCAL_SERVER_URL: 'http://127.0.0.1:53288',
        HAPPIER_PUBLIC_SERVER_URL: 'http://host.lima.internal:53288',
        HAPPIER_WEBAPP_URL: undefined,
        HAPPIER_ACTIVE_SERVER_ID: undefined,
      });

      writeFileSync(
        join(homeDir, 'settings.json'),
        JSON.stringify(
          {
            schemaVersion: 5,
            onboardingCompleted: true,
            activeServerId: 's_local',
            servers: {
              s_local: {
                id: 's_local',
                name: 'Local dev',
                serverUrl: 'http://127.0.0.1:53288',
                webappUrl: 'http://localhost:53288',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 1,
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const serversDir = join(homeDir, 'servers', 's_local');
      mkdirSync(serversDir, { recursive: true });
      writeFileSync(
        join(serversDir, 'access.key'),
        JSON.stringify(
          {
            token: 'token-1',
            encryption: {
              publicKey: Buffer.alloc(32, 1).toString('base64'),
              machineKey: Buffer.alloc(32, 2).toString('base64'),
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const configMod = await import('@/configuration');
      configMod.reloadConfiguration();
      expect(configMod.configuration.serverUrl).toBe('http://host.lima.internal:53288');
      expect(configMod.configuration.apiServerUrl).toBe('http://127.0.0.1:53288');

      mockPost.mockResolvedValueOnce({ status: 200, data: {} });

      const approval = await import('./terminalAuthApproval');
      const terminalPublicKey = Buffer.alloc(32, 3).toString('base64');
      await approval.approveTerminalAuthRequest({ publicKey: terminalPublicKey });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url] = mockPost.mock.calls[0] ?? [];
      expect(url).toBe('http://127.0.0.1:53288/v1/auth/response');
    });
  });

  it('reports a typed upgrade requirement for token-only credentials without posting a keyed response', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-token-only-', async (homeDir) => {
      envScope.patch({
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: 'https://api.happier.dev',
        HAPPIER_LOCAL_SERVER_URL: undefined,
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_WEBAPP_URL: undefined,
        HAPPIER_ACTIVE_SERVER_ID: undefined,
      });

      const configMod = await import('@/configuration');
      configMod.reloadConfiguration();
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsTokenOnly({ token: 'token-only-1' });

      const approval = await import('./terminalAuthApproval');
      const terminalPublicKey = Buffer.alloc(32, 3).toString('base64');
      await expect(
        approval.approveTerminalAuthRequest({ publicKey: terminalPublicKey }),
      ).rejects.toMatchObject({
        name: 'TokenOnlyTerminalApprovalUpgradeRequiredError',
        code: 'TOKEN_ONLY_TERMINAL_APPROVAL_UPGRADE_REQUIRED',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it.each(['legacy', 'tokenOnly'] as const)('approves a current %s recipient with authenticated v3 using its request packet', async (credentialType) => {
    await withTempDir('happier-cli-terminal-auth-v3-', async (homeDir) => {
      envScope.patch({
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: 'https://api.happier.dev',
        HAPPIER_LOCAL_SERVER_URL: undefined,
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_WEBAPP_URL: undefined,
        HAPPIER_ACTIVE_SERVER_ID: undefined,
      });
      const configMod = await import('@/configuration');
      configMod.reloadConfiguration();
      const persistence = await import('@/persistence');
      const recoverySecret = new Uint8Array(32).fill(9);
      if (credentialType === 'legacy') await persistence.writeCredentialsLegacy({ token: 'local-token', secret: recoverySecret });
      else {
        await persistence.writeCredentialsTokenOnly({ token: 'local-token' });
        mockGet.mockResolvedValue({ status: 200, data: { mode: 'plain', updatedAt: 1 } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: { encryption: { plaintextStorage: { enabled: true } }, e2ee: { keylessAccounts: { enabled: true } } }, capabilities: {} }), { status: 200 })));
      }
      const keypair = tweetnacl.box.keyPair();
      const nowMs = Date.now();
      const secret = new Uint8Array(32).fill(11);
      const pairing = { secretB64Url: Buffer.from(secret).toString('base64url'), createdAtMs: nowMs, expiresAtMs: nowMs + 60_000 };
      const approval = await import('./terminalAuthApproval');
      mockPost.mockResolvedValueOnce({ status: 200, data: {} });
      await approval.approveTerminalAuthRequest({
        publicKey: Buffer.from(keypair.publicKey).toString('base64'), pairing, supportsTokenOnly: true,
      });
      const [, body] = mockPost.mock.calls[0] ?? [];
      expect(Object.keys(body).sort()).toEqual(['publicKey', 'response']);
      expect(openTerminalProvisioningV3Response({
        payload: new Uint8Array(Buffer.from(body.response, 'base64')),
        recipientSecretKeyOrSeed: keypair.secretKey,
        terminalEphemeralPublicKey: keypair.publicKey,
        pairingSecret: secret,
        createdAtMs: pairing.createdAtMs,
        expiresAtMs: pairing.expiresAtMs,
        nowMs,
      })).toEqual(credentialType === 'legacy'
        ? { type: 'dataKey', key: deriveAccountMachineKeyFromRecoverySecret(recoverySecret) }
        : { type: 'tokenOnly' });
    });
  });
  it.each([1, 10_000])('approves a fresh terminal whose clock is %sms ahead without changing recipient validity checks', async (clockOffsetMs) => {
    const approverNowMs = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(approverNowMs);
    try {
      const { parseTerminalAuthApprovalRequest } = await import('./terminalAuthApproval');
      const keypair = tweetnacl.box.keyPair();
      const secret = new Uint8Array(32).fill(11);
      const pairing = {
        secretB64Url: Buffer.from(secret).toString('base64url'),
        createdAtMs: approverNowMs + clockOffsetMs,
        expiresAtMs: approverNowMs + clockOffsetMs + 60_000,
      };
      const packet = { publicKey: Buffer.from(keypair.publicKey).toString('base64'), pairing };
      const request = parseTerminalAuthApprovalRequest(packet);
      expect(request.pairing).toEqual(pairing);
      const context = { terminalEphemeralPublicKey: keypair.publicKey, pairingSecret: secret,
        createdAtMs: request.pairing!.createdAtMs, expiresAtMs: request.pairing!.expiresAtMs };
      const contentPrivateKey = new Uint8Array(32).fill(7);
      const payload = sealTerminalProvisioningV3Payload({ ...context, contentPrivateKey,
        randomBytes: (length) => new Uint8Array(length).fill(3) });
      const received = { ...context, payload, recipientSecretKeyOrSeed: keypair.secretKey };
      expect(openTerminalProvisioningV3Response({ ...received, nowMs: pairing.createdAtMs + 1 }))
        .toEqual({ type: 'dataKey', key: contentPrivateKey });
      expect(openTerminalProvisioningV3Response({ ...received, nowMs: pairing.createdAtMs - 1 })).toBeNull();
      expect(openTerminalProvisioningV3Response({ ...received, nowMs: pairing.expiresAtMs + 1 })).toBeNull();
      expect(openTerminalProvisioningV3Response({ ...received, createdAtMs: pairing.createdAtMs - 1,
        nowMs: pairing.createdAtMs + 1 })).toBeNull();
      expect(() => parseTerminalAuthApprovalRequest({ ...packet, pairing: { ...pairing, expiresAtMs: pairing.createdAtMs } }))
        .toThrow('Invalid authenticated');
      expect(() => parseTerminalAuthApprovalRequest({ ...packet, pairing: { ...pairing,
        createdAtMs: approverNowMs - 1, expiresAtMs: approverNowMs } })).toThrow('expired');
      expect(mockPost).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('normalizes private pending state and rejects malformed, expired and cross-relay request context without posting', async () => {
    const { parseTerminalAuthApprovalRequest } = await import('./terminalAuthApproval');
    const nowMs = Date.now();
    const pending = {
      publicKey: Buffer.alloc(32, 1).toString('base64'),
      secretKey: 'private-state-only', claimSecret: 'private-claim-only',
      pairingSecret: Buffer.alloc(32, 2).toString('base64url'),
      pairingCreatedAtMs: nowMs - 1000, pairingExpiresAtMs: nowMs + 60_000,
      supportsTokenOnly: true,
    };
    const request = parseTerminalAuthApprovalRequest(pending);
    expect(request).toEqual({ publicKey: pending.publicKey, supportsTokenOnly: true,
      pairing: { secretB64Url: pending.pairingSecret, createdAtMs: pending.pairingCreatedAtMs, expiresAtMs: pending.pairingExpiresAtMs } });
    expect(() => parseTerminalAuthApprovalRequest({ ...pending, pairingSecret: 'invalid' })).toThrow('Invalid authenticated');
    expect(() => parseTerminalAuthApprovalRequest({ ...pending, pairingExpiresAtMs: nowMs - 1 })).toThrow('expired');
    expect(() => parseTerminalAuthApprovalRequest({ ...pending, serverUrl: 'https://other-relay.invalid' }, ['https://api.happier.dev'])).toThrow('different relay');
    expect(() => parseTerminalAuthApprovalRequest({ publicKey: pending.publicKey, pairingRequirement: 'v3' })).toThrow('missing');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each(['encrypted-account', 'disabled-policy', 'missing-capability'] as const)('rejects token-only approval with %s before posting', async (scenario) => {
    await withTempDir('happier-cli-approval-policy-', async (homeDir) => {
      envScope.patch({ HAPPIER_HOME_DIR: homeDir, HAPPIER_SERVER_URL: 'https://api.happier.dev', HAPPIER_LOCAL_SERVER_URL: undefined, HAPPIER_PUBLIC_SERVER_URL: undefined, HAPPIER_ACTIVE_SERVER_ID: undefined });
      const config = await import('@/configuration'); config.reloadConfiguration();
      const persistence = await import('@/persistence'); await persistence.writeCredentialsTokenOnly({ token: 'local-token' });
      mockGet.mockResolvedValue({ status: 200, data: { mode: scenario === 'encrypted-account' ? 'e2ee' : 'plain', updatedAt: 1 } });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: { encryption: { plaintextStorage: { enabled: scenario !== 'disabled-policy' } }, e2ee: { keylessAccounts: { enabled: true } } }, capabilities: {} }), { status: 200 })));
      const { approveTerminalAuthRequest } = await import('./terminalAuthApproval');
      const nowMs = Date.now();
      await expect(approveTerminalAuthRequest({
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        pairing: { secretB64Url: Buffer.alloc(32, 2).toString('base64url'), createdAtMs: nowMs, expiresAtMs: nowMs + 60000 },
        supportsTokenOnly: scenario !== 'missing-capability',
      })).rejects.toThrow();
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

});
