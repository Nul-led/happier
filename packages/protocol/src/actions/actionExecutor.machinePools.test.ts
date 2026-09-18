import { describe, expect, it, vi } from 'vitest';

import { MACHINE_POOL_ACTION_IDS_V1 } from '../machines/pools/actionsV1.js';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';

const poolId = '99d55938-f860-4af8-8023-01fecec86f35';
const poolView = {
  pool: {
    id: poolId,
    name: 'Fast',
    description: null,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    members: [],
  },
  availability: { state: 'known', connectedCount: 0, enabledCount: 0 },
} as const;

describe('createActionExecutor (Machine Pools family)', () => {
  it('dispatches all six intents through one family dependency', async () => {
    const machinePoolAction = vi.fn(async ({ actionId }: Readonly<{ actionId: string }>) => {
      if (actionId === 'machines.pools.list') return { pools: [poolView] };
      if (actionId === 'machines.pools.delete') return { poolId, deleted: true };
      if (actionId === 'machines.pools.resolve') return { kind: 'unavailable', poolId, reason: 'empty' };
      return poolView;
    });
    const executor = createActionExecutor({
      machinePoolAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);
    const inputs = {
      'machines.pools.list': {},
      'machines.pools.get': { poolId },
      'machines.pools.create': { poolId, name: 'Fast', members: [] },
      'machines.pools.update': { poolId, expectedRevision: 0, name: 'Fast', members: [] },
      'machines.pools.delete': { poolId, expectedRevision: 0 },
      'machines.pools.resolve': { poolId, requestKey: 'request-1' },
    } as const;

    for (const actionId of MACHINE_POOL_ACTION_IDS_V1) {
      await expect(executor.execute(actionId, inputs[actionId], { surface: 'ui' })).resolves.toMatchObject({ ok: true });
    }
    expect(machinePoolAction.mock.calls.map(([call]) => call.actionId)).toEqual(MACHINE_POOL_ACTION_IDS_V1);
  });

  it('fails closed when the Account server adapter is absent', async () => {
    const executor = createActionExecutor({ isActionApprovalRequired: () => false } as unknown as ActionExecutorDeps);
    await expect(executor.execute('machines.pools.list', {}, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'unsupported_action',
      error: 'unsupported_action:machines.pools.list',
    });
  });
});
