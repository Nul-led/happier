import type { ConnectedServiceAuthGroupV1 } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import { DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1 } from '../selection/selectConnectedServiceAuthGroupCandidate';
import {
  buildConnectedServiceAuthGroupSwitchState,
  mergePersistedMemberRuntimeState,
} from './buildConnectedServiceAuthGroupSwitchState';

describe('buildConnectedServiceAuthGroupSwitchState', () => {
  it('preserves the failure reset when a healthy snapshot reports the next quota window', () => {
    expect(mergePersistedMemberRuntimeState({
      providerResetsAtMs: 20_000,
      quotaSnapshot: {
        capturedAtMs: 11_000,
        effectiveRemainingPercent: 60,
      },
    }, {
      providerResetsAtMs: 10_000,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: 9_000,
    })).toMatchObject({
      providerResetsAtMs: 10_000,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: 9_000,
    });
  });

  it('preserves persisted limiter evidence used by candidate selection after restart', () => {
    const group: ConnectedServiceAuthGroupV1 = {
      v: 1,
      serviceId: 'openai-codex',
      groupId: 'main',
      displayName: null,
      policy: DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
      activeProfileId: 'primary',
      generation: 2,
      runtimeStateRevision: 0,
      state: {},
      createdAt: 1,
      updatedAt: 2,
      members: [
        {
          v: 1,
          serviceId: 'openai-codex',
          groupId: 'main',
          profileId: 'primary',
          priority: 1,
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
          state: {
            quotaExhaustedUntilMs: 10_000,
            rateLimitedUntilMs: null,
            lastFailureKind: 'usage_limit',
            lastObservedAtMs: 8_000,
            providerResetsAtMs: 12_000,
          },
        },
      ],
    };

    const state = buildConnectedServiceAuthGroupSwitchState({
      group,
      runtimeQuotaSnapshots: new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore(),
      nowMs: 9_000,
    });

    expect(state.memberStatesByProfileId.get('primary')).toMatchObject({
      quotaExhaustedUntilMs: 10_000,
      rateLimitedUntilMs: null,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: 8_000,
      providerResetsAtMs: 12_000,
    });
  });
});
