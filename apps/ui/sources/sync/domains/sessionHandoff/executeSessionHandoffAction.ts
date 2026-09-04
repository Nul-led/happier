import {
  SessionHandoffActionResultV1Schema,
  type ActionExecuteResult,
  type ActionExecutorContext,
  type HandoffWorkspaceActionV1,
  type SessionHandoffActionResultV1,
} from '@happier-dev/protocol';

type ExecuteAction = (actionId: 'session.handoff', input: unknown, context?: ActionExecutorContext) => Promise<ActionExecuteResult>;

type ExecuteSessionHandoffActionArgs = Readonly<{
  execute: ExecuteAction;
  sessionId: string;
  targetMachineId: string;
  targetPath?: string;
  targetSessionStorageMode?: 'direct' | 'persisted';
  workspaceAction?: HandoffWorkspaceActionV1;
  context: ActionExecutorContext;
}>;

export type ExecuteSessionHandoffActionResult =
  | Readonly<{ ok: true; result: SessionHandoffActionResultV1 }>
  | Readonly<{ ok: false; error: string; recovery?: unknown }>;

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    },
    args.context,
  );
  if (!actionResult.ok) {
    return { ok: false, error: normalizeNonEmptyString(actionResult.error) ?? 'failed_to_start_session_handoff' };
  }

  const terminalResult = SessionHandoffActionResultV1Schema.safeParse(actionResult.result);
  return terminalResult.success
    ? { ok: true, result: terminalResult.data }
    : { ok: false, error: 'unsupported_session_handoff_result' };
}
