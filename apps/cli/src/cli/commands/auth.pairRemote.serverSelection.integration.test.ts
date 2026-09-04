import { describe, expect, it, vi } from 'vitest';
import type { HappierJsonExecutor } from '@happier-dev/cli-common/systemTasks';

const { approveTerminalAuthRequest, writeJsonStdout } = vi.hoisted(() => ({
  approveTerminalAuthRequest: vi.fn(async () => undefined),
  writeJsonStdout: vi.fn(async () => undefined),
}));
vi.mock('@/auth/terminalAuthApproval', () => ({ approveTerminalAuthRequest }));
vi.mock('@/server/serverSelection', () => ({ applyServerSelectionFromArgs: async (args: string[]) => args }));
vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: vi.fn(async () => ({
    status: 'ready',
    features: { capabilities: { serverIdentity: { serverIdentityId: 'srv_pair_remote_home' } } },
  })),
}));
vi.mock('@/cli/output/jsonEnvelope', () => ({ writeJsonStdout }));

import { handleAuthPairRemote } from './auth/pairRemote';

const HOME_SERVER_IDENTITY_ID = 'srv_pair_remote_home';

describe('auth pair-remote released URL selection', () => {
  it('keeps released URL aliases as thin inputs to the single-process enrollment command', async () => {
    const seen: Array<Readonly<{ args: readonly string[]; input?: string }>> = [];
    const executor: HappierJsonExecutor = {
      runHappierText: async (args, options) => {
        seen.push({ args, ...(options?.input ? { input: options.input } : {}) });
        if (args[0] === 'doctor') {
          return { status: 0, stdout: JSON.stringify({ ok: true, kind: 'doctor_report' }), stderr: '' };
        }
        const now = Date.now();
        const stdout = [
          JSON.stringify({
            kind: 'remote_home_enrollment_pairing_request',
            protocolVersion: 1,
            publicKey: Buffer.alloc(32, 3).toString('base64'),
            homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
            pairing: {
              secretB64Url: Buffer.alloc(32, 4).toString('base64url'),
              createdAtMs: now,
              expiresAtMs: now + 60_000,
            },
            supportsTokenOnly: true,
            pairingRequirement: 'v3',
          }),
          JSON.stringify({
            kind: 'remote_home_enrollment_result',
            protocolVersion: 1,
            success: true,
            homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
            machineId: 'remote-machine',
            encryptionType: 'dataKey',
            pairingAuthentication: 'v3',
            remoteProfileId: 'remote-home-profile',
          }),
        ].join('\n') + '\n';
        options?.onStdoutChunk?.(stdout);
        return { status: 0, stdout, stderr: '' };
      },
      runHappierJson: async () => {
        throw new Error('split JSON command is not allowed');
      },
    };

    await handleAuthPairRemote([
      '--ssh',
      'user@host',
      '--json',
      '--remote-server-url',
      'https://relay.example.test',
      '--remote-local-server-url',
      'http://127.0.0.1:3010',
      '--remote-webapp-url',
      'https://app.example.test',
    ], {
      createEnrollmentExecutor: () => executor,
    });

    expect(seen[0]).toEqual({
      args: ['auth', 'enroll-remote', '--json-lines', '--home-target-stdin'],
      input: JSON.stringify({
        kind: 'https_url',
        url: 'https://relay.example.test',
        localUrl: 'http://127.0.0.1:3010',
        webappUrl: 'https://app.example.test',
      }),
    });
    expect(seen[1]?.args).toEqual([
      'doctor', 'repair', '--report-only', '--json', '--server', 'remote-home-profile',
    ]);
    expect(approveTerminalAuthRequest).toHaveBeenCalledWith(expect.objectContaining({
      supportsTokenOnly: true,
      target: expect.objectContaining({
        authority: 'manual_url',
        applicationUrl: 'https://relay.example.test',
      }),
    }));
    expect(JSON.stringify(seen)).not.toMatch(/auth.*(?:request|wait)|--persist|local-token/u);
    expect(writeJsonStdout).toHaveBeenCalledWith(expect.objectContaining({
      remoteServerId: 'remote-home-profile',
      postCheck: expect.objectContaining({
        ranWithServerId: 'remote-home-profile',
        exitCode: 0,
      }),
    }));
  });
});
