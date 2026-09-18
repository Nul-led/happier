import {
  buildConnectedServiceAccountGroupOptionsByServiceId as buildSharedConnectedServiceAccountGroupOptionsByServiceId,
  buildConnectedServiceProfileOptionsByServiceId as buildSharedConnectedServiceProfileOptionsByServiceId,
  isConnectedServiceProfileOptionSelectable,
  isConnectedServiceProfileStatusSelectable,
  resolveAgentSupportedConnectedServiceIds,
  resolveConnectedServiceSessionSelection,
  type ConnectedServiceId,
  type ConnectedServicesAccountGroupOptionsByServiceId,
  type ConnectedServicesProfileOption,
  type ConnectedServicesProfileOptionsByServiceId,
} from '@happier-dev/agents';
import {
  ConnectedAccountServiceKeySchema,
  ConnectedServiceBindingSelectionV2Schema,
  ConnectedServiceBindingsV2Schema,
  type ConnectedServiceBindingSelectionV2,
  type ConnectedServiceBindingsV2,
} from '@happier-dev/protocol';

import type { ConnectedServicesServiceBinding } from '@/sync/domains/connectedServices/connectedServicesAgentOptionStateBindings';
import { resolveQualifiedConnectedAccountServiceKey } from '@/sync/domains/connectedServices/connectedServiceRegistry';

export {
  buildSharedConnectedServiceProfileOptionsByServiceId as buildConnectedServiceProfileOptionsByServiceId,
  buildSharedConnectedServiceAccountGroupOptionsByServiceId as buildConnectedServiceAccountGroupOptionsByServiceId,
  isConnectedServiceProfileOptionSelectable,
  isConnectedServiceProfileStatusSelectable,
  resolveAgentSupportedConnectedServiceIds,
};

export type {
  ConnectedServicesAccountGroupOptionsByServiceId,
  ConnectedServicesProfileOption,
  ConnectedServicesProfileOptionsByServiceId,
};

export function buildConnectedServicesBindingsPayload(params: Readonly<{
  /** Qualified keys on current callers; released bundled scalar ids are translated through the generated built-in mapping. */
  supportedConnectedServiceIds: ReadonlyArray<string>;
  connectedServiceProfileOptionsByServiceId: ConnectedServicesProfileOptionsByServiceId;
  connectedServiceAccountGroupOptionsByServiceId?: ConnectedServicesAccountGroupOptionsByServiceId;
  connectedServicesBindingsByServiceId: Readonly<Record<string, ConnectedServicesServiceBinding | undefined>>;
  defaultProfileByServiceId: Record<string, string | undefined>;
  accountGroupsFeatureEnabled?: boolean;
  /** Existing-session switches must publish native-only payloads to disconnect. */
  emitWhenAllNative?: boolean;
}>): ConnectedServiceBindingsV2 | null {
  const bindingsByServiceId: Record<string, ConnectedServiceBindingSelectionV2> = {};
  const handledServiceIds = new Set<string>();
  let connectedCount = 0;

  for (const requestedServiceId of params.supportedConnectedServiceIds) {
    // The wire contract carries canonical qualified keys only. Resolve every
    // declared service through the provenance-named legacy ingress and drop
    // anything unknown — never emit a bare local id.
    const serviceId = resolveQualifiedConnectedAccountServiceKey(requestedServiceId);
    if (!serviceId || handledServiceIds.has(serviceId)) continue;
    handledServiceIds.add(serviceId);
    const options = params.connectedServiceProfileOptionsByServiceId[serviceId]
      ?? params.connectedServiceProfileOptionsByServiceId[requestedServiceId]
      ?? [];
    const binding = params.connectedServicesBindingsByServiceId[serviceId]
      ?? params.connectedServicesBindingsByServiceId[requestedServiceId];
    if (binding?.source === 'team_resource') {
      bindingsByServiceId[serviceId] = binding;
      connectedCount += 1;
      continue;
    }
    const resolution = resolveConnectedServiceSessionSelection({
      serviceId,
      binding: binding ?? { source: 'native' },
      availability: {
        kind: 'known',
        profileOptions: options,
        groupOptions: params.connectedServiceAccountGroupOptionsByServiceId?.[serviceId]
          ?? params.connectedServiceAccountGroupOptionsByServiceId?.[requestedServiceId]
          ?? [],
        accountGroupsEnabled: params.accountGroupsFeatureEnabled !== false,
      },
      defaultProfileByServiceId: params.defaultProfileByServiceId,
    });

    if (resolution.status !== 'no_selection') {
      bindingsByServiceId[serviceId] = {
        source: 'connected',
        ...resolution.selection,
      };
      connectedCount += 1;
      continue;
    }

    bindingsByServiceId[serviceId] = { source: 'native' };
  }

  // A current Agent declaration governs what the picker may offer, not whether
  // a previously authored canonical binding still belongs to the controlled
  // value. Preserve valid qualified entries that are no longer declared so an
  // edit to one visible service cannot erase an unrelated stored choice.
  for (const [serviceId, binding] of Object.entries(params.connectedServicesBindingsByServiceId)) {
    if (handledServiceIds.has(serviceId)) continue;
    if (!ConnectedAccountServiceKeySchema.safeParse(serviceId).success) continue;
    const parsedBinding = ConnectedServiceBindingSelectionV2Schema.safeParse(binding);
    if (!parsedBinding.success) continue;
    bindingsByServiceId[serviceId] = parsedBinding.data;
    if (parsedBinding.data.source !== 'native') connectedCount += 1;
  }

  return connectedCount > 0 || params.emitWhenAllNative === true
    ? ConnectedServiceBindingsV2Schema.parse({ v: 2, bindingsByServiceId })
    : null;
}
