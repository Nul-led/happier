import { HandoffWorkspaceActionV1Schema } from '@happier-dev/protocol';

/**
 * The pre-0.3 workspaceTransfer payload is intentionally not interpreted by the
 * handoff API anymore.  Keep the boundary diagnostic in one place so every
 * handoff entry point fails closed before it can touch the retired replication
 * engine or stop a source session.
 */
export type WorkspaceSyncUpdateRequired = Readonly<{
  ok: false;
  errorCode: 'workspace_sync_update_required';
  error: string;
}>;

export function workspaceSyncUpdateRequired(): WorkspaceSyncUpdateRequired {
  return {
    ok: false,
    errorCode: 'workspace_sync_update_required',
    error: 'Workspace handoff requires a workspace sync capable client',
  };
}

/**
 * Detect a workspace action that this handoff owner cannot execute.  The
 * canonical workspace-sync adapter owns workspace preparation; until it is
 * available, handoff must reject the action before reading state or stopping
 * the source session.  Legacy reverse-root fields are included because they
 * can still arrive through the released commit compatibility envelope.
 */
export type WorkspaceSyncAdmission = Readonly<
  | { kind: 'none' }
  | { kind: 'canonical' }
  | { kind: 'malformed' }
  | { kind: 'update_required' }
>;

export function classifyWorkspaceSyncAdmission(raw: unknown): WorkspaceSyncAdmission {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'none' };
  const value = raw as Readonly<Record<string, unknown>>;
  if (Object.prototype.hasOwnProperty.call(value, 'workspaceTransfer')) return { kind: 'update_required' };
  if (Object.prototype.hasOwnProperty.call(value, 'workspaceReplicationReverseSourceRootPath')
    || Object.prototype.hasOwnProperty.call(value, 'workspaceReplicationReverseTargetRootPath')) {
    return { kind: 'update_required' };
  }

  const action = value.workspaceAction;
  if (action === undefined) return { kind: 'none' };
  return HandoffWorkspaceActionV1Schema.safeParse(action).success
    ? { kind: 'canonical' }
    : { kind: 'malformed' };
}

export function hasUnsupportedWorkspaceAction(raw: unknown): boolean {
  return classifyWorkspaceSyncAdmission(raw).kind === 'update_required';
}
