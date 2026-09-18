import { describe, expect, it, vi } from 'vitest';
import { resolveHomeTargetFromDescriptor } from '@happier-dev/cli-common/homeTarget';
import type { HappierJsonExecutor } from '@happier-dev/cli-common/systemTasks';
import type { approveTerminalAuthRequest as approveTerminalAuthRequestType } from '@/auth/terminalAuthApproval';

const { approveTerminalAuthRequest, writeJsonStdout } = vi.hoisted(() => ({
  approveTerminalAuthRequest: vi.fn<typeof approveTerminalAuthRequestType>(async () => undefined),
  writeJsonStdout: vi.fn(async () => undefined),
}));
vi.mock('@/auth/terminalAuthApproval', () => ({ approveTerminalAuthRequest }));
vi.mock('@/server/serverSelection', () => ({ applyServerSelectionFromArgs: async (args: string[]) => args }));
vi.mock('@/cli/output/jsonEnvelope', () => ({ writeJsonStdout }));

import { handleAuthPairRemote } from './auth/pairRemote';

const HOME_SERVER_IDENTITY_ID = 'srv_pair_remote_home';
const OTHER_HOME_SERVER_IDENTITY_ID = 'srv_pair_remote_other';
const PAIRING_SECRET = Buffer.alloc(32, 7).toString('base64url');

function createSavedIrohTarget() {
  return resolveHomeTargetFromDescriptor({
    descriptor: {
      v: 1,
      homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
      canonicalServerUrl: 'http://127.0.0.1:3010',
      revision: 1,
      endpoints: [{ kind: 'iroh', endpointId: 'e'.repeat(64) }],
    },
    authority: 'saved_profile',
    profile: {
      id: 'personal-home',
      serverUrl: 'http://127.0.0.1:3010',
      webappUrl: 'https://app.happier.dev',
    },
  });
}

function createStreamingExecutor(params: Readonly<{
  requestIdentity: string;
  seen: Array<Readonly<{ args: readonly string[]; input?: string }>>;
}>): HappierJsonExecutor {
  return {
    runHappierText: async (args, options) => {
      params.seen.push({ args, ...(options?.input ? { input: options.input } : {}) });
      const now = Date.now();
      const stdout = [
        JSON.stringify({
          kind: 'remote_home_enrollment_pairing_request',
          protocolVersion: 1,
          publicKey: Buffer.alloc(32, 6).toString('base64'),
          homeServerIdentityId: params.requestIdentity,
          pairing: {
            secretB64Url: PAIRING_SECRET,
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
          homeServerIdentityId: params.requestIdentity,
          machineId: 'remote-machine',
          encryptionType: 'tokenOnly',
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
}

describe('auth pair-remote canonical SSH enrollment', () => {
  it('keeps saved-profile/Iroh pairing auth-only and uses one streaming command', async () => {
    approveTerminalAuthRequest.mockClear();
    const target = createSavedIrohTarget();
    const seen: Array<Readonly<{ args: readonly string[]; input?: string }>> = [];

    await handleAuthPairRemote(['--ssh', 'user@host', '--json', '--no-post-check'], {
      resolveHomeTarget: async () => target,
      createEnrollmentExecutor: () => createStreamingExecutor({
        requestIdentity: HOME_SERVER_IDENTITY_ID,
        seen,
      }),
    });

    expect(seen).toEqual([expect.objectContaining({
      args: ['auth', 'enroll-remote', '--json-lines', '--home-target-stdin'],
    })]);
    expect(seen[0]?.input).toContain(HOME_SERVER_IDENTITY_ID);
    expect(JSON.stringify(seen)).not.toMatch(/auth.*(?:request|wait)|--persist|doctor|service/u);
    expect(approveTerminalAuthRequest).toHaveBeenCalledWith(expect.objectContaining({ target }));
    expect(approveTerminalAuthRequest.mock.calls.at(-1)?.[0]).not.toHaveProperty('authorizeUnattendedTeamAccess');
    expect(writeJsonStdout).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
      machineId: 'remote-machine',
    }));
    const jsonCalls = writeJsonStdout.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(jsonCalls.at(-1)?.[0]).not.toHaveProperty('postCheck');
    expect(JSON.stringify(writeJsonStdout.mock.calls)).not.toMatch(/token|claimSecret|secretKey/u);
  });

  it('delegates restricted-Team evidence only when the operator selects the explicit flag', async () => {
    approveTerminalAuthRequest.mockClear();
    const target = createSavedIrohTarget();

    await handleAuthPairRemote([
      '--ssh', 'user@host', '--json', '--no-post-check', '--authorize-unattended-team-access',
    ], {
      resolveHomeTarget: async () => target,
      createEnrollmentExecutor: () => createStreamingExecutor({
        requestIdentity: HOME_SERVER_IDENTITY_ID,
        seen: [],
      }),
    });

    expect(approveTerminalAuthRequest).toHaveBeenCalledWith(expect.objectContaining({
      target,
      authorizeUnattendedTeamAccess: true,
    }));
  });

  it('rejects a different Home identity before approval without reflecting pairing material', async () => {
    approveTerminalAuthRequest.mockClear();
    const target = createSavedIrohTarget();
    const seen: Array<Readonly<{ args: readonly string[]; input?: string }>> = [];
    let captured: unknown;

    try {
      await handleAuthPairRemote(['--ssh', 'user@host', '--json'], {
        resolveHomeTarget: async () => target,
        createEnrollmentExecutor: () => createStreamingExecutor({
          requestIdentity: OTHER_HOME_SERVER_IDENTITY_ID,
          seen,
        }),
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(Error);
    expect(String((captured as Error).message)).toContain('selected Home');
    expect(String((captured as Error).message)).not.toContain(PAIRING_SECRET);
    expect(approveTerminalAuthRequest).not.toHaveBeenCalled();
  });
});
