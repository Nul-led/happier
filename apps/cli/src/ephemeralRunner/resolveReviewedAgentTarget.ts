import type { AgentExecutionTargetV1 } from '@happier-dev/protocol';

import { resolveEngineBackendIdForCatalogAgent } from '@/agent/runtime/registry/engineRegistry';
import {
  indexAgentRoutingIdsByContributionIdentity,
  readAgentRoutingIdForContributionIdentity,
} from '@/plugins/projection/registry/agentRoutingIdentity';
import type { ResolvedContributionRegistry } from '@/plugins/projection/registry/types';

/**
 * Resolves the exact Agent contribution that the creator reviewed.
 *
 * A contribution's local id is not globally unique. Runner preparation and
 * execution therefore share the routing id selected from the immutable
 * `{ pluginId, localId }` manifest identity instead of re-resolving by local id.
 */
export function resolveReviewedRunnerAgentTarget(input: Readonly<{
  contributions: Pick<ResolvedContributionRegistry, 'agentDefinitionsById'>;
  target: AgentExecutionTargetV1;
}>) {
  const routingIdsByIdentity = indexAgentRoutingIdsByContributionIdentity(
    [...input.contributions.agentDefinitionsById.values()],
  );
  const agentId = readAgentRoutingIdForContributionIdentity(
    routingIdsByIdentity,
    input.target.identity,
  );
  if (!agentId) return null;

  const contribution = input.contributions.agentDefinitionsById.get(agentId);
  if (!contribution?.runtimeSpec) return null;
  if (
    contribution.identity?.pluginId !== input.target.identity.pluginId
    || contribution.identity?.localId !== input.target.identity.localId
  ) {
    return null;
  }

  const backendId = resolveEngineBackendIdForCatalogAgent(input.contributions, agentId);
  if (!backendId) return null;

  return Object.freeze({
    agentId,
    backendId,
    runtimeSpec: contribution.runtimeSpec,
  });
}
