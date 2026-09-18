import { describe, expect, it } from 'vitest';
import { readBackendTargetRefV2 } from '@happier-dev/protocol';

import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';
import type { ExecutionRunState } from './executionRunTypes';
import { resolveExecutionRunLifecycle } from './resolveExecutionRunLifecycle';

function run(overrides: Partial<ExecutionRunState> = {}): ExecutionRunState {
  return {
    runId: 'run-1',
    callId: 'call-1',
    sidechainId: 'sidechain-1',
    sessionId: null,
    depth: 0,
    intent: 'agent',
    backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
    backendId: 'codex',
    instructions: 'Work.',
    permissionMode: 'read_only',
    retentionPolicy: 'resumable',
    runClass: 'bounded',
    ioMode: 'request_response',
    status: 'succeeded',
    startedAtMs: 1,
    finishedAtMs: 2,
    resumeHandle: {
      kind: 'provider_session.v1',
      backendTarget: readBackendTargetRefV2({ kind: 'builtInAgent', agentId: 'codex' }),
      providerSessionId: 'provider-session-1',
    },
    ...overrides,
  };
}

describe('resolveExecutionRunLifecycle', () => {
  it('distinguishes a current controller from controller-less recovery', () => {
    const controller = { kind: 'backend', cancelled: false } as never as ExecutionRunController;
    expect(resolveExecutionRunLifecycle(run({ status: 'running' }), controller).projection)
      .toEqual({ v: 1, state: 'current' });
    expect(resolveExecutionRunLifecycle(run(), null).projection)
      .toEqual({ v: 1, state: 'recoverable_with_input' });
  });

  it('allows open-only recovery only for long-lived runs', () => {
    expect(resolveExecutionRunLifecycle(run({ runClass: 'long_lived' }), null).projection)
      .toEqual({ v: 1, state: 'recoverable' });
  });

  it('fails closed when retention or the exact backend-bound handle cannot prove recovery', () => {
    expect(resolveExecutionRunLifecycle(run({ retentionPolicy: 'ephemeral' }), null))
      .toMatchObject({ projection: { v: 1, state: 'unavailable' }, unavailableReason: 'not_resumable' });
    expect(resolveExecutionRunLifecycle(run({
      resumeHandle: {
        kind: 'provider_session.v1',
        backendTarget: readBackendTargetRefV2({ kind: 'builtInAgent', agentId: 'claude' }),
        providerSessionId: 'provider-session-1',
      },
    }), null)).toMatchObject({
      projection: { v: 1, state: 'unavailable' },
      unavailableReason: 'missing_resume_handle',
    });
  });
});
