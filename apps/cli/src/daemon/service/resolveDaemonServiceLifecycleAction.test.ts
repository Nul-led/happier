import { describe, expect, it } from 'vitest';

import type { CurrentDaemonOwner, DaemonOwnerEvaluation } from '@/daemon/ownership/evaluateCurrentDaemonOwner';

import { resolveDaemonServiceLifecycleAction } from './resolveDaemonServiceLifecycleAction';

const SERVICE_LABEL = 'happier-daemon.default';

function owner(params: Readonly<{ serviceManaged: boolean | null; serviceLabel: string }>): CurrentDaemonOwner {
  return {
    status: 'running',
    source: 'state',
    state: {
      pid: 4242,
      httpPort: 43137,
      startedAt: 1,
      startedWithCliVersion: '0.3.0',
      serviceLabel: params.serviceLabel,
    },
    currentCliVersion: '0.3.1',
    currentPublicReleaseChannel: 'stable',
    versionMatches: false,
    releaseChannelMatches: true,
    serviceManaged: params.serviceManaged,
    startupSource: params.serviceManaged ? 'background-service' : 'manual',
  };
}

function start(ownership: DaemonOwnerEvaluation) {
  return resolveDaemonServiceLifecycleAction({
    action: 'start',
    ownership,
    expectedServiceLabel: SERVICE_LABEL,
    refreshedInstalledServiceDefinition: false,
    runningDefaultFollowingServiceNeedsRelayRestart: false,
  });
}

describe('resolveDaemonServiceLifecycleAction', () => {
  it('restarts on start when this service is running an old CLI version (a plain start is a no-op on an active unit)', () => {
    expect(start({ kind: 'conflict', owner: owner({ serviceManaged: true, serviceLabel: SERVICE_LABEL }) })).toBe('restart');
  });

  it('keeps start when the running daemon is this service at the current version', () => {
    expect(start({ kind: 'compatible', owner: owner({ serviceManaged: true, serviceLabel: SERVICE_LABEL }) })).toBe('start');
  });

  it('keeps start when the stale daemon belongs to another service or was started manually', () => {
    expect(start({ kind: 'conflict', owner: owner({ serviceManaged: true, serviceLabel: 'happier-daemon.other' }) })).toBe('start');
    expect(start({ kind: 'conflict', owner: owner({ serviceManaged: false, serviceLabel: SERVICE_LABEL }) })).toBe('start');
    expect(start({ kind: 'none' })).toBe('start');
  });

  it('never changes stop or restart', () => {
    const ownership: DaemonOwnerEvaluation = { kind: 'conflict', owner: owner({ serviceManaged: true, serviceLabel: SERVICE_LABEL }) };
    for (const action of ['stop', 'restart'] as const) {
      expect(resolveDaemonServiceLifecycleAction({
        action,
        ownership,
        expectedServiceLabel: SERVICE_LABEL,
        refreshedInstalledServiceDefinition: false,
        runningDefaultFollowingServiceNeedsRelayRestart: false,
      })).toBe(action);
    }
  });
});
