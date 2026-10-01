import { isRuntimeCheckedExperimentalVendorResume } from '@happier-dev/agents';

import { readCurrentCatalogHook } from '@/agent/catalog/runtimeEntry';
import { resolveCatalogAgentId } from '@/agent/catalog/resolution';
import type {
  CatalogAgentId,
  ProviderSessionRuntimePreferences,
  VendorResumeSupportFn,
} from '@/agent/catalog/types';
import type { AgentCliSessionCommandBuildInputV1 } from '@happier-dev/plugin-sdk/agents/runtime';

export async function getVendorResumeSupport(agentId?: CatalogAgentId | null): Promise<VendorResumeSupportFn> {
  const catalogId = resolveCatalogAgentId(agentId);
  if (!catalogId) return () => false;
  // Demand the current Agent runtime through the shared catalog owner. A
  // declaration-only snapshot does not contain lazily registered predicates.
  return await readCurrentCatalogHook(catalogId, async (entry): Promise<VendorResumeSupportFn> => {
    if (entry.vendorResumeSupport === 'supported') return () => true;
    if (entry.vendorResumeSupport === 'unsupported') return () => false;
    if (entry.vendorResumeSupport === 'experimental' && entry.getVendorResumeSupport) {
      return await entry.getVendorResumeSupport();
    }
    if (isRuntimeCheckedExperimentalVendorResume(catalogId)) return () => true;
    return () => false;
  }) ?? (() => false);
}

export async function resolveProviderSessionRuntimePreferences(
  agentId: CatalogAgentId | null | undefined,
  params: AgentCliSessionCommandBuildInputV1,
): Promise<ProviderSessionRuntimePreferences> {
  const catalogId = resolveCatalogAgentId(agentId);
  if (!catalogId) return {};
  return await readCurrentCatalogHook(catalogId, (entry) => (
    entry.resolveSessionRuntimePreferences?.(params) ?? Promise.resolve({})
  )) ?? {};
}
