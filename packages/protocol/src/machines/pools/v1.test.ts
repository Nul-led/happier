import { describe, expect, it } from 'vitest';

import {
  MachinePoolErrorV1Schema,
  MachinePoolPriorityTierV1Schema,
  MachinePoolSelectionOriginV1Schema,
} from './v1.js';

describe('Machine Pool V1 schemas', () => {
  it('keeps selection origin to a strict informational Pool identity', () => {
    const origin = {
      kind: 'machine_pool',
      poolId: '11111111-1111-4111-8111-111111111111',
    } as const;
    expect(MachinePoolSelectionOriginV1Schema.parse(origin)).toEqual(origin);
    expect(MachinePoolSelectionOriginV1Schema.safeParse({
      ...origin,
      name: 'Private Pool',
    }).success).toBe(false);
  });

  it('bounds priority tiers to the database Int range', () => {
    expect(MachinePoolPriorityTierV1Schema.safeParse(2_147_483_647).success).toBe(true);
    expect(MachinePoolPriorityTierV1Schema.safeParse(2_147_483_648).success).toBe(false);
  });

  it('permits a nondisclosing create collision without a current pool projection', () => {
    expect(MachinePoolErrorV1Schema.parse({ code: 'pool_changed' })).toEqual({ code: 'pool_changed' });
  });
});
