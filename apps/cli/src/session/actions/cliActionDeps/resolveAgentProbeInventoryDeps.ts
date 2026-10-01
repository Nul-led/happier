import { withAgentPreflightCatalog } from '@/capabilities/probes/withAgentPreflightCatalog';
import type { probeAgentModelsBestEffort as probeModels, ProbedAgentModelsResult } from '@/capabilities/probes/agentModelsProbe';
import type { probeAgentModesBestEffort as probeModes, ProbedAgentModesResult } from '@/capabilities/probes/agentModesProbe';
import type { probeAgentConfigOptionsBestEffort as probeConfigOptions, ProbedAgentConfigOptionsResult } from '@/capabilities/probes/agentConfigOptionsProbe';

export async function probeAgentModelsBestEffort(
  args: Parameters<typeof probeModels>[0],
): Promise<ProbedAgentModelsResult> {
  const mod = await import('@/capabilities/probes/agentModelsProbe');
  return await withAgentPreflightCatalog(args, async (catalog) => await mod.probeAgentModelsBestEffort({
    ...args,
    catalogEntry: catalog.catalogEntry,
    runtimeCacheKey: catalog.runtimeCacheKey,
  }));
}

export async function probeAgentModesBestEffort(
  args: Parameters<typeof probeModes>[0],
): Promise<ProbedAgentModesResult> {
  const mod = await import('@/capabilities/probes/agentModesProbe');
  return await withAgentPreflightCatalog(args, async (catalog) => await mod.probeAgentModesBestEffort({
    ...args,
    catalogEntry: catalog.catalogEntry,
    runtimeCacheKey: catalog.runtimeCacheKey,
  }));
}

export async function probeAgentConfigOptionsBestEffort(
  args: Parameters<typeof probeConfigOptions>[0],
): Promise<ProbedAgentConfigOptionsResult> {
  const mod = await import('@/capabilities/probes/agentConfigOptionsProbe');
  return await withAgentPreflightCatalog(args, async (catalog) => await mod.probeAgentConfigOptionsBestEffort({
    ...args,
    catalogEntry: catalog.catalogEntry,
    runtimeCacheKey: catalog.runtimeCacheKey,
  }));
}
