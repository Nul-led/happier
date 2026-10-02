import { describe, expect, it } from 'vitest';

import { describeApprovalActionFields } from './actionApprovalPresentation.js';

describe('approval field presentation', () => {
  it.each([
    ['ordered members', ['account-b', 'account-a']],
    ['an explicit empty list', []],
  ])('preserves %s as structured JSON rather than flattening or hiding the mutation', (_label, accountIds) => {
    const presentation = describeApprovalActionFields({
      actionId: 'connectedServices.pools.reorder',
      actionArgs: {
        group: { serviceId: 'service-a', groupId: 'pool-a' },
        accountIds,
        expectedGeneration: '1',
      },
    });

    expect(presentation.rows).toContainEqual(expect.objectContaining({
      kind: 'value', path: 'accountIds', value: JSON.stringify(accountIds),
    }));
    expect(presentation.unrepresentable).toBeNull();
  });
});
