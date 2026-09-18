import { describe, expect, it, vi } from 'vitest';

import { createDaemonTeamCredentialDirectMaterialOpen } from './teamCredentialDirectMaterialComposition';

const request = {
  teamId: 'team-1',
  resourceId: 'resource-1',
  expectedResourceRevision: 3,
  sourceMemberKey: 'provider:source-member',
  expectedSourceVersion: 'source-version:7',
} as const;

describe('daemon Team credential direct-material composition', () => {
  it('opens Session material with the exact Session consumer', async () => {
    const signal = new AbortController().signal;
    const clientOpen = vi.fn(async () => ({ ok: false as const, reason: 'preparing' as const }));
    const open = createDaemonTeamCredentialDirectMaterialOpen({
      clientOpen,
      workerMachineId: 'worker-1',
      signal,
    });

    await open({ ...request, consumer: { kind: 'session', sessionId: 'session-1' } });

    expect(clientOpen).toHaveBeenCalledWith({
      teamId: 'team-1',
      resourceId: 'resource-1',
      consumer: { kind: 'session', sessionId: 'session-1' },
      slot: { kind: 'provider_model' },
      sourceMemberKey: 'provider:source-member',
      signal,
    });
  });

  it('opens detached Execution Run material with the exact Run and actual worker Machine', async () => {
    const signal = new AbortController().signal;
    const clientOpen = vi.fn(async () => ({ ok: false as const, reason: 'preparing' as const }));
    const open = createDaemonTeamCredentialDirectMaterialOpen({
      clientOpen,
      workerMachineId: 'worker-1',
      signal,
    });

    await open({
      ...request,
      consumer: Object.assign(
        { kind: 'execution_run' as const, executionRunId: 'run-1' },
        { workerMachineId: 'forged-worker' },
      ),
    });

    expect(clientOpen).toHaveBeenCalledWith({
      teamId: 'team-1',
      resourceId: 'resource-1',
      consumer: {
        kind: 'execution_run',
        executionRunId: 'run-1',
        workerMachineId: 'worker-1',
      },
      slot: { kind: 'provider_model' },
      sourceMemberKey: 'provider:source-member',
      signal,
    });
  });
});
