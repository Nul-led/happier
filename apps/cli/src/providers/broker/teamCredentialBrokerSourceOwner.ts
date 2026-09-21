import type { ProviderBrokerApplicationBindingV1 } from '@happier-dev/protocol';
import { projectCLIProxyAPIProviderConnectionApplication } from '@happier-dev/plugins-cliproxyapi';
import type { ManagedServiceRequest } from '@happier-dev/plugin-sdk/managed-services';
import {
  computeTeamCredentialSourceMemberKeyV1,
  TeamCredentialSourceBindingV1Schema,
  type TeamCredentialBrokerPlacementV1,
  type TeamCredentialSourceBindingV1,
} from '@happier-dev/protocol/teams';

import type {
  ManagedProviderEndpointAccessProjection,
} from '@/plugins/runtime/invocation/services/managedServicesAdapter';
import type { TeamCredentialSourceCurrentness } from './teamCredentialSourceSnapshot';

type ConnectedServicesSource = Extract<
  TeamCredentialSourceBindingV1,
  { kind: 'connected_account' | 'connected_pool' }
>;
type ProviderConnectionSource = Extract<
  TeamCredentialSourceBindingV1,
  { kind: 'provider_connection' }
>;

/** The Home has already selected and signed the exact request target. Exact
 * placement remains a Machine match; Pool placement deliberately does not
 * turn current membership into a second ongoing authorization decision. */
export function teamCredentialBrokerPlacementAcceptsMachine(
  placement: TeamCredentialBrokerPlacementV1 | null,
  machineId: string,
): boolean {
  return machineId.trim().length > 0
    && placement !== null
    && (placement.kind === 'machine_pool' || placement.machineId === machineId);
}

/**
 * True when the signed request names the one executable application the
 * CLIProxyAPI contribution projects for this wire protocol. The contribution
 * owns that identity, so the generic broker hosts compare against its own
 * projection instead of repeating a Provider id.
 */
export function isCLIProxyAPIBrokerApplication(
  application: Pick<ProviderBrokerApplicationBindingV1, 'agentTargetKey' | 'protocol' | 'implementationIdentity'>,
): boolean {
  const projected = projectCLIProxyAPIProviderConnectionApplication({
    agentTargetKey: application.agentTargetKey,
    protocol: application.protocol,
  });
  return projected !== null
    && projected.implementationIdentity.pluginId === application.implementationIdentity.pluginId
    && projected.implementationIdentity.localId === application.implementationIdentity.localId;
}

export type TeamCredentialBrokerOperation = Readonly<
  | { kind: 'session'; sessionId: string }
  | { kind: 'execution_run'; executionRunId: string }
  | { kind: 'resource_test'; actorAccountId: string; requestId: string }
  | {
      kind: 'external_api_key';
      externalApiKeyId: string;
      assignedAccountId: string;
      assignedTeamMembershipId: string;
    }
>;

type ExactSourceOpenInput<TSource extends TeamCredentialSourceBindingV1> = Readonly<{
  source: TSource;
  resourceId: string;
  resourceRevision: number;
  brokerMachineId: string;
  operation: TeamCredentialBrokerOperation;
  application: ProviderBrokerApplicationBindingV1;
  modelId?: string;
  sourceRevision?: string;
  revalidateOperationAuthorization?(signal?: AbortSignal): Promise<boolean>;
  signal: AbortSignal;
}>;

export type TeamCredentialBrokerSourceOpenInput = ExactSourceOpenInput<
  TeamCredentialSourceBindingV1
>;

export type TeamCredentialBrokerSourceAcquireResult =
  | Readonly<{
      ok: true;
      projection: ManagedProviderEndpointAccessProjection;
      sourceMemberKey: string;
      /** Retires the operation-scoped managed Provider semantic custody.
       * Projection cleanup alone releases only this caller's joined view. */
      retire(): Promise<void>;
    }>
  | Readonly<{
      ok: false;
      reasonCode:
        | 'source_invalid'
        | 'source_unavailable'
        | 'broker_unavailable'
        | 'broker_machine_mismatch';
    }>;

