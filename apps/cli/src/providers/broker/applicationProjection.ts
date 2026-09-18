import type {
  ProviderBrokerApplicationBindingV1,
  ProviderWireProtocol,
} from '@happier-dev/protocol';

import type { ResolvedProviderConnectionRecord } from '@/providers/registry';

/**
 * Projects the exact executable application from the current resolved Provider
 * owner. Callers never infer endpoint ids or implementation identities from a
 * model id or a persisted Team source binding.
 */
export function projectProviderBrokerApplication(input: Readonly<{
  connection: ResolvedProviderConnectionRecord;
  agentTargetKey: string;
  protocol: ProviderWireProtocol;
  expectedApplication?: ProviderBrokerApplicationBindingV1;
}>): ProviderBrokerApplicationBindingV1 | null {
  const source = input.connection.source;
  if (source.kind !== 'contribution') return null;
  const identity = input.connection.deployment.kind === 'managedLocal'
    ? input.connection.deployment.implementationIdentity
    : { pluginId: source.pluginId, localId: source.definition.id };
  if (input.expectedApplication && (
    input.expectedApplication.agentTargetKey !== input.agentTargetKey
    || input.expectedApplication.protocol !== input.protocol
    || input.expectedApplication.implementationIdentity.pluginId !== identity.pluginId
    || input.expectedApplication.implementationIdentity.localId !== identity.localId
  )) return null;
  const endpoint = source.definition.endpointTemplates.find((candidate) => (
    candidate.protocol === input.protocol
    && (!input.expectedApplication || candidate.id === input.expectedApplication.endpointTemplateId)
    && (input.connection.deployment.kind !== 'managedLocal'
      || input.connection.deployment.managedRuntime.endpointTemplateIds.includes(candidate.id))
  ));
  if (!endpoint) return null;
  return {
    agentTargetKey: input.agentTargetKey,
    implementationIdentity: identity,
    endpointTemplateId: endpoint.id,
    protocol: input.protocol,
  };
}
