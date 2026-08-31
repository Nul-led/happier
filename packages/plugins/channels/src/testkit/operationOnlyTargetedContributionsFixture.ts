import type {
  TargetedContributionPointRef,
  TargetedContributionSnapshot,
  TargetedContributionsService,
} from '@happier-dev/plugin-sdk';
import type { PluginTestkit } from '@happier-dev/plugin-sdk/testing';

import { CHANNELS_PROVIDER_POINT_REF } from '../manifest.js';

/**
 * Explicit adapter for Channels V1's descriptor-free, Surface-free provider
 * protocol. The public testkit deliberately does not install this as a normal
 * service: production cold admission remains covered by the CLI owner, while
 * these operation-composition tests consume only the structural operation
 * handles the testkit can honestly issue.
 */
export function channelsOperationOnlyTargetedContributionsFixture(
  target: PluginTestkit,
): TargetedContributionsService {
  return Object.freeze({
    observeForSelf<TContribution>(
      point: TargetedContributionPointRef<TContribution>,
      _options: Readonly<{ onInvalidated: () => void }>,
    ) {
      if (point.targetPluginId !== CHANNELS_PROVIDER_POINT_REF.targetPluginId
        || point.id !== CHANNELS_PROVIDER_POINT_REF.id
        || point.protocol.id !== CHANNELS_PROVIDER_POINT_REF.protocol.id
        || point.protocol.version !== CHANNELS_PROVIDER_POINT_REF.protocol.version) {
        throw new TypeError('The Channels structural fixture only supports its V1 provider point.');
      }
      return Object.freeze({
        dispose() {},
        async readCurrent(options?: Readonly<{ signal?: AbortSignal }>) {
          options?.signal?.throwIfAborted();
          const snapshot = target.readTargetedContributionFixture(CHANNELS_PROVIDER_POINT_REF);
          options?.signal?.throwIfAborted();
          // Channels V1 has no descriptor or Surface roles, so this structural
          // entry is its complete admitted contribution shape for these tests.
          return snapshot as unknown as TargetedContributionSnapshot<TContribution>;
        },
      });
    },
  });
}

export function channelsTargetedContributionServices(
  target: PluginTestkit,
): Readonly<{ targetedContributions: TargetedContributionsService }> {
  return Object.freeze({
    targetedContributions: channelsOperationOnlyTargetedContributionsFixture(target),
  });
}