export type TeamCredentialBrokerSourceOwner = Readonly<{
  acquire(
    input: TeamCredentialBrokerSourceOpenInput,
  ): Promise<TeamCredentialBrokerSourceAcquireResult>;
}>;

type SourceOpenResult = Promise<Readonly<{
  projection: ManagedProviderEndpointAccessProjection;
  sourceCurrentness: Pick<TeamCredentialSourceCurrentness, 'sourceMember' | 'isCurrent'>;
  retire(): Promise<void>;
}> | null>;

function validOperation(operation: TeamCredentialBrokerOperation): boolean {
  if (operation.kind === 'session') {
    return Object.keys(operation).length === 2
      && typeof operation.sessionId === 'string'
      && operation.sessionId.trim().length > 0;
  }
  if (operation.kind === 'execution_run') {
    return Object.keys(operation).length === 2
      && typeof operation.executionRunId === 'string'
      && operation.executionRunId.trim().length > 0;
  }
  if (operation.kind === 'resource_test') {
    return Object.keys(operation).length === 3
      && operation.actorAccountId.trim().length > 0
      && operation.requestId.trim().length > 0;
  }
  return Object.keys(operation).length === 4
    && operation.externalApiKeyId.trim().length > 0
    && operation.assignedAccountId.trim().length > 0
    && operation.assignedTeamMembershipId.trim().length > 0;
}

function readsCurrent(projection: ManagedProviderEndpointAccessProjection): boolean {
  try {
    return projection.isCurrent() === true;
  } catch {
    return false;
  }
}

/**
 * Machine-local composition for one Team credential broker source.
 *
 * Connected Accounts and Connected Service Pools deliberately share one
 * adapter: the established Connected Services owner remains responsible for
 * exact-account selection, Pool switching, refresh and materialization. A
 * Provider Connection uses its separate Provider/CPX adapter. This owner only
 * fixes the already-admitted resource, Machine and Session/Run operation for
 * the returned SVC09 projection. Pool member selection is deliberately
 * re-entered by the stream lifetime before each request.
 */
