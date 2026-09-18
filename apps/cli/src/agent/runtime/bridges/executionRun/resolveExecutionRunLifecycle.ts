import {
  convertBackendTargetRefV2ToV1,
  type ExecutionRunLifecycleV1,
} from '@happier-dev/protocol';

import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';
import { areExecutionRunBackendTargetsEqual } from './backendTargets';
import type { ExecutionRunState } from './executionRunTypes';

export type ResolvedExecutionRunLifecycle = Readonly<{
  projection: ExecutionRunLifecycleV1;
  unavailableReason?: 'not_resumable' | 'unsupported' | 'missing_resume_handle';
}>;

/** One host owner for current-controller and exact resume-handle lifecycle truth. */
export function resolveExecutionRunLifecycle(
  run: ExecutionRunState,
  controller: ExecutionRunController | null,
): ResolvedExecutionRunLifecycle {
  if (controller && run.status === 'running' && !controller.cancelled) {
    return { projection: { v: 1, state: 'current' } };
  }
  if (controller) {
    return { projection: { v: 1, state: 'recovering' } };
  }
  if (run.retentionPolicy !== 'resumable') {
    return {
      projection: { v: 1, state: 'unavailable' },
      unavailableReason: 'not_resumable',
    };
  }

  const resumeHandle = run.resumeHandle;
  const targetMatches = Boolean(
    resumeHandle
    && areExecutionRunBackendTargetsEqual(
      convertBackendTargetRefV2ToV1(resumeHandle.backendTarget),
      run.backendTarget,
    ),
  );

  if (run.intent === 'voice_agent') {
    if (run.ioMode !== 'streaming' || !run.voiceAgentConfig) {
      return {
        projection: { v: 1, state: 'unavailable' },
        unavailableReason: 'unsupported',
      };
    }
    if (
      !targetMatches
      || (resumeHandle?.kind !== 'provider_session.v1' && resumeHandle?.kind !== 'voice_agent_sessions.v1')
    ) {
      return {
        projection: { v: 1, state: 'unavailable' },
        unavailableReason: 'missing_resume_handle',
      };
    }
    return { projection: { v: 1, state: 'recoverable' } };
  }

  if (!targetMatches || resumeHandle?.kind !== 'provider_session.v1') {
    return {
      projection: { v: 1, state: 'unavailable' },
      unavailableReason: 'missing_resume_handle',
    };
  }
  return {
    projection: {
      v: 1,
      state: run.runClass === 'bounded' ? 'recoverable_with_input' : 'recoverable',
    },
  };
}
