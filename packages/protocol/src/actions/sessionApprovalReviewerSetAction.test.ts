import { describe, expect, it, vi } from 'vitest';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { ActionIdSchema } from './actionIds.js';

describe('session.approval_reviewer.set authority', () => {
  it('allows a present Account user and refuses an agent even with approval bypass', async () => {
    const write = vi.fn(async () => ({ updated: true }));
    // Host metadata persistence is the external boundary; Action admission is real.
    const executor = createActionExecutor({ isActionApprovalRequired: () => false, sessionApprovalReviewerSet: write } as ActionExecutorDeps);
    const id = ActionIdSchema.parse('session.approval_reviewer.set');
    const input = { sessionId: 'session', enabled: true };
    await expect(executor.execute(id, input, { surface: 'agent', bypassApprovals: true })).resolves.toMatchObject({ ok: false });
    await expect(executor.execute(id, input, { surface: 'cli', authority: 'account_automation', bypassApprovals: true })).resolves.toMatchObject({ ok: false });
    expect(write).not.toHaveBeenCalled();
    await expect(executor.execute(id, input, { surface: 'ui', authority: 'present_user' })).resolves.toMatchObject({ ok: true });
    expect(write).toHaveBeenCalledWith(expect.objectContaining(input));
  });
});
