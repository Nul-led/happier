import { describe, expect, it } from 'vitest';
import { createWorkspaceWritesPolicyPreparation } from './workspaceWritesPolicyPreparation';

describe('native workspace policy preparation', () => {
  it('does not relax a provider before the canonical role mutation is staged', async () => {
    const applied: string[] = [];
    // Native Agent configuration is an external plugin boundary.
    const prepare = createWorkspaceWritesPolicyPreparation({ update: async (workspaceWrites) => {
      applied.push(workspaceWrites); return { status: 'applied', timing: 'current_window' };
    } });
    expect(await prepare('allow', { authority: 'present_user', surface: 'ui' })).toEqual({ ok: true });
    expect(applied).toEqual([]);
    expect(await prepare('deny', { authority: 'present_user', surface: 'ui' })).toEqual({ ok: true });
    expect(applied).toEqual(['deny']);
    expect(await prepare('allow')).toEqual({ ok: true });
    expect(applied).toEqual(['deny', 'allow']);
  });
  it('surfaces restart and absent configuration support without admitting a role effect', async () => {
    const restart = createWorkspaceWritesPolicyPreparation({ update: async () => ({ status: 'failed', reason: 'role_policy_restart_required' }) });
    expect(await restart('deny')).toEqual({ ok: false, errorCode: 'role_policy_restart_required' });
    const unavailable = createWorkspaceWritesPolicyPreparation({ update: async () => undefined });
    expect(await unavailable('deny')).toEqual({ ok: false, errorCode: 'role_policy_unenforceable' });
  });
});
