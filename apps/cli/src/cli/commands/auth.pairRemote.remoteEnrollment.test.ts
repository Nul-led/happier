import { describe, expect, it, vi } from 'vitest';
import { resolveHomeTargetFromDescriptor } from '@happier-dev/cli-common/homeTarget';
import type { HappierJsonExecutor } from '@happier-dev/cli-common/systemTasks';

const { approveTerminalAuthRequest } = vi.hoisted(() => ({
  approveTerminalAuthRequest: vi.fn(async () => undefined),
}));
vi.mock('@/auth/terminalAuthApproval', () => ({ approveTerminalAuthRequest }));
vi.mock('@/server/serverSelection', () => ({ applyServerSelectionFromArgs: async (args: string[]) => args }));
vi.mock('@/cli/output/jsonEnvelope', () => ({ writeJsonStdout: vi.fn(async () => undefined) }));

import { handleAuthPairRemote } from './auth/pairRemote';

describe('auth pair-remote Home enrollment', () => {
  it('pairs an Iroh-only Home through one streaming command and returns no bearer', async () => {
    const target = resolveHomeTargetFromDescriptor({
      descriptor: {
        v: 1,
        homeServerIdentityId: 'srv_pair_remote_iroh',
        canonicalServerUrl: 'http://localhost:3010',
        revision: 1,
        endpoints: [{ kind: 'iroh', endpointId: 'd'.repeat(64) }],
      },
      authority: 'trusted_enrollment',
    });
    const seen: Array<{ args: readonly string[]; input?: string }> = [];
    const executor: HappierJsonExecutor = {
      runHappierJson: async () => { throw new Error('split JSON command not allowed'); },
      runHappierText: async (args, options) => {
        seen.push({ args, input: options?.input });
        const request = JSON.stringify({
          kind: 'remote_home_enrollment_pairing_request', protocolVersion: 1,
          publicKey: Buffer.alloc(32, 1).toString('base64'),
          homeServerIdentityId: target.homeServerIdentityId,
          pairing: {
            secretB64Url: Buffer.alloc(32, 2).toString('base64url'),
            createdAtMs: Date.now(), expiresAtMs: Date.now() + 60_000,
          },
          supportsTokenOnly: true, pairingRequirement: 'v3',
        });
        const result = JSON.stringify({
          kind: 'remote_home_enrollment_result', protocolVersion: 1, success: true,
          homeServerIdentityId: target.homeServerIdentityId, machineId: 'machine-remote',
          encryptionType: 'tokenOnly', pairingAuthentication: 'v3', remoteProfileId: 'remote-home-profile',
        });
        options?.onStdoutChunk?.(`${request}\n${result}\n`);
        return { status: 0, stdout: `${request}\n${result}\n`, stderr: '' };
      },
    };

    await handleAuthPairRemote(['--ssh', 'user@host', '--home-descriptor-file', '-', '--json', '--no-post-check'], {
      resolveHomeTarget: async () => target,
      parseHomeTargetArgs: async (args) => ({
        target: { kind: 'descriptor', descriptor: target.descriptor!, authority: 'trusted_enrollment' },
        source: '--home-descriptor-file',
        rest: args.filter((entry) => entry !== '--home-descriptor-file' && entry !== '-'),
      }),
      createEnrollmentExecutor: () => executor,
    });

    expect(seen).toEqual([expect.objectContaining({
      args: ['auth', 'enroll-remote', '--json-lines', '--home-target-stdin'],
    })]);
    expect(seen[0]?.input).toContain('srv_pair_remote_iroh');
    expect(approveTerminalAuthRequest).toHaveBeenCalledWith(expect.objectContaining({ target }));
    expect(JSON.stringify(seen)).not.toContain('access-token');
  });
});
