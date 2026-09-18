import type {
  AgentStateRequestResponseTarget,
  AgentStateRequestStoreUnsubscribe,
  AgentStateResponseTargetDispatch,
  AgentStateResponseTargetHandler,
} from '@/agent/permissions/agentStateRequestStore';
import {
  readExecutionRunParentSessionPermissionResponseTarget,
  type ExecutionRunParentSessionPermissionResponseTarget,
} from '@/agent/executionRuns/policy/executionRunPermissionInteractionPolicy';
import type { StructuredQuestionAnswersV1 } from '@happier-dev/protocol';

export type { ExecutionRunParentSessionPermissionResponseTarget };

export type ExecutionRunPermissionRequestStore = Readonly<{
  readOutstandingRequest?(requestId: string): Readonly<{
    responseTarget?: AgentStateRequestResponseTarget;
  }> | null;
  publishRequest(params: Readonly<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
    createdAt: number;
    kind?: string;
    source?: string;
    responseTarget?: AgentStateRequestResponseTarget | null;
    subagentRef?: unknown;
    sidechainId?: string | null;
    permissionSuggestions?: readonly unknown[] | null;
  }>): void;
  publishRequestAndWait?(params: Readonly<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
    createdAt: number;
    kind?: string;
    source?: string;
    responseTarget?: AgentStateRequestResponseTarget | null;
    subagentRef?: unknown;
    sidechainId?: string | null;
    permissionSuggestions?: readonly unknown[] | null;
  }>): Promise<void>;
  completeRequest?(params: Readonly<{
    requestId: string;
    status: string;
    decision?: string;
    reason?: string;
    answers?: StructuredQuestionAnswersV1;
  }>): Promise<boolean> | boolean;
  retireCompletedRequestsForTurn?(turnId: string): Promise<void>;
  registerResponseTargetHandler(
    kind: 'execution_run_host_bridge',
    handler: AgentStateResponseTargetHandler,
  ): AgentStateRequestStoreUnsubscribe;
}>;

export type ExecutionRunPermissionRequestStoreProvider = () => ExecutionRunPermissionRequestStore | null | undefined;

export function readExecutionRunPermissionResponseTargetFromDispatch(
  dispatch: AgentStateResponseTargetDispatch,
): ExecutionRunParentSessionPermissionResponseTarget | null {
  return readExecutionRunParentSessionPermissionResponseTarget(dispatch.responseTarget);
}

export function readExecutionRunPermissionResponseApprovedFromDispatch(
  dispatch: AgentStateResponseTargetDispatch,
): boolean | null {
  const completed = dispatch.completedRequest;
  const status = typeof completed.status === 'string' ? completed.status.trim() : '';
  if (status === 'approved') return true;
  if (status === 'denied' || status === 'canceled' || status === 'cancelled') return false;

  const decision = typeof completed.decision === 'string' ? completed.decision.trim() : '';
  if (
    decision === 'approved'
    || decision === 'approved_for_session'
    || decision === 'approved_execpolicy_amendment'
  ) {
    return true;
  }
  if (decision === 'denied' || decision === 'abort') return false;
  return null;
}
