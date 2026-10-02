import { describe, expect, it, vi } from 'vitest';

import { createDaemonPluginActionExecutor } from './createDaemonPluginActionExecutor';
import { createActionExecutor, type ActionExecutorDeps } from '@happier-dev/protocol';

describe('createDaemonPluginActionExecutor', () => {
  it('exposes nested wait invocation without falling back recursively for an unavailable plugin', async () => {
    const transport = createDaemonPluginActionExecutor({
      base: { execute: async () => { throw new Error('Nested invocation must not re-enter the base'); } },
      requestPluginActionExecution: async () => ({ matched: false }),
    });
    const executor = createActionExecutor({
      invokeContributedAction: async (request) => transport.invokeContributedAction(request),
    } as unknown as ActionExecutorDeps);
    expect(await executor.execute('wait', {
      target: { kind: 'plugin_source', serverId: 'home', pluginId: 'acme.checks', sourceId: 'checkpoint' },
      condition: { kind: 'plugin', actionLocalId: 'observe/checks', condition: 'checks_passed' },
    }, { surface: 'mcp', serverId: 'home' })).toMatchObject({ ok: true, result: { disposition: 'target_unavailable' } });
  });
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
