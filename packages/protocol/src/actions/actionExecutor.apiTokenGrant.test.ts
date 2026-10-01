import { describe, expect, it, vi } from 'vitest';
import { createActionExecutor } from './actionExecutor.js';
import type { ActionExecutorContext, ActionExecutorDeps } from './executor/types.js';
import { buildBackendTargetKeyV2 } from '../backends/targets/backendTargetRefV2.js';
import { buildSessionPermissionRespondRpcParamsV1, type SessionPermissionRespondRpcParamsV1 } from '../sessions/permissions/respondRpcParamsV1.js';

function context(ids: string[], sessions = ['s1']): ActionExecutorContext {
  return {
    surface: 'api', authority: 'account_automation', defaultSessionId: sessions[0],
    externalActionCredential: { accountId: 'a1', principalId: 't1', credentialId: 't1', grant: {
      v: 1, actions: { families: [], ids }, targets: { sessions, machines: [] }, approve: false,
      origins: [], models: null, permissionModes: null, create: null,
    } },
  };
}

describe('ActionExecutor API token grant admission', () => {
  it.each(['approved_for_session', 'abort'] as const)('preserves %s and response metadata at the Session RPC boundary', async (decision) => {
    const requests: SessionPermissionRespondRpcParamsV1[] = [];
    const sessionPermissionRespond: NonNullable<ActionExecutorDeps['sessionPermissionRespond']> = async (args) => {
      requests.push(buildSessionPermissionRespondRpcParamsV1({
        id: args.requestId, turnId: args.turnId,
        decision: args.decision,
        ...('mode' in args ? { mode: args.mode } : {}),
        ...('reason' in args ? { reason: args.reason } : {}),
      }));
      return { ok: true };
    };
    const executor = createActionExecutor({ sessionPermissionRespond } as unknown as ActionExecutorDeps);
    const ctx = context(['session.title.set']);
    if (!ctx.externalActionCredential?.grant) throw new Error('Expected grant');
    ctx.externalActionCredential.grant.approve = true;
    expect(await executor.execute('session.permission.respond', {
      sessionId: 's1', requestId: 'permission-one', turnId: 'turn-one', decision, mode: 'plan', reason: 'human choice',
    }, ctx)).toMatchObject({ ok: true });
    expect(requests).toEqual([{ id: 'permission-one', turnId: 'turn-one', approved: decision !== 'abort',
      decision, mode: 'plan', reason: 'human choice' }]);
  });

  it('checks the parsed spawn binding before dispatch and carries verified launch authorization', async () => {
    const sessionSpawnNew = vi.fn(async () => ({ type: 'success' as const, disposition: 'created' as const,
      sessionId: 'new-session', executionTarget: { serverId: 'home', machineId: 'm1' },
      organizationPlacement: { folderId: 'leads', tagIds: ['inbound'] }, initialInput: { status: 'notRequested' as const } }));
    const executor = createActionExecutor({ sessionSpawnNew } as unknown as ActionExecutorDeps);
    const agentTarget = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.codex', localId: 'codex' } };
    const spawnInput = {
      creationKey: 'create-one',
      directory: { kind: 'managed' as const }, agentTarget,
      organizationPlacement: { folderId: 'leads', tagIds: ['inbound'] },
    };
    const ctx = context(['session.spawn_new']);
    ctx.serverId = 'home';
    if (!ctx.externalActionCredential?.grant) throw new Error('expected grant');
    ctx.externalActionTarget = { kind: 'machine', machineId: 'm1' };
    ctx.externalActionCredential.grant.create = {
      machineId: 'm1', agentTargetKey: buildBackendTargetKeyV2(agentTarget), directory: 'managed',
      placement: spawnInput.organizationPlacement,
    };
    ctx.externalActionExecutionAuthorization = {
      v: 1, token: 'verified-creation-token', binding: {
        ...ctx.externalActionCredential, serverIdentityId: 'home', machineId: 'm1',
        actionId: 'session.spawn_new', requestId: 'request-one', requestEnvelopeDigest: 'a'.repeat(43),
        target: ctx.externalActionTarget,
      },
    };
    expect(await executor.execute('session.spawn_new', { ...spawnInput, directory: { kind: 'path', path: '/workspace/elsewhere' } }, ctx))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied', details: { reason: 'create_not_granted' } });
    expect(sessionSpawnNew).not.toHaveBeenCalled();
    expect(await executor.execute('session.spawn_new', spawnInput, ctx)).toMatchObject({ ok: true });
    expect(sessionSpawnNew).toHaveBeenCalledWith(expect.objectContaining({
      creationAuthorization: { token: 'verified-creation-token' },
    }));
  });

  it('requires the exact qualified contributed Action id rather than a family grant', async () => {
    const invokeContributedAction = vi.fn(async () => ({ ok: true as const, result: { done: true } }));
    const executor = createActionExecutor({ invokeContributedAction } as unknown as ActionExecutorDeps);
    const input = { action: { pluginId: 'acme.leads', localId: 'update' }, input: {} };
    const ctx = context(['action.invoke']);
    expect(await executor.execute('action.invoke', input, ctx)).toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(invokeContributedAction).not.toHaveBeenCalled();
    if (!ctx.externalActionCredential?.grant) throw new Error('expected grant');
    ctx.externalActionCredential.grant.actions = { families: [], ids: ['acme.leads/actions/update'] };
    expect(await executor.execute('action.invoke', input, ctx)).toMatchObject({ ok: true });
    expect(invokeContributedAction).toHaveBeenCalledOnce();
  });

  it('refuses an ungranted action at prepare and execute before any host dependency', async () => {
    const sessionTitleSet = vi.fn(async () => ({}));
    // Dependencies model host transports. Unused required ports are unreachable in these slices.
    const executor = createActionExecutor({ sessionTitleSet } as unknown as ActionExecutorDeps);
    const ctx = context(['session.message.send']);
    expect(await executor.execute('session.title.set', { sessionId: 's1', title: 'hello' }, ctx))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(await executor.prepare('session.title.set', { sessionId: 's1', title: 'hello' }, ctx))
      .toMatchObject({ kind: 'settled', result: { ok: false, errorCode: 'credential_scope_denied' } });
    expect(sessionTitleSet).not.toHaveBeenCalled();
  });

  it('rechecks the credential grant when a prepared invocation starts', async () => {
    const sessionTitleSet = vi.fn(async () => ({ ok: true }));
    const executor = createActionExecutor({ sessionTitleSet } as unknown as ActionExecutorDeps);
    const ctx = context(['session.title.set']);
    const prepared = await executor.prepare('session.title.set', { sessionId: 's1', title: 'hello' }, ctx);
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready' || !ctx.externalActionCredential?.grant) throw new Error('Expected prepared grant');
    ctx.externalActionCredential.grant.actions = { families: [], ids: ['session.message.send'] };
    expect(await prepared.invocation.run()).toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(sessionTitleSet).not.toHaveBeenCalled();
  });

  it('filters discovery and refuses schemas and options for an ungranted action', async () => {
    const executor = createActionExecutor({} as ActionExecutorDeps);
    const ctx = context(['session.message.send']);
    const result = await executor.execute('action.spec.search', { query: 'session', limit: 100 }, ctx);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected discovery');
    expect(result.result).toMatchObject({ actionSpecs: expect.arrayContaining([expect.objectContaining({ id: 'session.message.send' })]) });
    expect(result.result).not.toMatchObject({ actionSpecs: expect.arrayContaining([expect.objectContaining({ id: 'session.title.set' })]) });
    expect(await executor.execute('action.spec.get', { id: 'session.title.set' }, ctx))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(await executor.execute('action.options.resolve', { actionId: 'session.spawn_new', fieldPath: 'permissionMode' }, ctx))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
  });

  it('refuses a permission mode outside the per-input grant before the setter', async () => {
    const sessionPermissionModeSet = vi.fn(async () => ({}));
    const executor = createActionExecutor({ sessionPermissionModeSet } as unknown as ActionExecutorDeps);
    const ctx = context(['session.permission_mode.set']);
    if (!ctx.externalActionCredential?.grant) throw new Error('expected grant');
    ctx.externalActionCredential.grant.permissionModes = ['default'];
    expect(await executor.execute('session.permission_mode.set', { sessionId: 's1', permissionMode: 'bypassPermissions' }, ctx))
      .toMatchObject({ ok: false, errorCode: 'permission_mode_not_granted' });
    expect(sessionPermissionModeSet).not.toHaveBeenCalled();
  });

  it('does not disclose dynamic options through an unbound source id', async () => {
    const agentsBackendsList = vi.fn(async () => ({ items: [] }));
    const executor = createActionExecutor({ agentsBackendsList } as unknown as ActionExecutorDeps);
    expect(await executor.execute('action.options.resolve', { optionsSourceId: 'agents.backends.enabled' }, context(['session.title.set'])))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(await executor.execute('action.options.resolve', {
      optionsSourceId: 'agents.backends.enabled', fieldPath: 'agentTarget',
    }, context(['session.title.set'])))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(await executor.execute('action.options.resolve', {
      actionId: 'session.title.set', fieldPath: 'title', optionsSourceId: 'agents.backends.enabled',
    }, context(['session.title.set'])))
      .toMatchObject({ ok: false, errorCode: 'credential_scope_denied' });
    expect(agentsBackendsList).not.toHaveBeenCalled();
  });
});
