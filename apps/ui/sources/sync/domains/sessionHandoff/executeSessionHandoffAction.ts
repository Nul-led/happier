import type {
  ActionExecuteResult,
  ActionExecutorContext,
  HandoffWorkspaceActionV1,
} from '@happier-dev/protocol';

type ExecuteAction = (actionId: 'session.handoff', input: unknown, context?: ActionExecutorContext) => Promise<ActionExecuteResult>;

type ExecuteSessionHandoffActionArgs = Readonly<{
  execute: ExecuteAction;
  sessionId: string;
  targetMachineId: string;
  targetPath?: string;
  targetSessionStorageMode?: 'direct' | 'persisted';
  workspaceAction?: HandoffWorkspaceActionV1;
  workspaceSyncSourceWorkspaceRefId?: string;
  workspaceSyncTargetWorkspaceRefId?: string;
  workspaceSyncSettingsVersion?: number;
  context: ActionExecutorContext;
}>;

export type ExecuteSessionHandoffActionResult =
  | Readonly<{ ok: true; handoffId: string }>
  | Readonly<{ ok: false; error: string; recovery?: unknown }>;

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export async function executeSessionHandoffAction(
  args: ExecuteSessionHandoffActionArgs,
): Promise<ExecuteSessionHandoffActionResult> {
  const actionResult = await args.execute(
    'session.handoff',
    {
      sessionId: args.sessionId,
      targetMachineId: args.targetMachineId,
      ...(args.targetPath ? { targetPath: args.targetPath } : {}),
      ...(args.targetSessionStorageMode ? { targetSessionStorageMode: args.targetSessionStorageMode } : {}),
      ...(args.workspaceAction ? { workspaceAction: args.workspaceAction } : {}),
      ...(args.workspaceSyncSourceWorkspaceRefId
        ? { workspaceSyncSourceWorkspaceRefId: args.workspaceSyncSourceWorkspaceRefId }
        : {}),
      ...(args.workspaceSyncTargetWorkspaceRefId
        ? { workspaceSyncTargetWorkspaceRefId: args.workspaceSyncTargetWorkspaceRefId }
        : {}),
      ...(args.workspaceSyncSettingsVersion === undefined
        ? {}
        : { workspaceSyncSettingsVersion: args.workspaceSyncSettingsVersion }),
    },
    args.context,
  );
  if (!actionResult.ok) {
    return { ok: false, error: normalizeNonEmptyString(actionResult.error) ?? 'failed_to_start_session_handoff' };
  }

  const handoffResult = readRecord(actionResult.result);
  if (handoffResult?.ok !== true) {
    return {
      ok: false,
      error:
        normalizeNonEmptyString(handoffResult?.errorMessage)
        ?? normalizeNonEmptyString(handoffResult?.error)
        ?? 'failed_to_start_session_handoff',
      ...(handoffResult?.recovery ? { recovery: handoffResult.recovery } : {}),
    };
  }

  const handoffId = normalizeNonEmptyString(handoffResult?.handoffId);
  if (!handoffId) {
    return { ok: false, error: 'failed_to_start_session_handoff' };
  }

  return { ok: true, handoffId };
}
