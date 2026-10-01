import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { ActionIdSchema } from './actionIds.js';

function createExecutor(overrides: Partial<ActionExecutorDeps> = {}) {
  // Dependencies represent host transport/effect boundaries; internal admission stays real.
  return createActionExecutor({ isActionApprovalRequired: () => false, ...overrides } as ActionExecutorDeps);
}

describe('hands-off Action admission', () => {
  it('admits session role edits only for the agent own or server-proved led sessions', async () => {
    const roleActionExecute = vi.fn(async () => ({ updated: true }));
    const executor = createExecutor({ roleActionExecute });
    const context = { surface: 'agent' as const, defaultSessionId: 'self', workspaceWrites: 'allow' as const,
      agentStartContext: { caller: { kind: 'session' as const, sessionId: 'self', starterDepth: 0, turnDepth: 0 },
        baseline: { machineId: 'machine-1', directory: '/repo' }, ledSubtreeSessionIds: ['report'],
        workDepthLimit: 4, roles: {}, callerPermissionCeiling: 'default' as const } };
    await expect(executor.execute('session.notes.set', { sessionId: 'unrelated', notes: 'task' }, context))
      .resolves.toMatchObject({ ok: false, errorCode: 'subtree_denied' });
    expect(roleActionExecute).not.toHaveBeenCalled();
    await expect(executor.execute('session.notes.set', { sessionId: 'report', notes: 'task' }, context))
      .resolves.toMatchObject({ ok: true });
  });
  it('rechecks the live workspace ceiling when a prepared invocation finally dispatches', async () => {
    let workspaceWrites: 'allow' | 'deny' = 'allow';
    const scmActionExecute = vi.fn(async () => ({ success: true, alreadyInitialized: false }));
    const executor = createExecutor({ scmActionExecute, getCurrentWorkspaceWrites: () => workspaceWrites });
    const prepared = await executor.prepare('scm.repository.init', { cwd: '/repo' }, { surface: 'rpc', workspaceWrites: 'allow', bypassApprovals: true });
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') throw new Error('Expected an admitted invocation');
    workspaceWrites = 'deny';
    await expect(prepared.invocation.run()).resolves.toMatchObject({ ok: false, errorCode: 'workspace_write_denied' });
    expect(scmActionExecute).not.toHaveBeenCalled();
  });
  it('refuses a workspace-writing Action before approval and preserves read Actions', async () => {
    const scmActionExecute = vi.fn(async () => ({ success: true, alreadyInitialized: false }));
    const executor = createExecutor({ scmActionExecute, machinesList: async () => ({ items: [] }) });
    await expect(executor.execute('scm.repository.init', { cwd: '/repo' }, {
      surface: 'rpc', workspaceWrites: 'deny', bypassApprovals: true,
    })).resolves.toMatchObject({ ok: false, errorCode: 'workspace_write_denied' });
    expect(scmActionExecute).not.toHaveBeenCalled();
    await expect(executor.execute('machines.list', {}, {
      surface: 'cli', workspaceWrites: 'deny',
    })).resolves.toMatchObject({ ok: true, result: { items: [] } });
  });

  it('an agent cannot relax hands-off on its own session, even with approval bypass', async () => {
    const executor = createExecutor();
    await expect(executor.execute(ActionIdSchema.parse('session.roles.override.set'), {
      sessionId: 'self', roleId: 'orchestrator', workspaceWrites: 'allow',
    }, {
      surface: 'agent', defaultSessionId: 'self', workspaceWrites: 'deny', bypassApprovals: true,
    })).resolves.toMatchObject({ ok: false, errorCode: 'workspace_write_escalation_denied' });
  });

  it('allows an agent to tighten and a present user to relax through the role owner', async () => {
    const roleActionExecute = vi.fn(async () => ({ updated: true }));
    const executor = createExecutor({ roleActionExecute });
    await expect(executor.execute('session.roles.override.set', {
      sessionId: 'self', roleId: 'builder', workspaceWrites: 'deny',
    }, {
      surface: 'agent', defaultSessionId: 'self', workspaceWrites: 'allow',
      agentStartContext: { caller: { kind: 'session', sessionId: 'self', starterDepth: 0, turnDepth: 0 },
        baseline: { machineId: 'machine-1', directory: '/repo' }, ledSubtreeSessionIds: [],
        workDepthLimit: 4, roles: {}, callerPermissionCeiling: 'default' },
    })).resolves.toMatchObject({ ok: true, result: { updated: true } });
    await expect(executor.execute('session.roles.override.set', {
      sessionId: 'self', roleId: 'builder', workspaceWrites: 'allow',
    }, {
      surface: 'ui', defaultSessionId: 'self', workspaceWrites: 'deny',
    })).resolves.toMatchObject({ ok: true, result: { updated: true } });
  });

  it('refuses workspace effects at prepare admission before creating an approval', async () => {
    const approvalsCreate = vi.fn(async () => ({ artifactId: 'approval' }));
    const scmActionExecute = vi.fn();
    const executor = createExecutor({ approvalsCreate, scmActionExecute, isActionApprovalRequired: () => true });
    await expect(executor.prepare('scm.repository.init', { cwd: '/repo' }, {
      surface: 'rpc', workspaceWrites: 'deny',
    })).resolves.toMatchObject({ kind: 'settled', result: { ok: false, errorCode: 'workspace_write_denied' } });
    expect(approvalsCreate).not.toHaveBeenCalled();
    expect(scmActionExecute).not.toHaveBeenCalled();
  });
});
