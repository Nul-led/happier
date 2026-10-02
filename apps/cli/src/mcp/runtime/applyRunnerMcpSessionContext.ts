import type { Metadata, PermissionMode } from '@/api/types';
import type { AgentCompositionToolSelection } from '@/plugins/runtime/hooks/execution/dispatchAgentTurnHooks';
import type {
  BackendTargetRefV2,
} from '@happier-dev/protocol';
import type { RuntimeActiveTurnPermissionWitness } from '@/agent/runtime/turns/runtimeTurnOperations';
import type { ResolvedRolesSnapshotV1 } from '@happier-dev/protocol';
import type { RoleSourceReader } from '@/session/roles/roleSources';
type WorkspaceWritesPolicyPreparation = (workspaceWrites: 'allow' | 'deny', context: import('@happier-dev/protocol').ActionExecutorContext) => Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; errorCode: string }>>;

export type RunnerMcpSessionContextAccessors = Readonly<{
  getCurrentResolvedRoles?: () => ResolvedRolesSnapshotV1;
  readRoleSources?: RoleSourceReader;
  getCurrentWorkspaceWrites?: () => 'allow' | 'deny' | undefined;
  prepareWorkspaceWritesPolicy?: WorkspaceWritesPolicyPreparation;
  getPermissionMode?: (() => PermissionMode | null | undefined) | null;
  getActiveTurnPermissionWitness?: (() => RuntimeActiveTurnPermissionWitness | null | undefined) | null;
  getActiveTurnAdmissionWitness?: (() => import('@/plugins/runtime/invocation/services/types').AgentInvocationTurnAdmissionWitness | null) | null;
  getRuntimeLifetimeSignal?: (() => AbortSignal | null | undefined) | null;
  getBackendTarget?: (() => BackendTargetRefV2 | null | undefined) | null;
  getCurrentSessionLocation?: (() => Readonly<{
    path?: string | null;
    host?: string | null;
    machineId?: string | null;
  }> | null | undefined) | null;
  getActiveAgentCompositionToolSelection?: (() => AgentCompositionToolSelection | null | undefined) | null;
}>;

export type RunnerMcpSessionWithContext<TSession> = TSession & {
  getCurrentResolvedRoles?: () => ResolvedRolesSnapshotV1;
  readRoleSources?: RoleSourceReader;
  getCurrentWorkspaceWrites?: () => 'allow' | 'deny' | undefined;
  prepareWorkspaceWritesPolicy?: WorkspaceWritesPolicyPreparation;
  getMetadataSnapshot?: () => Metadata | null;
  getPermissionMode?: () => PermissionMode | null | undefined;
  getActiveTurnPermissionWitness?: () => RuntimeActiveTurnPermissionWitness | null | undefined;
  getActiveTurnAdmissionWitness?: () => import('@/plugins/runtime/invocation/services/types').AgentInvocationTurnAdmissionWitness | null;
  getRuntimeLifetimeSignal?: () => AbortSignal | null | undefined;
  getBackendTarget?: () => BackendTargetRefV2 | null | undefined;
  getCurrentSessionLocation?: () => Readonly<{
    path?: string | null;
    host?: string | null;
    machineId?: string | null;
  }> | null | undefined;
  getActiveAgentCompositionToolSelection?: () => AgentCompositionToolSelection | null | undefined;
};

export function applyRunnerMcpSessionContext<TSession extends object>(
  session: TSession,
  accessors: RunnerMcpSessionContextAccessors,
): RunnerMcpSessionWithContext<TSession> {
  const target = session as RunnerMcpSessionWithContext<TSession>;
  if (accessors.getCurrentResolvedRoles) target.getCurrentResolvedRoles = accessors.getCurrentResolvedRoles;
  if (accessors.readRoleSources) target.readRoleSources = accessors.readRoleSources;
  if (accessors.getCurrentWorkspaceWrites) target.getCurrentWorkspaceWrites = accessors.getCurrentWorkspaceWrites;
  if (accessors.prepareWorkspaceWritesPolicy) target.prepareWorkspaceWritesPolicy = accessors.prepareWorkspaceWritesPolicy;
  if (accessors.getPermissionMode) {
    target.getPermissionMode = accessors.getPermissionMode;
  }
  if (accessors.getActiveTurnPermissionWitness) {
    target.getActiveTurnPermissionWitness = accessors.getActiveTurnPermissionWitness;
  }
  if (accessors.getActiveTurnAdmissionWitness) {
    target.getActiveTurnAdmissionWitness = accessors.getActiveTurnAdmissionWitness;
  }
  if (accessors.getRuntimeLifetimeSignal) {
    target.getRuntimeLifetimeSignal = accessors.getRuntimeLifetimeSignal;
  }
  if (accessors.getBackendTarget) {
    target.getBackendTarget = accessors.getBackendTarget;
  }
  if (accessors.getCurrentSessionLocation) {
    target.getCurrentSessionLocation = accessors.getCurrentSessionLocation;
  }
  if (accessors.getActiveAgentCompositionToolSelection) {
    target.getActiveAgentCompositionToolSelection = accessors.getActiveAgentCompositionToolSelection;
  }
  return target;
}
