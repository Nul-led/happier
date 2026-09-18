import { readSettings, readStoredCredentials } from '@/persistence';
import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import { configuration } from '@/configuration';
import {
  createDaemonApprovalExecutionOriginCurrentnessFromCredentials,
} from '@/daemon/externalActions/daemonExternalActionTargetResolver';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcActionExecutor } from './_actionDispatchAdapter';
import { APPROVAL_RPC_SCOPES } from './actionSpecRpcRegistration';
import { registerActionSpecRpcHandlers } from './registerActionSpecRpcHandlers';
import type { RpcHandlerContext } from '@/api/rpc/types';

type ApprovalRpcActionExecutor = RpcActionExecutor & Readonly<{
  replayApprovedApprovalRequest?: (args: Readonly<{
    artifactId: string;
    signal?: AbortSignal;
  }>) => Promise<unknown>;
}>;

type RpcRegistrar = Readonly<{
  registerHandler(
    method: string,
    handler: (input: unknown, context?: RpcHandlerContext) => Promise<unknown>,
  ): void;
}>;

async function resolveProductionActionExecutor(): Promise<ApprovalRpcActionExecutor> {
  const credentials = await readStoredCredentials().catch(() => null);
  if (!credentials) {
    return {
      execute: async () => ({
        ok: false,
        errorCode: 'not_authenticated',
        error: 'not_authenticated',
      }),
    };
  }
  const settings = await readSettings().catch(() => null);
  const machineId = typeof settings?.machineId === 'string' && settings.machineId.trim()
    ? settings.machineId.trim()
    : null;
  if (!machineId) {
    return createCliActionExecutorFromCredentials({ credentials });
  }
  const isApprovalExecutionOriginCurrent = createDaemonApprovalExecutionOriginCurrentnessFromCredentials({
    credentials,
    machineId,
    serverId: configuration.activeServerId,
    serverApiUrl: configuration.apiServerUrl,
  });
  return createCliActionExecutorFromCredentials({
    credentials,
    ...(isApprovalExecutionOriginCurrent ? { isApprovalExecutionOriginCurrent } : {}),
  });
}

export function registerApprovalRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcRegistrar;
  actionExecutor?: ApprovalRpcActionExecutor;
}>): void {
  registerActionSpecRpcHandlers({
    rpcHandlerManager: params.rpcHandlerManager,
    actionExecutor: params.actionExecutor,
    resolveActionExecutor: resolveProductionActionExecutor,
    scopes: APPROVAL_RPC_SCOPES,
  });

  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED,
    async (input, context) => {
      const artifactId = input && typeof input === 'object'
        && typeof (input as { artifactId?: unknown }).artifactId === 'string'
        ? (input as { artifactId: string }).artifactId.trim()
        : '';
      if (!artifactId) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      const executor = params.actionExecutor ?? await resolveProductionActionExecutor();
      if (!executor.replayApprovedApprovalRequest) {
        return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action:approvals' };
      }
      return await executor.replayApprovedApprovalRequest({
        artifactId,
        ...(context?.signal ? { signal: context.signal } : {}),
      });
    },
  );
}
