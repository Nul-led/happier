import { describe, expect, it } from 'vitest';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { getActionSpec } from './actionSpecs.js';
import type { ActionId } from './actionIds.js';

describe('declared settings Actions', () => {
  it('discovers settings and invokes the same host settings owner from agent and CLI surfaces', async () => {
    const items = [{ anchor: 'appearance.density', pageId: 'appearance', title: 'Density',
      readable: true, writable: true, sensitive: false, storageScope: 'local' }];
    // The UI host is the process boundary; Protocol retains real admission and result validation.
    const deps = { settingsDeclarationAction: async ({ actionId }: { actionId: string }) => (
      actionId === 'settings.list' ? { items } : { anchor: 'appearance.density', value: 'compact' }
    ) } as unknown as ActionExecutorDeps;
    const executor = createActionExecutor(deps);
    expect(await executor.execute('settings.list' as ActionId, {}, { surface: 'agent' }))
      .toEqual({ ok: true, result: { items } });
    expect(await executor.execute('settings.set' as ActionId, { anchor: 'appearance.density', value: 'compact' }, { surface: 'cli' }))
      .toMatchObject({ ok: false, errorCode: 'approvals_not_supported' });
    expect(await executor.execute('settings.set' as ActionId, { anchor: 'appearance.density', value: 'compact' }, {
      surface: 'cli', authority: 'present_user', presentUserConfirmation: { actionId: 'settings.set' },
    }))
      .toEqual({ ok: true, result: { anchor: 'appearance.density', value: 'compact' } });
    for (const id of ['settings.list', 'settings.get', 'settings.set']) {
      expect(getActionSpec(id as ActionId).surfaces).toMatchObject({ ui: true, agent: true, mcp: true, cli: true });
    }
  });

  it('rejects unknown selectors and malformed results without interpreting them as settings values', async () => {
    const executor = createActionExecutor({ settingsDeclarationAction: async () => ({ anchor: 'appearance.density' }) } as unknown as ActionExecutorDeps);
    expect(await executor.execute('settings.set' as ActionId, { anchor: 'appearance.density', value: 'compact', accountId: 'other' }, { surface: 'cli' }))
      .toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(await executor.execute('settings.get' as ActionId, { anchor: 'appearance.density' }, { surface: 'agent' }))
      .toMatchObject({ ok: false });
  });
});
