import { readMachineOperationProtocolCapabilitiesV1 } from '@/api/machine/machineOperationProtocolCapabilities';
import type {
  AccountApiTokensListActionOutputV1,
  WorkflowAcceptedAuthorizationV1,
} from '@happier-dev/protocol';
import {
  buildQualifiedPluginContributionKey,
} from '@happier-dev/protocol';
import {
  CONVERSATION_CORE_PROVIDER_ACTION_IDS_V1,
  ConversationPermissionMediationSourceCurrentnessResultV1Schema,
} from '@happier-dev/channels-protocol/v1';
import { createAccountServerActionDeps } from '@/api/accountServerActionDeps';
import { configuration } from '@/configuration';
import { resolveAutomationWorkerAccountEncryption } from '@/daemon/automation/automationWorker';
import { acquireAuthoritativePluginRuntimeRegistryLease } from '@/plugins/runtime/reload/runtimeLease';
import { executeContributedAction } from '@/plugins/runtime/invocation/actions/executeContributedAction';
import { summarizeSessionRecord } from '@/cli/output/session/sessionSummary';
import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import { cancelSessionInput } from '@/session/services/cancelSessionInput';
import type { sendSessionMessage } from '@/session/services/sendSessionMessage';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import type { StoredCredentials } from '@/persistence';
import { createSpawnConnectedServicesTeamResourceCatalogResolver } from '@/session/services/spawnConnectedServicesDefaults';

import {
  createProductionWorkflowRunCoordinator,
  projectWorkflowResultDeliverySettlement,
} from './production';
import {
  createWorkflowRunRecoveryReader,
  type WorkflowInvocationRecoveryObservation,
} from './recovery';
import { createWorkflowRunStorageClient } from './workflowRunStorageClient';
import {
  deliverWorkflowResultToOriginatingSession,
  enqueueWorkflowSessionInput,
  observeWorkflowDetachedExecutionRunInput,
  observeWorkflowSessionInputResult,
  stopWorkflowPendingExecutionRunInput,
} from './stepExecution';

type MachineAdmissionTransport = NonNullable<Parameters<typeof sendSessionMessage>[0]['machineAdmissionTransport']>;

async function resolveAvailableEncryption(credentials: StoredCredentials, signal?: AbortSignal) {
  const resolved = await resolveAutomationWorkerAccountEncryption({
    token: credentials.token,
    credentials,
    ...(signal ? { signal } : {}),
  });
  if (resolved.kind !== 'available') throw new Error('workflow_account_encryption_unavailable');
  return resolved;
}

type RecoveryActionExecutor = Pick<ReturnType<typeof createCliActionExecutorFromCredentials>, 'execute'>;

