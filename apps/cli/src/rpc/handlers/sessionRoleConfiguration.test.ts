import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES_V1 } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { Metadata } from '@/api/types';
import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import type { RpcHandler, RpcHandlerContext } from '@/api/rpc/types';
import { applyRegisteredSessionStateFieldMutationToMetadata } from '@/api/session/client/transport/mutations/applyRegisteredSessionStateFieldMutation';
import { registerSessionRoleConfigurationHandler } from './sessionRoleConfiguration';

describe('session role configuration RPC', () => {
  it('does not relax native policy before a remote user configuration is durably accepted', async () => {
    let nativePolicy: 'allow' | 'deny' = 'deny';
    const metadata: Metadata = { ...createTestMetadata(), work: { sessionRolesV1: { roleId: 'builder',
      overrides: { builder: { roleId: 'builder', workspaceWrites: 'deny' } }, sessionRoles: {}, notes: '' } } };
    const handlers = new Map<string, RpcHandler>();
    registerSessionRoleConfigurationHandler({ rpcHandlerManager: { registerHandler: (method, handler) => { handlers.set(method, handler); } },
      sessionId: 'child', readSessionMetadata: () => metadata,
      prepareWorkspaceWritesPolicy: async (policy) => { nativePolicy = policy; return { ok: true }; },
      stageSessionStateMutation: async () => { throw new Error('Durable enqueue failed'); },
    });
    const handler = handlers.get(SESSION_RPC_METHODS.SESSION_ROLES_CONFIGURATION_SET)!;
    await expect(handler({ sessionId: 'child', configuration: { overrides: {}, sessionRoles: {}, notes: 'Copied' } },
      { signal: new AbortController().signal, callerAuthority: 'present_user' })).rejects.toThrow('Durable enqueue failed');
    expect(nativePolicy).toBe('deny');
    expect(metadata.work).toMatchObject({ sessionRolesV1: { overrides: { builder: { workspaceWrites: 'deny' } } } });
  });

  it('uses the registered outbox, preserves current role, and rejects unproved or automated relaxation', async () => {
    let metadata: Metadata = { ...createTestMetadata(), work: { sessionRolesV1: { roleId: 'builder', overrides: { builder: { roleId: 'builder', workspaceWrites: 'deny' } },
      sessionRoles: {}, notes: 'Original' } } };
    const handlers = new Map<string, RpcHandler>();
    registerSessionRoleConfigurationHandler({ rpcHandlerManager: { registerHandler: (method, handler) => { handlers.set(method, handler); } },
      sessionId: 'child', readSessionMetadata: () => metadata,
      prepareWorkspaceWritesPolicy: async () => ({ ok: true }),
      stageSessionStateMutation: async (mutation) => { metadata = applyRegisteredSessionStateFieldMutationToMetadata(metadata, mutation); } });
    const handler = handlers.get(SESSION_RPC_METHODS.SESSION_ROLES_CONFIGURATION_SET)!;
    const request = { sessionId: 'child', configuration: { inheritedFrom: 'lead', overrides: {},
      sessionRoles: { builder: { ...BUILT_IN_ROLES_V1.builder, roleId: 'builder' } }, notes: 'Copied' } };
    expect(await handler(request)).toMatchObject({ ok: false, errorCode: 'permission_denied' });
    const context: RpcHandlerContext = { signal: new AbortController().signal, callerAuthority: 'account_automation' };
    expect(await handler(request, context)).toMatchObject({ ok: false, errorCode: 'role_policy_denied' });
    expect(metadata.work).toMatchObject({ sessionRolesV1: { notes: 'Original' } });
    expect(await handler(request, { ...context, callerAuthority: 'present_user' })).toEqual({ updated: true });
    expect(metadata.work).toMatchObject({ sessionRolesV1: { roleId: 'builder', inheritedFrom: 'lead', notes: 'Copied', overrides: {} } });
    expect(await handler({ ...request, sessionId: 'other' }, { ...context, callerAuthority: 'present_user' }))
      .toMatchObject({ ok: false, errorCode: 'session_target_unavailable' });
  });
});
