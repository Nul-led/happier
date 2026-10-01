import type { ResolvedContributionRegistry } from '@/plugins/projection/registry/types';

import type { ProviderContributionRegistryView } from './types';

export function resolveProviderContributionRegistryView(
  registry: Pick<ResolvedContributionRegistry, 'providersByContributionKey'>,
  runtimeRegistryGeneration: number,
  readPluginOccurrenceId?: (pluginId: string) => string | null,
): ProviderContributionRegistryView {
  if (!registry.providersByContributionKey) {
    throw new Error('Resolved contribution registry is missing its provider contribution index');
  }
  const providerActivationOccurrenceIdsByPluginId = readPluginOccurrenceId
    ? new Map([...new Set(
        [...registry.providersByContributionKey.values()].map((provider) => provider.pluginId),
      )].flatMap((pluginId) => {
        const occurrenceId = readPluginOccurrenceId(pluginId);
        return occurrenceId ? [[pluginId, occurrenceId] as const] : [];
      }))
    : undefined;
  return {
    providersByContributionKey: registry.providersByContributionKey,
    runtimeRegistryGeneration,
    ...(providerActivationOccurrenceIdsByPluginId
      ? { providerActivationOccurrenceIdsByPluginId }
      : {}),
  };
}
