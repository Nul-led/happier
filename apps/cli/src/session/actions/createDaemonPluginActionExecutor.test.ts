import { describe, expect, it, vi } from 'vitest';

import { createDaemonPluginActionExecutor } from './createDaemonPluginActionExecutor';

describe('createDaemonPluginActionExecutor', () => {
  it('routes all contributed Action discovery operations to the daemon owner', async () => {
    const baseExecute = vi.fn(async () => ({
      ok: false as const,
      errorCode: 'base_executor_reached',
      error: 'base_executor_reached',
    }));
    const requestPluginActionExecution = vi.fn(async (request: Readonly<{ actionId: string }>) => ({
      matched: true as const,
      result: {
        ok: true as const,
        result: { actionId: request.actionId, source: 'daemon' },
      },
    }));
    const executor = createDaemonPluginActionExecutor({
      base: { execute: baseExecute },
      requestPluginActionExecution,
    });

    for (const actionId of ['action.spec.search', 'action.spec.get', 'action.options.resolve'] as const) {
      await expect(executor.execute(actionId, {}, { surface: 'mcp' })).resolves.toEqual({
        ok: true,
        result: { actionId, source: 'daemon' },
      });
    }

    expect(requestPluginActionExecution.mock.calls.map(([request]) => request.actionId)).toEqual([
      'action.spec.search',
      'action.spec.get',
      'action.options.resolve',
    ]);
    expect(baseExecute).not.toHaveBeenCalled();
  });
});
