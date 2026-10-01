import { describe, expect, it } from 'vitest';

import { buildTrackedSessionFromMarker } from './trackedSessionFromMarker';
import type { DaemonSessionMarker } from '../sessionRegistry';

describe('buildTrackedSessionFromMarker', () => {
  it('restores the non-secret invocation context for an exact daemon runner marker', () => {
    const marker = {
      pid: 123,
      happySessionId: 'session-1',
      happyHomeDir: '/tmp/happier',
      createdAt: 1,
      updatedAt: 1,
      startedBy: 'daemon',
      cwd: '/tmp/project',
      agentRuntimeDaemonServiceAuthorityFilePath: '/tmp/happier/authority.json',
    } satisfies DaemonSessionMarker;

    expect(buildTrackedSessionFromMarker({
      marker,
      startedByFallback: 'reattached',
      reattachedFromDiskMarker: true,
    }).runnerAgentInvocationContext).toEqual({
      cwd: '/tmp/project',
      environment: {},
      providerBindingActive: false,
    });
  });
});
