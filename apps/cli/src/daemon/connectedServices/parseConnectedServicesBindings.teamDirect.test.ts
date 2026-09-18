import { describe, expect, it } from 'vitest';

import {
  ConnectedServicesBindingsIngressSchema,
  parseConnectedServiceBindingSelections,
} from './parseConnectedServicesBindings';

describe('parseConnectedServiceBindingSelections team-direct ingress', () => {
  it('preserves one resource and exact disclosed member without translating it to a source account', () => {
    expect(parseConnectedServiceBindingSelections({
      v: 2,
      bindingsByServiceId: {
        'plugin.acme/service': {
          source: 'team_resource',
          resourceId: 'resource-1',
          deliveryMode: 'direct',
          disclosedMember: {
            service: { pluginId: 'plugin.acme', localId: 'service' },
            accountId: 'account-1',
          },
        },
      },
    })).toEqual([{
      kind: 'team_resource',
      serviceId: 'plugin.acme/service',
      resourceId: 'resource-1',
      deliveryMode: 'direct',
      disclosedMember: {
        service: { pluginId: 'plugin.acme', localId: 'service' },
        accountId: 'account-1',
      },
    }]);
  });

  it('preserves brokered identity without inventing a disclosed source member', () => {
    expect(parseConnectedServiceBindingSelections({
      v: 2,
      bindingsByServiceId: {
        'plugin.acme/service': {
          source: 'team_resource',
          resourceId: 'resource-1',
          deliveryMode: 'brokered',
        },
      },
    })).toEqual([{
      kind: 'team_resource',
      serviceId: 'plugin.acme/service',
      resourceId: 'resource-1',
      deliveryMode: 'brokered',
    }]);
  });

  it('rejects direct identity without its exact disclosed member', () => {
    expect(ConnectedServicesBindingsIngressSchema.safeParse({
      v: 2,
      bindingsByServiceId: {
        'plugin.acme/service': {
          source: 'team_resource',
          resourceId: 'resource-1',
          deliveryMode: 'direct',
        },
      },
    }).success).toBe(false);
  });

  it('rejects superseded consumer-authored Team and source-currentness fields', () => {
    expect(ConnectedServicesBindingsIngressSchema.safeParse({
      v: 2,
      bindingsByServiceId: {
        'plugin.acme/service': {
          source: 'team_resource',
          resourceId: 'resource-1',
          deliveryMode: 'brokered',
          teamId: 'team-1',
          expectedResourceRevision: 4,
          sourceMemberKey: 'member-1',
          sourceVersion: 'version-1',
        },
      },
    }).success).toBe(false);
  });
});
