import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tweetnacl from 'tweetnacl';
import {
  openTerminalProvisioningV3Response,
  resolveTerminalProvisioningVariantV2,
} from '@happier-dev/protocol';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';

const { mockPost } = vi.hoisted(() => ({
  mockPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mockPost,
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
      const machineKey = new Uint8Array(32).fill(2);
      writeFileSync(
        join(serversDir, 'access.key'),
        JSON.stringify(
          {
            token: 'token-1',
            encryption: {
              publicKey: Buffer.from(tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey).toString('base64'),
              machineKey: Buffer.from(machineKey).toString('base64'),
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
      await approval.approveTerminalAuthRequest({
        publicKey: terminalPublicKey,
        pairing: {
          secretB64Url: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
          createdAtMs: Date.now() - 60_000,
          expiresAtMs: Date.now() + 3_600_000,
        },
        supportsTokenOnly: true,
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url] = mockPost.mock.calls[0] ?? [];
      expect(url).toBe('http://127.0.0.1:53288/v1/auth/response');
    });
  });

  it('fails closed with a typed error when no pairing context is present (token-only credentials)', async () => {
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
        name: 'TerminalPairingContextRequiredError',
        code: 'TERMINAL_PAIRING_CONTEXT_REQUIRED',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  function decodePostedResponse(): Uint8Array {
    expect(mockPost).toHaveBeenCalledTimes(1);
    const body = mockPost.mock.calls[0]?.[1] as { response?: unknown } | undefined;
    expect(typeof body?.response).toBe('string');
    return new Uint8Array(Buffer.from(String(body?.response), 'base64'));
  }

  it('seals an authenticated v3 token-only response for token-only credentials when the requester supports token-only', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-token-only-v3-', async (homeDir) => {
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

      mockPost.mockResolvedValueOnce({ status: 200, data: {} });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      const pairingSecret = new Uint8Array(32).fill(11);
      const createdAtMs = Date.now() - 60_000;
      const expiresAtMs = Date.now() + 3_600_000;
      await approval.approveTerminalAuthRequest({
        publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
        pairing: {
          secretB64Url: Buffer.from(pairingSecret).toString('base64url'),
          createdAtMs,
          expiresAtMs,
        },
        supportsTokenOnly: true,
      });

      const opened = openTerminalProvisioningV3Response({
        payload: decodePostedResponse(),
        recipientSecretKeyOrSeed: terminalKeypair.secretKey,
        terminalEphemeralPublicKey: terminalKeypair.publicKey,
        pairingSecret,
        createdAtMs,
        expiresAtMs,
        nowMs: Date.now(),
      });
      expect(opened).toEqual({ type: 'tokenOnly' });
    });
  });

  it('requires the requester token-only capability before provisioning token-only material', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-token-only-capability-', async (homeDir) => {
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
      const terminalKeypair = tweetnacl.box.keyPair();
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing: {
            secretB64Url: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
            createdAtMs: Date.now() - 60_000,
            expiresAtMs: Date.now() + 3_600_000,
          },
        }),
      ).rejects.toMatchObject({
        name: 'TokenOnlyTerminalApprovalUpgradeRequiredError',
        code: 'TOKEN_ONLY_TERMINAL_APPROVAL_UPGRADE_REQUIRED',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('seals an authenticated v3 data-key response when the approver holds data-key material and pairing context', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-data-key-v3-', async (homeDir) => {
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
      const machineKey = new Uint8Array(32).fill(7);
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsDataKey({
        publicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey,
        machineKey,
        token: 'token-1',
      });

      mockPost.mockResolvedValueOnce({ status: 200, data: {} });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      const pairingSecret = new Uint8Array(32).fill(11);
      const createdAtMs = Date.now() - 60_000;
      const expiresAtMs = Date.now() + 3_600_000;
      await approval.approveTerminalAuthRequest({
        publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
        pairing: {
          secretB64Url: Buffer.from(pairingSecret).toString('base64url'),
          createdAtMs,
          expiresAtMs,
        },
        supportsTokenOnly: true,
      });

      const opened = openTerminalProvisioningV3Response({
        payload: decodePostedResponse(),
        recipientSecretKeyOrSeed: terminalKeypair.secretKey,
        terminalEphemeralPublicKey: terminalKeypair.publicKey,
        pairingSecret,
        createdAtMs,
        expiresAtMs,
        nowMs: Date.now(),
      });
      expect(opened).toEqual({ type: 'dataKey', key: machineKey });
    });
  });

  it('fails closed with a typed error for keyed credentials when the requester sends no pairing context', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-keyed-no-context-', async (homeDir) => {
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
      const machineKey = new Uint8Array(32).fill(7);
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsDataKey({
        publicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey,
        machineKey,
        token: 'token-1',
      });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
        }),
      ).rejects.toMatchObject({
        name: 'TerminalPairingContextRequiredError',
        code: 'TERMINAL_PAIRING_CONTEXT_REQUIRED',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('fails closed with a typed error for legacy recovery-secret credentials instead of issuing derived material', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-legacy-unavailable-', async (homeDir) => {
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
      await persistence.writeCredentialsLegacy({
        secret: new Uint8Array(32).fill(9),
        token: 'token-1',
      });

      mockPost.mockResolvedValueOnce({ status: 200, data: {} });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing: {
            secretB64Url: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
            createdAtMs: Date.now() - 60_000,
            expiresAtMs: Date.now() + 3_600_000,
          },
          supportsTokenOnly: true,
        }),
      ).rejects.toMatchObject({
        name: 'LegacyTerminalProvisioningUnavailableError',
        code: 'LEGACY_TERMINAL_PROVISIONING_UNAVAILABLE',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('fails closed when stored data-key material fails public-key consistency validation', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-material-invalid-', async (homeDir) => {
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
      const machineKey = new Uint8Array(32).fill(7);
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsDataKey({
        // Deliberately unrelated public key: must not match the machine key.
        publicKey: tweetnacl.box.keyPair().publicKey,
        machineKey,
        token: 'token-1',
      });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing: {
            secretB64Url: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
            createdAtMs: Date.now() - 60_000,
            expiresAtMs: Date.now() + 3_600_000,
          },
        }),
      ).rejects.toMatchObject({
        name: 'TerminalProvisioningMaterialInvalidError',
        code: 'TERMINAL_PROVISIONING_MATERIAL_INVALID',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('fails closed with a typed error for an expired pairing context without posting', async () => {
    await withTempDir('happier-cli-terminal-auth-approval-expired-context-', async (homeDir) => {
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
      const machineKey = new Uint8Array(32).fill(7);
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsDataKey({
        publicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey,
        machineKey,
        token: 'token-1',
      });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing: {
            secretB64Url: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
            createdAtMs: 1_000,
            expiresAtMs: 2_000,
          },
        }),
      ).rejects.toMatchObject({
        name: 'TerminalPairingContextExpiredError',
        code: 'TERMINAL_PAIRING_CONTEXT_EXPIRED',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['wrong secret length', Buffer.alloc(16).toString('base64url'), false],
    ['noncanonical secret encoding', `${Buffer.alloc(32, 11).toString('base64url')}=`, false],
    ['unknown field', Buffer.alloc(32, 11).toString('base64url'), true],
  ])('fails closed with a typed error for a malformed pairing context (%s) without posting', async (_case, secretB64Url, includeUnknownField) => {
    await withTempDir('happier-cli-terminal-auth-approval-malformed-context-', async (homeDir) => {
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
      const machineKey = new Uint8Array(32).fill(7);
      const persistence = await import('@/persistence');
      await persistence.writeCredentialsDataKey({
        publicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey,
        machineKey,
        token: 'token-1',
      });

      const approval = await import('./terminalAuthApproval');
      const terminalKeypair = tweetnacl.box.keyPair();
      const pairing = {
        secretB64Url,
        createdAtMs: Date.now() - 60_000,
        expiresAtMs: Date.now() + 3_600_000,
        ...(includeUnknownField ? { smuggled: true } : {}),
      };
      await expect(
        approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing,
        }),
      ).rejects.toMatchObject({
        name: 'TerminalPairingContextInvalidError',
        code: 'TERMINAL_PAIRING_CONTEXT_INVALID',
      });
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  it('material decisions follow the canonical protocol resolver for every persisted credential shape', async () => {
    const terminalKeypair = tweetnacl.box.keyPair();
    const pairingSecret = new Uint8Array(32).fill(11);
    const pairing = {
      secretB64Url: Buffer.from(pairingSecret).toString('base64url'),
      createdAtMs: Date.now() - 60_000,
      expiresAtMs: Date.now() + 3_600_000,
    };

    const shapeSetups: Array<{
      label: string;
      persist: (persistence: typeof import('@/persistence')) => Promise<void>;
      // Authoritative persisted credential shape inputs for the resolver.
      encryption: null | { type: 'legacy' } | { type: 'dataKey'; machineKey: Uint8Array };
    }> = [
      {
        label: 'token-only',
        persist: (persistence) => persistence.writeCredentialsTokenOnly({ token: 'token-only-1' }),
        encryption: null,
      },
      {
        label: 'data-key',
        persist: async (persistence) => {
          const machineKey = new Uint8Array(32).fill(7);
          await persistence.writeCredentialsDataKey({
            publicKey: tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey,
            machineKey,
            token: 'token-1',
          });
        },
        encryption: { type: 'dataKey', machineKey: new Uint8Array(32).fill(7) },
      },
      {
        label: 'legacy-secret',
        persist: (persistence) =>
          persistence.writeCredentialsLegacy({ secret: new Uint8Array(32).fill(9), token: 'token-1' }),
        encryption: { type: 'legacy' },
      },
    ];

    for (const setup of shapeSetups) {
      await withTempDir(`happier-cli-terminal-auth-approval-resolver-${setup.label}-`, async (homeDir) => {
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
        await setup.persist(persistence);

        // The canonical owner decides the variant from the authoritative
        // persisted credential shape; the CLI must not re-derive it.
        const expectedVariant = resolveTerminalProvisioningVariantV2({
          encryptionMode: setup.encryption ? 'e2ee' : 'plain',
          dataKeyMaterialAvailable: setup.encryption?.type === 'dataKey',
        });

        mockPost.mockResolvedValueOnce({ status: 200, data: {} });
        const approval = await import('./terminalAuthApproval');
        const result = await approval.approveTerminalAuthRequest({
          publicKey: Buffer.from(terminalKeypair.publicKey).toString('base64'),
          pairing,
          supportsTokenOnly: true,
        }).then(
          () => ({ posted: true }),
          (error: unknown) => ({ posted: false, error }),
        );

        if (expectedVariant === 'legacyProvisioningUnavailable') {
          expect(result).toMatchObject({ posted: false });
          expect((result as { error: { code: string } }).error.code).toBe(
            'LEGACY_TERMINAL_PROVISIONING_UNAVAILABLE',
          );
          expect(mockPost).not.toHaveBeenCalled();
        } else {
          expect(result).toEqual({ posted: true });
          const body = mockPost.mock.calls[0]?.[1] as { response?: string; responseKind?: string } | undefined;
          expect(body?.responseKind).toBe(expectedVariant);
          const opened = openTerminalProvisioningV3Response({
            payload: new Uint8Array(Buffer.from(String(body?.response), 'base64')),
            recipientSecretKeyOrSeed: terminalKeypair.secretKey,
            terminalEphemeralPublicKey: terminalKeypair.publicKey,
            pairingSecret,
            createdAtMs: pairing.createdAtMs,
            expiresAtMs: pairing.expiresAtMs,
            nowMs: Date.now(),
          });
          expect(opened).toEqual(
            expectedVariant === 'tokenOnly'
              ? { type: 'tokenOnly' }
              : { type: 'dataKey', key: (setup.encryption as { machineKey: Uint8Array }).machineKey },
          );
        }
        mockPost.mockReset();
        vi.resetModules();
      });
    }
  });
});
