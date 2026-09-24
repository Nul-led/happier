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
import { acquireBrokerSourceOperation } from './brokerSourceOperationAcquisition';
import {
  isCLIProxyAPIBrokerApplication,
  teamCredentialBrokerPlacementAcceptsMachine,
} from './teamCredentialBrokerSourceOwner';

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
 * The default signal for reads that answer the *operation's* authority rather
 * than one caller's stream. It never aborts: an operation outlives the stream
 * that created it, so a closed stream must not make the retained operation
 * permanently non-current. Callers pass their own signal explicitly where the
 * read genuinely belongs to them.
 */
const OPERATION_AUTHORITY_SIGNAL = new AbortController().signal;

type ConnectedSelectionInput = Pick<ConnectedOpenInput, 'source' | 'application' | 'signal'>;

/**
 * The one current Connected Account/Pool choice for a broker source: the
 * CLIProxyAPI purpose family the signed application needs, and the member the
 * canonical purpose-binding owner selects for it. A pure read — it neither
 * starts nor joins managed custody — so the Home can attribute and admit a
 * request before anything is materialized, and acquisition re-enters the same
 * selector.
 */
async function resolveConnectedServicesBrokerSelection(
  resolveBindingIntentSelection: ConnectedAccountPurposeBindingOwner['resolveBindingIntentSelection'],
  request: ConnectedSelectionInput,
) {
  const family = resolveCLIProxyAPIManagedPurposeFamily({
    endpointTemplateId: request.application.endpointTemplateId,
    protocol: request.application.protocol,
  });
  if (
    !family
    || !isCLIProxyAPIBrokerApplication(request.application)
    || (
      request.source.target.kind === 'account'
        ? request.source.target.account.service.pluginId !== family.connectedAccount.service.pluginId
          || request.source.target.account.service.localId !== family.connectedAccount.service.localId
        : request.source.target.service.pluginId !== family.connectedAccount.service.pluginId
          || request.source.target.service.localId !== family.connectedAccount.service.localId
    )
  ) return null;
  const purpose = {
    consumer: request.application.implementationIdentity,
    purpose: family.purpose,
  };
  const selection = await resolveBindingIntentSelection({
    purpose,
    target: request.source.target,
    serviceRefs: [family.connectedAccount.service],
    signal: request.signal,
  }).catch(() => null);
  if (!selection) return null;
  const sourceMember: TeamCredentialSourceMemberV1 = Object.freeze({
    kind: 'connected_account' as const,
    service: Object.freeze({ ...selection.resolved.account.service }),
    connectedAccountId: selection.resolved.account.accountId,
  });
  return { family, purpose, selection, sourceMember };
}

/** Selects the current source member without acquiring anything. */
export function createConnectedServicesBrokerSourceMemberSelect(input: Readonly<{
  resolveBindingIntentSelection: ConnectedAccountPurposeBindingOwner['resolveBindingIntentSelection'];
}>): (request: ConnectedSelectionInput) => Promise<TeamCredentialSourceMemberV1 | null> {
  return async (request) => (
    await resolveConnectedServicesBrokerSelection(input.resolveBindingIntentSelection, request)
  )?.sourceMember ?? null;
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
    const readsResourceCurrent = async (
      signal: AbortSignal = OPERATION_AUTHORITY_SIGNAL,
    ): Promise<boolean> => {
      if (signal.aborted) return false;
      try {
        const resource = await input.readResource(request.resourceId, signal);
        // Source currentness is enabled, placement and source identity. The
        // revision is a policy fact the Home rechecks per request, so a policy
        // edit is not a source replacement (`04-private-iroh-broker-transport.md:272`).
        return resource !== null
          && resource.enabled
          && teamCredentialBrokerPlacementAcceptsMachine(resource.brokerPlacement, request.brokerMachineId)
          && sameSource(resource.source, request.source);
      } catch {
        return false;
      }
    };
    const chosen = await resolveConnectedServicesBrokerSelection(
      input.resolveBindingIntentSelection,
      request,
    );
    if (!chosen || !await readsResourceCurrent(request.signal)) return null;
    const { family, purpose, selection, sourceMember } = chosen;
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
    if (!purposeBindings || !await readsResourceCurrent(request.signal)) return null;

    const acquired = await acquireBrokerSourceOperation({
      custody: input.custody,
      identity: request.application.implementationIdentity,
      contributionKey: `${request.application.implementationIdentity.pluginId}/${request.application.implementationIdentity.localId}`,
      endpointTemplateId: request.application.endpointTemplateId,
      operationClaim: { kind: 'providerBroker', operation: request.operation },
      purposeBindings,
      isSourceCurrent: async (signal) => (
        await readsResourceCurrent(signal) && await selection.isCurrent()
      ),
      ...(request.revalidateOperationAuthorization
        ? { revalidateOperationAuthorization: request.revalidateOperationAuthorization }
        : {}),
      callerSignal: request.signal,
    });
    if (!acquired) return null;
    const { projection, retire, revalidateAuthorization } = acquired;
    return Object.freeze({
      projection,
      retire,
      sourceCurrentness: Object.freeze({
        sourceMember,
        isCurrent: revalidateAuthorization,
      }),
    });
  };
}