export function createTeamCredentialBrokerSourceOwner(input: Readonly<{
  machineId: string;
  openConnectedServicesSource(
    input: ExactSourceOpenInput<ConnectedServicesSource>,
  ): SourceOpenResult;
  openProviderConnectionSource(
    input: ExactSourceOpenInput<ProviderConnectionSource>,
  ): SourceOpenResult;
}>): TeamCredentialBrokerSourceOwner {
  return Object.freeze({
    async acquire(rawInput) {
      if (
        rawInput.brokerMachineId !== input.machineId
        || input.machineId.trim().length === 0
      ) {
        return Object.freeze({
          ok: false as const,
          reasonCode: 'broker_machine_mismatch' as const,
        });
      }
      const source = TeamCredentialSourceBindingV1Schema.safeParse(
        rawInput.source,
      );
      if (
        !source.success
        || !validOperation(rawInput.operation)
        || rawInput.resourceId.trim().length === 0
        || !Number.isSafeInteger(rawInput.resourceRevision)
        || rawInput.resourceRevision < 0
        || rawInput.application.endpointTemplateId.trim().length === 0
        || (rawInput.modelId !== undefined && rawInput.modelId.trim().length === 0)
        || (rawInput.sourceRevision !== undefined && rawInput.sourceRevision.trim().length === 0)
      ) {
        return Object.freeze({
          ok: false as const,
          reasonCode: 'source_invalid' as const,
        });
      }
      if (rawInput.signal.aborted) {
        return Object.freeze({
          ok: false as const,
          reasonCode: 'broker_unavailable' as const,
        });
      }

      const exactInput = Object.freeze({
        source: source.data,
        resourceId: rawInput.resourceId,
        resourceRevision: rawInput.resourceRevision,
        brokerMachineId: input.machineId,
        operation: Object.freeze({ ...rawInput.operation }),
        application: Object.freeze({
          ...rawInput.application,
          implementationIdentity: Object.freeze({
            ...rawInput.application.implementationIdentity,
          }),
        }),
        ...(rawInput.modelId !== undefined ? { modelId: rawInput.modelId } : {}),
        ...(rawInput.sourceRevision !== undefined ? { sourceRevision: rawInput.sourceRevision } : {}),
        ...(rawInput.revalidateOperationAuthorization
          ? {
              revalidateOperationAuthorization:
                rawInput.revalidateOperationAuthorization,
            }
          : {}),
        signal: rawInput.signal,
      });
      let opened: Awaited<SourceOpenResult>;
      try {
        opened = source.data.kind === 'provider_connection'
          ? await input.openProviderConnectionSource({
              ...exactInput,
              source: source.data,
            })
          : await input.openConnectedServicesSource({
              ...exactInput,
              source: source.data,
            });
      } catch {
        return Object.freeze({
          ok: false as const,
          reasonCode: 'source_unavailable' as const,
        });
      }
      if (!opened) {
        return Object.freeze({
          ok: false as const,
          reasonCode: 'source_unavailable' as const,
        });
      }
      const { projection, sourceCurrentness } = opened;
      let sourceCurrent = await sourceCurrentness.isCurrent().catch(() => false);
      if (rawInput.signal.aborted || !sourceCurrent || !readsCurrent(projection)) {
        await opened.retire().catch(() => undefined);
        await Promise.resolve(projection.cleanup()).catch(() => undefined);
        return Object.freeze({
          ok: false as const,
          reasonCode: 'source_unavailable' as const,
        });
      }

      let retired = false;
      let cleaned = false;
      let semanticRetired = false;
      let cleanupInFlight: Promise<void> | null = null;
      let retireInFlight: Promise<void> | null = null;
      const onAbort = (): void => {
        void retireAndCleanup().catch(() => undefined);
      };
      const retire = (): Promise<void> => {
        retired = true;
        if (semanticRetired) return Promise.resolve();
        retireInFlight ??= Promise.resolve(opened.retire()).then(
          () => {
            semanticRetired = true;
            retireInFlight = null;
          },
          (error: unknown) => {
            retireInFlight = null;
            throw error;
          },
        );
        return retireInFlight;
      };
      const cleanup = (): Promise<void> => {
        retired = true;
        if (cleaned) return Promise.resolve();
        cleanupInFlight ??= Promise.resolve(projection.cleanup()).then(
          () => {
            cleaned = true;
            cleanupInFlight = null;
            rawInput.signal.removeEventListener('abort', onAbort);
          },
          (error: unknown) => {
            cleanupInFlight = null;
            throw error;
          },
        );
        return cleanupInFlight;
      };
      const retireAndCleanup = async (): Promise<void> => {
        try {
          await retire();
        } finally {
          await cleanup();
        }
      };
      rawInput.signal.addEventListener('abort', onAbort, { once: true });
      if (rawInput.signal.aborted) {
        await retireAndCleanup().catch(() => undefined);
        return Object.freeze({
          ok: false as const,
          reasonCode: 'broker_unavailable' as const,
        });
      }
      return Object.freeze({
        ok: true as const,
        sourceMemberKey: computeTeamCredentialSourceMemberKeyV1(sourceCurrentness.sourceMember),
        retire,
        projection: Object.freeze({
          access: Object.freeze({
            endpointUrl: projection.access.endpointUrl,
            async request(request: ManagedServiceRequest) {
              if (retired) {
                return Object.freeze({
                  ok: false,
                  status: 403,
                  statusText: 'Source unavailable',
                  headers: Object.freeze({}),
                  body: null,
                });
              }
              sourceCurrent = await sourceCurrentness.isCurrent().catch(() => false);
              if (
                rawInput.signal.aborted
                || !sourceCurrent
                || !readsCurrent(projection)
              ) {
                await retireAndCleanup().catch(() => undefined);
                return Object.freeze({
                  ok: false,
                  status: 403,
                  statusText: 'Source unavailable',
                  headers: Object.freeze({}),
                  body: null,
                });
              }
              return await projection.access.request(request);
            },
          }),
          isCurrent: () => (
            !retired
            && !rawInput.signal.aborted
            && sourceCurrent
            && readsCurrent(projection)
          ),
          cleanup,
        }),
      });
    },
  });
}
