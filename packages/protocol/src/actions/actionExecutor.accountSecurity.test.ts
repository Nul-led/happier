import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor } from './actionExecutor.js';
import type { ActionExecutorDeps } from './executor/types.js';

function createDeps(overrides: Partial<ActionExecutorDeps> = {}): ActionExecutorDeps {
  return {
    executionRunStart: vi.fn(async () => ({})),
    executionRunList: vi.fn(async () => ({})),
    executionRunGet: vi.fn(async () => ({})),
    detachedExecutionRunSend: vi.fn(async () => ({})),
    executionRunStop: vi.fn(async () => ({})),
    executionRunAction: vi.fn(async () => ({})),
    executionRunWait: vi.fn(async () => ({})),
    sessionOpen: vi.fn(async () => ({})),
    sessionFork: vi.fn(async () => ({})),
    sessionRollback: vi.fn(async () => ({})),
    sessionSpawnNew: vi.fn(async () => ({})),
    pathsListRecent: vi.fn(async () => ({ items: [] })),
    machinesList: vi.fn(async () => ({ items: [] })),
    serversList: vi.fn(async () => ({ items: [] })),
    reviewEnginesList: vi.fn(async () => ({ items: [] })),
    agentsBackendsList: vi.fn(async () => ({ items: [] })),
    agentsModelsList: vi.fn(async () => ({ items: [] })),
    sessionSendMessage: vi.fn(async () => ({})),
    sessionPermissionRespond: vi.fn(async () => ({})),
    sessionUserActionAnswer: vi.fn(async () => ({})),
    sessionModeSet: vi.fn(async () => ({})),
    sessionModesList: vi.fn(async () => ({ items: [] })),
    sessionTargetPrimarySet: vi.fn(async () => ({})),
    sessionTargetTrackedSet: vi.fn(async () => ({})),
    sessionList: vi.fn(async () => ({})),
    sessionActivityGet: vi.fn(async () => ({})),
    sessionRecentMessagesGet: vi.fn(async () => ({})),
    resetGlobalVoiceAgent: vi.fn(),
    ...overrides,
  };
}

describe('createActionExecutor (Account Security)', () => {
  it('dispatches only present-user input and removes password material from execution history', async () => {
    const accountPasswordChangeAction = vi.fn(async () => ({ v: 1 as const, status: 'updated' as const }));
    const observeActionExecution = vi.fn();
    const executor = createActionExecutor(createDeps({
      accountPasswordChangeAction,
      observeActionExecution,
      interceptActionExecution: async ({ input }) => ({ status: 'continue', input }),
      isActionApprovalRequired: () => false,
    }));
    const input = {
      v: 1 as const,
      kind: 'plain' as const,
      expectedCredentialRevision: 7,
      currentPassword: 'current highly secret password',
      newPassword: 'replacement highly secret password',
    };
    const context = {
      surface: 'cli' as const,
      authority: 'present_user' as const,
      actionCaller: { kind: 'host' as const },
    };

    await expect(executor.execute('account.password.change', input, context)).resolves.toEqual({
      ok: true,
      result: { v: 1, status: 'updated' },
    });
    expect(accountPasswordChangeAction).toHaveBeenCalledWith({ input, context });
    expect(observeActionExecution).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'account.password.change',
      input: { v: 1, kind: 'plain', expectedCredentialRevision: 7 },
    }));
    expect(JSON.stringify(observeActionExecution.mock.calls)).not.toContain('highly secret');

    await expect(executor.execute('account.password.change', input, {
      ...context,
      authority: 'account_automation',
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'present_user_required',
    }));
    expect(accountPasswordChangeAction).toHaveBeenCalledTimes(1);
  });
});
