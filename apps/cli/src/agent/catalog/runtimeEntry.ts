import { AGENTS } from './registry';
import type { AgentCatalogEntry, CatalogAgentId } from './types';

async function acquireCurrentCatalogEntry(
  agentId: CatalogAgentId,
): Promise<Readonly<{
  entry: AgentCatalogEntry | null;
  release(): Promise<void>;
}>> {
  const { acquireAuthoritativePluginRuntimeRegistryLease } = await import(
    '@/plugins/runtime/reload/runtimeLease'
  );
  let lease: Awaited<ReturnType<typeof acquireAuthoritativePluginRuntimeRegistryLease>>;
  try {
    lease = await acquireAuthoritativePluginRuntimeRegistryLease();
  } catch (error) {
    if (
      error instanceof Error
      && Reflect.get(error, 'code') === 'PLUGIN_DAEMON_RUNTIME_UNAVAILABLE'
    ) {
      return Object.freeze({ entry: AGENTS[agentId] ?? null, release: async () => {} });
    }
    throw error;
  }
  try {
    const entry = lease.registry.acquireAgentCatalogEntry
      ? await lease.registry.acquireAgentCatalogEntry(agentId)
      : lease.registry.contributes.agents.find((agent) => agent.id === agentId)?.catalogEntry ?? null;
    return Object.freeze({ entry, release: lease.release });
  } catch (error) {
    await lease.release().catch(() => {});
    throw error;
  }
}

export async function readCurrentCatalogHook<T>(
  agentId: CatalogAgentId,
  read: (entry: AgentCatalogEntry) => T | Promise<T>,
): Promise<T | null> {
  const acquired = await acquireCurrentCatalogEntry(agentId);
  try {
    return acquired.entry ? await read(acquired.entry) : null;
  } finally {
    await acquired.release();
  }
}

