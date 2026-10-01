import { randomUUID } from 'node:crypto';
import {
  SessionRolesConfigurationSetRpcV1Schema,
  readSessionRolesV1, readSessionWorkspaceWritesV1, resolveRoleSelectionV1, writeSessionRoleConfigurationV1ToMetadata,
  type RoleInstructionsOverrideV1,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import type { RegisteredSessionStateFieldMutationV1 } from '@/api/session/client/transport/mutations/sessionClientDurableMutationTypes';
import type { RoleSourceReader } from '@/session/roles/roleSources';
import type { RoleWorkspaceWritesPolicyPreparer } from '@/session/actions/roleActions';

/** Remote role copies enter the same registered configuration outbox as local edits. */
export function registerSessionRoleConfigurationHandler(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  sessionId: string;
  readSessionMetadata: () => unknown;
  stageSessionStateMutation?: (mutation: RegisteredSessionStateFieldMutationV1) => Promise<void>;
  readRoleSources?: RoleSourceReader;
  prepareWorkspaceWritesPolicy?: RoleWorkspaceWritesPolicyPreparer;
  readSettingsOverrides?: () => Readonly<Record<string, RoleInstructionsOverrideV1>> | Promise<Readonly<Record<string, RoleInstructionsOverrideV1>>>;
}>): void {
  params.rpcHandlerManager.registerHandler(SESSION_RPC_METHODS.SESSION_ROLES_CONFIGURATION_SET, async (input: unknown, context) => {
    const request = SessionRolesConfigurationSetRpcV1Schema.parse(input);
    if (request.sessionId !== params.sessionId || !params.stageSessionStateMutation) {
      return { ok: false, errorCode: 'session_target_unavailable', error: 'session_target_unavailable' };
    }
    const authority = context?.callerAuthority ?? context?.localActionContext?.authority;
    if (!authority) return { ok: false, errorCode: 'permission_denied', error: 'permission_denied' };
    context?.signal.throwIfAborted();
    const metadata = params.readSessionMetadata();
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return { ok: false, errorCode: 'session_target_unavailable', error: 'session_target_unavailable' };
    }
    // The metadata owner validates both the existing shape and the replacement before enqueue.
    const nextMetadata = writeSessionRoleConfigurationV1ToMetadata(metadata as Record<string, unknown>, request.configuration);
    const entries = await params.readRoleSources?.(context?.signal) ?? [];
    const settingsRoles = Object.fromEntries(entries.map((entry) => [entry.roleId, entry.role]));
    const settingsOverrides = await params.readSettingsOverrides?.();
    if (authority !== 'present_user') {
      const current = readSessionRolesV1(metadata);
      if (readSessionWorkspaceWritesV1(metadata, { settingsRoles, settingsOverrides }) === 'deny'
        && readSessionWorkspaceWritesV1(nextMetadata, { settingsRoles, settingsOverrides }) !== 'deny') {
        return { ok: false, errorCode: 'role_policy_denied', error: 'role_policy_denied' };
      }
      const roleIds = new Set([...Object.keys(current?.overrides ?? {}), ...Object.keys(current?.sessionRoles ?? {}),
        ...(current?.roleId ? [current.roleId] : [])]);
      for (const roleId of roleIds) {
        const before = resolveRoleSelectionV1({ roleId, settingsRoles, settingsOverrides, sessionRoles: current ?? undefined });
        const after = resolveRoleSelectionV1({ roleId, settingsRoles, settingsOverrides, sessionRoles: request.configuration });
        if (before.ok && before.selection.workspaceWrites === 'deny' && (!after.ok || after.selection.workspaceWrites !== 'deny')) {
          return { ok: false, errorCode: 'role_policy_denied', error: 'role_policy_denied' };
        }
      }
    }
    context?.signal.throwIfAborted();
    const workspaceWrites = readSessionWorkspaceWritesV1(nextMetadata, { settingsRoles, settingsOverrides });
    const previousWorkspaceWrites = readSessionWorkspaceWritesV1(metadata, { settingsRoles, settingsOverrides });
    // Never relax native policy until the registered metadata owner has accepted
    // the new configuration and the host synchronizes at prompt admission.
    if (workspaceWrites === 'deny' && previousWorkspaceWrites !== 'deny' && params.prepareWorkspaceWritesPolicy) {
      const prepared = await params.prepareWorkspaceWritesPolicy(workspaceWrites, {
        authority, surface: context?.localActionContext?.surface ?? 'rpc', ...(context?.signal ? { signal: context.signal } : {}),
      });
      if (!prepared.ok) return { ok: false, errorCode: prepared.errorCode, error: prepared.errorCode };
    } else if (workspaceWrites === 'deny' && previousWorkspaceWrites !== 'deny') {
      return { ok: false, errorCode: 'role_policy_unenforceable', error: 'role_policy_unenforceable' };
    }
    await params.stageSessionStateMutation({ v: 1, sessionId: params.sessionId, mutationId: randomUUID(),
      fieldId: 'intent.sessionRoles', deliveryClass: 'durable_required', op: { kind: 'set', value: request.configuration },
      source: authority === 'present_user' ? 'ui' : 'runtime', observedAt: Date.now() });
    return { updated: true };
  });
}