/** Exact, one-shot observation/stop adapter. It never sends, starts, or resolves a provider handle. */
export function createWorkflowInvocationRecoveryObserver(params: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  actionExecutor: RecoveryActionExecutor;
  now?: () => number;
  observeSession?: typeof observeWorkflowSessionInputResult;
  cancelSession?: typeof cancelSessionInput;
  observeRun?: typeof observeWorkflowDetachedExecutionRunInput;
}>) {
  const now = params.now ?? Date.now;
  const observeSession = params.observeSession ?? observeWorkflowSessionInputResult;
  const cancelSession = params.cancelSession ?? cancelSessionInput;
  const observeRun = params.observeRun ?? observeWorkflowDetachedExecutionRunInput;
  return async (input: Readonly<{
    progress: import('@happier-dev/protocol').WorkflowProgressEnvelopeV1;
    terminalParent: boolean;
    cancellationRequested: boolean;
    signal?: AbortSignal;
  }>): Promise<WorkflowInvocationRecoveryObservation> => {
    const execution = input.progress.execution;
    if (!execution) return { kind: 'unresolved', code: 'workflow_execution_correspondence_missing' };
    if (execution.kind === 'session') {
      let observed: Awaited<ReturnType<typeof observeSession>>;
      try {
        observed = await observeSession({
          credentials: params.credentials,
          sessionId: execution.sessionId,
          localId: execution.localInputId,
          deadlineMs: now(),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch {
        return { kind: 'unresolved', code: 'session_input_result_read_failed' };
      }
      if (!observed.ok) return { kind: 'unresolved', code: observed.code };
      switch (observed.result.kind) {
        case 'final_text': return { kind: 'completed', result: observed.result.text };
        case 'terminal_no_result': return { kind: 'failed', code: observed.result.reason };
        case 'failed': return { kind: 'failed', code: 'session_input_failed' };
        case 'pending':
          if (!input.terminalParent && !input.cancellationRequested) {
            return { kind: 'unresolved', code: 'session_input_pending' };
          }
          break;
        case 'cancelled': break;
      }
      let cancelled: Awaited<ReturnType<typeof cancelSession>>;
      try {
        cancelled = await cancelSession({
          credentials: params.credentials,
          sessionId: execution.sessionId,
          localId: execution.localInputId,
        });
      } catch {
        return { kind: 'unresolved', code: 'session_input_cancel_unavailable' };
      }
      switch (cancelled.kind) {
        case 'pending_retired': return { kind: 'cancelled', code: 'session_input_pending_retired' };
        // The Session owner accepted the stop request, but the exact turn may
        // still be running. Live coordination keeps this same correspondence
        // in `cancel_requested`; recovery must not turn the acknowledgement
        // into terminal evidence and settle parent custody prematurely.
        case 'turn_cancel_requested': return { kind: 'unresolved', code: 'session_input_turn_cancel_requested' };
        case 'session_absent': return { kind: 'cancelled', code: 'session_input_session_absent' };
        case 'turn_cancel_unavailable': return { kind: 'unresolved', code: cancelled.code };
      }
    }

    const sessionId = execution.kind === 'attached_run' ? execution.sessionId : null;
    let actionFailure: string | null = null;
    const actionContext = {
      surface: 'agent' as const,
      authority: 'account_automation' as const,
      executionRunTargetMachineId: params.machineId,
      ...(input.signal ? { signal: input.signal } : {}),
    };
    let observed: Awaited<ReturnType<typeof observeRun>>;
    try {
      observed = await observeRun({
        runId: execution.runId,
        localInputId: execution.localInputId,
        get: async (request) => {
          const result = await params.actionExecutor.execute(
            'execution.run.get',
            { sessionId, ...request },
            actionContext,
          );
          if (!result.ok) {
            actionFailure = result.errorCode;
            return null;
          }
          return result.result;
        },
      });
    } catch {
      return { kind: 'unresolved', code: actionFailure ?? 'execution_run_result_read_failed' };
    }
    if (actionFailure) return { kind: 'unresolved', code: actionFailure };
    if (observed.kind !== 'pending') return observed;
    if (!input.terminalParent && !input.cancellationRequested) {
      return { kind: 'unresolved', code: 'execution_run_input_pending' };
    }
    const { signal: _signal, ...stopContext } = actionContext;
    return await stopWorkflowPendingExecutionRunInput({
      runId: execution.runId,
      localInputId: execution.localInputId,
      stop: async () => {
        try {
          return await params.actionExecutor.execute(
            'execution.run.stop',
            { sessionId, runId: execution.runId },
            stopContext,
          );
        } catch {
          return { ok: false, errorCode: 'execution_run_stop_unavailable' };
        }
      },
      get: async (request) => {
        const result = await params.actionExecutor.execute(
          'execution.run.get',
          { sessionId, ...request },
          stopContext,
        );
        return result.ok ? result.result : null;
      },
      observe: observeRun,
    });
  };
}

export function createWorkflowAcceptedAuthorizationCurrentness(params: Readonly<{
  accountId: string;
  listAccountApiTokens: (signal?: AbortSignal) => Promise<AccountApiTokensListActionOutputV1>;
  resolveCurrentPluginImmutableGenerationId: (pluginId: string) => Promise<string | null>;
  isMediatedSourceCurrent: (
    sourceAuthority: NonNullable<WorkflowAcceptedAuthorizationV1['sourceAuthority']>,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  now?: () => number;
}>) {
  const now = params.now ?? Date.now;
  return async ({ authorization, signal }: Readonly<{
    authorization: WorkflowAcceptedAuthorizationV1;
    signal?: AbortSignal;
  }>): Promise<boolean> => {
    try {
      const principal = authorization.principal;
      if (authorization.sourceAuthority) {
        // The authoritative plugin-runtime lease proves that the admitted
        // mediator still exists before this Run may release another leaf.
        const sourceMediatorGenerationId = await params.resolveCurrentPluginImmutableGenerationId(
          authorization.sourceAuthority.mediatorPluginId,
        );
        if (sourceMediatorGenerationId === null) return false;
        if (!(await params.isMediatedSourceCurrent(authorization.sourceAuthority, signal))) {
          return false;
        }
      }
      if (principal.kind === 'host') {
        return true;
      }
      if (principal.kind === 'api') {
        if (principal.accountId !== params.accountId || principal.principalId !== params.accountId) {
          return false;
        }
        const current = await params.listAccountApiTokens(signal);
        const token = current.tokens.find((candidate) => candidate.tokenId === principal.credentialId);
        return token !== undefined
          && (token.expiresAt === null || Date.parse(token.expiresAt) > now());
      }
      if (!principal.immutableGenerationId) return false;
      const currentGenerationId = await params.resolveCurrentPluginImmutableGenerationId(
        principal.pluginId,
      );
      return currentGenerationId === principal.immutableGenerationId;
    } catch {
      return false;
    }
  };
}

/**
 * Process-lifetime production composition for the one Workflow coordinator and
 * its lifecycle-indexed recovery reader. The Automation worker remains the
 * claim owner; this factory only binds incumbent Session/Action/storage owners.
 */
export function createProductionDaemonWorkflowRuntime(params: Readonly<{
  credentials: StoredCredentials;
  accountId: string;
  serverId?: string;
}>) {
  const serverId = params.serverId ?? configuration.activeServerId;
  const accountServerActionDeps = createAccountServerActionDeps({
    token: params.credentials.token,
    serverId,
    serverHttpBaseUrl: configuration.apiServerUrl,
  });
  const isAcceptedAuthorizationCurrent = createWorkflowAcceptedAuthorizationCurrentness({
    accountId: params.accountId,
    listAccountApiTokens: async (signal) => {
      const list = accountServerActionDeps.accountApiTokensListAction;
      if (!list) throw new Error('workflow_api_token_currentness_unavailable');
      const result = await list({
        input: {},
        context: { surface: 'cli', authority: 'present_user', serverId },
        ...(signal ? { signal } : {}),
      });
      if (!('tokens' in result)) throw new Error('workflow_api_token_currentness_unavailable');
      return result;
    },
    resolveCurrentPluginImmutableGenerationId: async (pluginId) => {
      const lease = await acquireAuthoritativePluginRuntimeRegistryLease();
      try {
        return await lease.registry.resolveCurrentPluginImmutableGenerationId?.(pluginId) ?? null;
      } finally {
        await lease.release();
      }
    },
    isMediatedSourceCurrent: async (sourceAuthority, signal) => {
      const lease = await acquireAuthoritativePluginRuntimeRegistryLease();
      try {
        const result = await executeContributedAction({
          runtimeRegistry: lease.registry,
          actionId: buildQualifiedPluginContributionKey({
            pluginId: sourceAuthority.mediatorPluginId,
            localId: CONVERSATION_CORE_PROVIDER_ACTION_IDS_V1.permissionMediationSourceCurrentness,
          }),
          input: {
            sourceRef: sourceAuthority.sourceRef,
            sourceRevisionOrEpoch: sourceAuthority.sourceRevisionOrEpoch,
            remoteApprovalMaxScope: sourceAuthority.remoteApprovalMaxScope,
          },
          context: {
            surface: 'plugin',
            invocationSurface: 'background',
            ...(signal ? { signal } : {}),
          },
        });
        if (!result.matched || !result.result.ok) return false;
        const parsed = ConversationPermissionMediationSourceCurrentnessResultV1Schema.safeParse(
          result.result.result,
        );
        return parsed.success && parsed.data.current;
      } finally {
        await lease.release();
      }
    },
  });
  return {
    isAcceptedAuthorizationCurrent,
    createCoordinatorForMachine(input: Readonly<{
      machineId: string;
      machineAdmissionTransport: MachineAdmissionTransport;
      machineActionDirectTargetTransport: import('@/session/actions/createCliActionDeps').MachineActionDirectTargetTransport;
    }>) {
      const resolveTeamCredentialResourceCatalog = accountServerActionDeps.homeDomainAction
        ? createSpawnConnectedServicesTeamResourceCatalogResolver({
            homeDomainAction: accountServerActionDeps.homeDomainAction,
            serverId,
            accountId: params.accountId,
          })
        : undefined;
      const resolveMachineOperationProtocolCapabilities = async (signal?: AbortSignal) => (
        await readMachineOperationProtocolCapabilitiesV1({
          credentials: params.credentials,
          machineId: input.machineId,
          ...(signal ? { signal } : {}),
        })
      )?.capabilities ?? null;
      const actionExecutor = createCliActionExecutorFromCredentials({
        credentials: params.credentials,
        machineId: input.machineId,
        machineAdmissionTransport: input.machineAdmissionTransport,
        machineActionDirectTargetTransport: input.machineActionDirectTargetTransport,
        workflowAcceptedAuthorizationCurrentness: isAcceptedAuthorizationCurrent,
      });
      const buildActionContext = (execution: Readonly<{
        runId: string;
        authorization: import('@happier-dev/protocol').WorkflowAcceptedAuthorizationV1;
        signal?: AbortSignal;
      }>) => ({
        surface: 'agent' as const,
        authority: 'account_automation' as const,
        actionCaller: {
          kind: 'workflowRun' as const,
          runId: execution.runId,
          authorization: execution.authorization,
        },
        callerPermissionMode: execution.authorization.admittedPermissionCeiling,
        ...(execution.signal ? { signal: execution.signal } : {}),
      });
      const resolveConversation = async ({ sessionId, machineId, signal }: Readonly<{
        sessionId: string;
        machineId: string;
        signal?: AbortSignal;
      }>) => {
        if (machineId !== input.machineId) return null;
        const target = await resolveSessionTransportContext({
          credentials: params.credentials,
          idOrPrefix: sessionId,
          ...(signal ? { signal } : {}),
        });
        if (!target.ok) return null;
        const summary = summarizeSessionRecord({
          credentials: params.credentials,
          accountEncryptionMode: target.accountEncryptionCurrentness.mode,
          session: target.rawSession,
        });
        return summary.path
          ? { sessionId: target.sessionId, machineId: input.machineId, directory: summary.path }
          : null;
      };
      return createProductionWorkflowRunCoordinator({
        token: params.credentials.token,
        accountId: params.accountId,
        machineId: input.machineId,
        resolveAccountEncryption: async (signal) => await resolveAvailableEncryption(params.credentials, signal),
        isAcceptedAuthorizationCurrent,
        resolveCurrentWorkspaceRefs: async () => {
          const settings = await bootstrapAccountSettingsContext({
            credentials: params.credentials,
            mode: 'blocking',
            refresh: 'force',
          });
          return settings.settings.workspaceRefsV1;
        },
        execution: {
          credentials: params.credentials,
          serverId,
          resolveMachineOperationProtocolCapabilities,
          machineAdmissionTransport: input.machineAdmissionTransport,
          ...(resolveTeamCredentialResourceCatalog ? { resolveTeamCredentialResourceCatalog } : {}),
          resolveExistingSessionConversation: resolveConversation,
          detachedRun: { actionExecutor, buildActionContext },
          attachedRun: {
            actionExecutor,
            buildActionContext,
            sendInput: async ({ sessionId, runId, workflowRunId, invocationRecordId, text, references, attachments, resultContract, permissionMode, sourceAuthority, modelSelectionInput, signal }) => {
              const machineOperationProtocolCapabilities =
                await resolveMachineOperationProtocolCapabilities(signal);
              const admission = await enqueueWorkflowSessionInput({
                credentials: params.credentials,
                sessionId,
                machineOperationProtocolCapabilities,
                workflow: {
                  purpose: 'invocation',
                  runId: workflowRunId,
                  invocationRecordId,
                },
                executionRunTarget: { runId, resultContract },
                text,
                mentions: references,
                attachments,
                permissionMode,
                ...(sourceAuthority ? { sourceAuthority } : {}),
                ...(modelSelectionInput?.ref === undefined
                  ? {}
                  : { modelSelectionInput: modelSelectionInput.ref }),
                machineAdmissionTransport: input.machineAdmissionTransport,
                ...(signal ? { signal } : {}),
              });
              if (admission.status === 'outcomeUnknown') {
                return { kind: 'outcome_uncertain' as const, code: admission.code };
              }
              if (admission.status === 'update_required') {
                return { kind: 'rejected' as const, code: admission.code };
              }
              return admission.status === 'accepted' || admission.status === 'alreadyAccepted'
                ? { kind: 'accepted' as const }
                : { kind: 'rejected' as const, code: admission.code };
            },
          },
        },
        resultDelivery: {
          credentials: params.credentials,
          resolveMachineOperationProtocolCapabilities,
          machineAdmissionTransport: input.machineAdmissionTransport,
        },
      });
    },
    createRecoveryForMachine(input: Readonly<{
      machineId: string;
      machineAdmissionTransport: MachineAdmissionTransport;
    }>) {
      const storage = createWorkflowRunStorageClient({ token: params.credentials.token, machineId: input.machineId });
      const actionExecutor = createCliActionExecutorFromCredentials({
        credentials: params.credentials,
        machineId: input.machineId,
        machineAdmissionTransport: input.machineAdmissionTransport,
      });
      const resolveMachineOperationProtocolCapabilities = async (signal?: AbortSignal) => (
        await readMachineOperationProtocolCapabilitiesV1({
          credentials: params.credentials,
          machineId: input.machineId,
          ...(signal ? { signal } : {}),
        })
      )?.capabilities ?? null;
      return createWorkflowRunRecoveryReader({
        accountId: params.accountId,
        machineId: input.machineId,
        storage,
        resolveAccountEncryption: async (signal) => await resolveAvailableEncryption(params.credentials, signal),
        deliverResult: async ({ runId, sessionId, text, signal }) => {
          const machineOperationProtocolCapabilities =
            await resolveMachineOperationProtocolCapabilities(signal);
          const result = await deliverWorkflowResultToOriginatingSession({
            credentials: params.credentials,
            sessionId,
            machineOperationProtocolCapabilities,
            runId,
            text,
            machineAdmissionTransport: input.machineAdmissionTransport,
            ...(signal ? { signal } : {}),
          });
          const settlement = projectWorkflowResultDeliverySettlement(result.status);
          return {
            status: settlement ?? 'unresolved',
          };
        },
        reconcileInvocation: createWorkflowInvocationRecoveryObserver({
          credentials: params.credentials,
          machineId: input.machineId,
          actionExecutor,
        }),
      });
    },
  };
}
