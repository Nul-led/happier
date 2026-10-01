import type { CatalogAgentLookupId } from '@/agent/catalog/ids';
import type { AgentCatalogEntry } from '@/agent/catalog/types';
import type { ResolvedContributionRegistry } from '@/plugins/projection/registry/types';
import { tryAcquireAuthoritativePluginRuntimeRegistryLease } from '@/plugins/runtime/reload/runtimeLease';
import { pluginReloadController } from '@/plugins/runtime/reload/singleton';
import { ProviderProbeCancelledError } from '@/providers/probe/client';

type AgentPreflightCatalogContext = Readonly<{
  catalogEntry?: AgentCatalogEntry | null;
  runtimeCacheKey?: string;
  registrySnapshot?: ResolvedContributionRegistry;
  isCurrent: () => boolean;
}>;

/** Keeps RPC and local Action probes on one demanded Agent occurrence for their whole operation. */
export async function withAgentPreflightCatalog<T>(
  params: Readonly<{
    agentId: CatalogAgentLookupId;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
  }>,
  run: (context: AgentPreflightCatalogContext) => Promise<T>,
): Promise<T> {
  const lease = tryAcquireAuthoritativePluginRuntimeRegistryLease();
  try {
    // Standalone processes retain declaration-only behavior; never create a
    // second runtime authority just to enumerate a catalog.
    const catalogEntry = lease
      ? await lease.registry.acquireAgentCatalogEntry?.(params.agentId) ?? null
      : undefined;
    const pluginId = lease?.registry.contributes.agentDefinitionsById.get(params.agentId)?.identity?.pluginId;
    const runtimeCacheKey = pluginId ? lease?.registry.readPluginOccurrenceId?.(pluginId) ?? undefined : undefined;
    const isCurrent = () => params.signal?.aborted !== true
      && (params.isCurrent?.() ?? true)
      && (!lease || pluginReloadController.isRuntimeRegistryCurrent(lease.registry));
    if (!isCurrent()) throw new ProviderProbeCancelledError();
    const result = await run({
      ...(lease ? { catalogEntry, runtimeCacheKey, registrySnapshot: lease.registry.contributes } : {}),
      isCurrent,
    });
    if (!isCurrent()) throw new ProviderProbeCancelledError();
    return result;
  } finally {
    await lease?.release();
  }
}
