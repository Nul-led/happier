import { describe, expect, it } from 'vitest';
import { buildRecoveryCreditConsumeIdempotencyKey } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { StoredCredentials } from '@/persistence';
import { createCliConnectedServiceAction } from './connectedServiceActionDeps';

describe('native connected-service Action adapter', () => {
  it('reaches the selected Home machine reset owner with the same recovery-credit identity as the app and preserves a refusal', async () => {
    const credentials = { token: 'boundary-test-token', encryption: { type: 'legacy', secret: new Uint8Array(32) } } satisfies StoredCredentials;
    const observed: unknown[] = [];
    // Machine RPC is the external system boundary; request parsing and recovery-key ownership stay real.
    const action = createCliConnectedServiceAction({ credentials, serverId: 'home-work', serverHttpBaseUrl: 'https://work.invalid',
      resolveHeaders() { throw new Error('quota_reset_is_not_http'); },
      async callMachineAction(request) {
        observed.push(request);
        return { ok: false, errorCode: 'reset_unavailable', error: 'reset_unavailable' };
      },
    });
    const input = { machineId: 'machine-work', serviceId: 'openai-codex' as const, profileId: 'account-work', providerCreditId: 'credit-1', sourceSnapshotFetchedAtMs: 10 };
    expect(await action({ actionId: 'connectedServices.quota.reset', input, context: { surface: 'cli', authority: 'present_user', actionCaller: { kind: 'host' } } }))
      .toEqual({ ok: false, errorCode: 'reset_unavailable', error: 'reset_unavailable' });
    expect(observed).toEqual([{ machineId: 'machine-work', serverId: 'home-work', method: RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_RECOVERY_CREDIT_CONSUME, request: {
      serviceId: 'happier.agent.codex/openai-codex', profileId: input.profileId, providerCreditId: input.providerCreditId,
      idempotencyKey: buildRecoveryCreditConsumeIdempotencyKey(input),
    } }]);
  });
});
