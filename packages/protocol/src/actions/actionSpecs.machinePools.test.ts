import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  MACHINE_POOL_ACTION_IDS_V1,
  type MachinePoolActionIdV1,
  type MachinePoolActionInputV1,
  type MachinePoolActionOutputV1,
} from '../machines/pools/actionsV1.js';
import { ACTION_IDS } from './actionIds.js';
import {
  PLUGIN_INVOCABLE_ACTION_IDS,
  PUBLIC_ACTION_IDS,
  getActionSpec,
  listActionCliCommandDeclarations,
  type PluginActionInputById,
  type PluginActionResultById,
  type PublicActionInputById,
  type PublicActionResultById,
} from './actionSpecs.js';

describe('Machine Pool Action specs', () => {
  it('registers the complete Account-scoped family for UI and CLI', () => {
    for (const actionId of MACHINE_POOL_ACTION_IDS_V1) {
      expect(ACTION_IDS).toContain(actionId);
      expect(getActionSpec(actionId)).toMatchObject({
        id: actionId,
        executionPlacement: 'account',
        surfaces: { ui: true, cli: true, api: true, plugin: true },
        serverTransport: {
          method: 'POST',
          path: `/v1/machines/pools/${actionId.slice('machines.pools.'.length)}`,
        },
      });
    }
  });

  it('gives public API and trusted plugin callers the same exact family types', () => {
    expect(PUBLIC_ACTION_IDS).toEqual(expect.arrayContaining(MACHINE_POOL_ACTION_IDS_V1));
    expect(PLUGIN_INVOCABLE_ACTION_IDS).toEqual(expect.arrayContaining(MACHINE_POOL_ACTION_IDS_V1));

    type PoolPublicInputs = Pick<PublicActionInputById, MachinePoolActionIdV1>;
    type PoolPluginInputs = Pick<PluginActionInputById, MachinePoolActionIdV1>;
    type PoolPublicResults = Pick<PublicActionResultById, MachinePoolActionIdV1>;
    type PoolPluginResults = Pick<PluginActionResultById, MachinePoolActionIdV1>;
    type CanonicalInputs = Readonly<{
      [TActionId in MachinePoolActionIdV1]: MachinePoolActionInputV1<TActionId>;
    }>;
    type CanonicalResults = Readonly<{
      [TActionId in MachinePoolActionIdV1]: MachinePoolActionOutputV1<TActionId>;
    }>;

    expectTypeOf<PoolPublicInputs>().toEqualTypeOf<CanonicalInputs>();
    expectTypeOf<PoolPluginInputs>().toEqualTypeOf<CanonicalInputs>();
    expectTypeOf<PoolPublicResults>().toEqualTypeOf<CanonicalResults>();
    expectTypeOf<PoolPluginResults>().toEqualTypeOf<CanonicalResults>();
  });

  it('projects every intent through the generated exact-Home CLI command tree', () => {
    const declarations = new Map(
      listActionCliCommandDeclarations().map(({ spec, binding }) => [
        spec.id,
        { path: binding.path, acceptsServerId: spec.cli?.acceptsServerId },
      ]),
    );

    expect(Object.fromEntries(MACHINE_POOL_ACTION_IDS_V1.map((actionId) => [actionId, declarations.get(actionId)])))
      .toEqual({
        'machines.pools.list': { path: ['machines', 'pools', 'list'], acceptsServerId: true },
        'machines.pools.get': { path: ['machines', 'pools', 'get'], acceptsServerId: true },
        'machines.pools.create': { path: ['machines', 'pools', 'create'], acceptsServerId: true },
        'machines.pools.update': { path: ['machines', 'pools', 'update'], acceptsServerId: true },
        'machines.pools.delete': { path: ['machines', 'pools', 'delete'], acceptsServerId: true },
        'machines.pools.resolve': { path: ['machines', 'pools', 'resolve'], acceptsServerId: true },
      });
  });
});
