import { resolveCLIProxyAPIManagedPurposeFamily } from '@happier-dev/plugins-cliproxyapi';
import {
  type TeamCredentialResourceSummaryV1,
  type TeamCredentialSourceBindingV1,
  type TeamCredentialSourceMemberV1,
} from '@happier-dev/protocol/teams';

import { resolveManagedProviderPurposeBindingSnapshot } from '@/providers/managed/resolvePurposeBindingSnapshot';
import type { ConnectedAccountPurposeBindingOwner } from '@/daemon/connectedServices/purposeBindings/ConnectedAccountPurposeBindingOwner';
import type { ManagedProviderExplicitStartCustody } from '@/providers/connections/publicManagedRuntimeStart';
import type { TeamCredentialBrokerSourceOpenInput } from './teamCredentialBrokerSourceOwner';
import { teamCredentialBrokerPlacementAcceptsMachine } from './teamCredentialBrokerSourceOwner';

type ConnectedSource = Extract<
  TeamCredentialSourceBindingV1,
  { kind: 'connected_account' | 'connected_pool' }
>;

type ConnectedOpenInput = TeamCredentialBrokerSourceOpenInput & Readonly<{
  source: ConnectedSource;
}>;

function sameSource(left: TeamCredentialSourceBindingV1 | null, right: ConnectedSource): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Opens one operation-scoped CLIProxyAPI projection over the exact current
 * Connected Account/Pool selected by the Team resource. The Connected Account
 * purpose-binding owner resolves credentials and Pool membership; this adapter
 * only connects that current authority to existing managed Provider custody.
 */
export function createConnectedServicesBrokerSourceOpen(input: Readonly<{
  readResource(
    resourceId: string,
    signal: AbortSignal,
  ): Promise<TeamCredentialResourceSummaryV1 | null>;
  resolveBindingIntentSelection: ConnectedAccountPurposeBindingOwner['resolveBindingIntentSelection'];
  custody: ManagedProviderExplicitStartCustody;
}>): (request: ConnectedOpenInput) => Promise<Readonly<{
  projection: NonNullable<Awaited<ReturnType<ManagedProviderExplicitStartCustody['acquire']>>>;
  sourceCurrentness: Readonly<{
    sourceMember: TeamCredentialSourceMemberV1;
    isCurrent(): Promise<boolean>;
  }>;
  retire(): Promise<void>;
}> | null> {
  return async (request) => {
    const family = resolveCLIProxyAPIManagedPurposeFamily({
      endpointTemplateId: request.application.endpointTemplateId,
      protocol: request.application.protocol,
    });
    if (
      !family
      || request.application.implementationIdentity.pluginId
        !== 'happier.provider.cliproxyapi'
      || request.application.implementationIdentity.localId !== 'cliproxyapi'
      || (
        request.source.target.kind === 'account'
          ? request.source.target.account.service.pluginId !== family.connectedAccount.service.pluginId
            || request.source.target.account.service.localId !== family.connectedAccount.service.localId
          : request.source.target.service.pluginId !== family.connectedAccount.service.pluginId
            || request.source.target.service.localId !== family.connectedAccount.service.localId
      )
    ) return null;

    const readsResourceCurrent = async (
      signal: AbortSignal = request.signal,
    ): Promise<boolean> => {
      if (signal.aborted) return false;
      try {
        const resource = await input.readResource(request.resourceId, signal);
        return resource !== null
          && resource.enabled
          && resource.revision === request.resourceRevision
          && teamCredentialBrokerPlacementAcceptsMachine(resource.brokerPlacement, request.brokerMachineId)
          && sameSource(resource.source, request.source);
      } catch {
        return false;
      }
    };
    if (!await readsResourceCurrent()) return null;

    const purpose = {
      consumer: request.application.implementationIdentity,
      purpose: family.purpose,
    };
    const selection = await input.resolveBindingIntentSelection({
      purpose,
      target: request.source.target,
      serviceRefs: [family.connectedAccount.service],
      signal: request.signal,
    }).catch(() => null);
    if (!selection) return null;
    const exactTarget = Object.freeze({
      kind: 'account' as const,
      account: Object.freeze({
        service: Object.freeze({ ...selection.resolved.account.service }),
        accountId: selection.resolved.account.accountId,
      }),
    });
    const purposeBindings = await resolveManagedProviderPurposeBindingSnapshot({
      implementationIdentity: request.application.implementationIdentity,
      connectedAccounts: [{
        purpose: family.purpose,
        title: family.title,
        service: family.connectedAccount.service,
        required: family.connectedAccount.required,
        materializationKinds: [...family.connectedAccount.materializationKinds],
      }],
      purposeBindingIntents: {
        v: 1,
        bindings: [{
          purpose,
          target: exactTarget,
        }],
      },
      resolveBindingIntent: async ({ purpose: exactPurpose }) => ({
        purpose: exactPurpose,
        target: exactTarget,
      }),
      signal: request.signal,
    }).catch(() => null);
    if (!purposeBindings || !await readsResourceCurrent()) return null;

    let authorizationCurrent = true;
    const isAuthorizationCurrent = (): boolean => (
      authorizationCurrent && !request.signal.aborted
    );
    const revalidateAuthorization = async (): Promise<boolean> => {
      authorizationCurrent = isAuthorizationCurrent()
        && await readsResourceCurrent()
        && await selection.isCurrent();
      return authorizationCurrent;
    };
    const operationClaim = {
      kind: 'providerBroker' as const,
      operation: request.operation,
    };
    const retire = async (): Promise<void> => {
      await input.custody.retire({
        identity: request.application.implementationIdentity,
        operationClaim,
      });
    };
    const revalidateOperationAuthorization =
      request.revalidateOperationAuthorization;
    const projection = await input.custody.acquire({
      contributionKey: `${request.application.implementationIdentity.pluginId}/${request.application.implementationIdentity.localId}`,
      identity: request.application.implementationIdentity,
      request: {
        reason: 'explicitStartLocal',
        endpointTemplateIds: [request.application.endpointTemplateId],
      },
      purposeBindings,
      isAuthorizationCurrent,
      revalidateAuthorization,
      ...(revalidateOperationAuthorization
        ? {
            revalidateRetainedCurrentness: async (signal) => (
              await readsResourceCurrent(signal)
              && await revalidateOperationAuthorization(signal)
            ),
          }
        : {}),
      operationClaim,
      signal: request.signal,
    });
    if (!projection || !await revalidateAuthorization()) {
      if (projection) {
        await retire().catch(() => undefined);
        await Promise.resolve(projection.cleanup()).catch(() => undefined);
      }
      return null;
    }
    return Object.freeze({
      projection,
      retire,
      sourceCurrentness: Object.freeze({
        sourceMember: Object.freeze({
          kind: 'connected_account' as const,
          service: Object.freeze({ ...selection.resolved.account.service }),
          connectedAccountId: selection.resolved.account.accountId,
        }),
        isCurrent: revalidateAuthorization,
      }),
    });
  };
}
