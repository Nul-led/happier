import { describe, expect, it } from 'vitest';

import {
  assertQualifiedPurposeAuthorityForSelections,
  ConnectedServiceQualifiedPurposeAuthorityError,
} from './qualifiedPurposeAuthority';

describe('assertQualifiedPurposeAuthorityForSelections', () => {
  it('does not require Connected Account purpose authority for a brokered Team resource', () => {
    expect(() => assertQualifiedPurposeAuthorityForSelections({
      selections: [{
        kind: 'team_resource',
        serviceId: 'plugin.acme/service',
        resourceId: 'resource-1',
        deliveryMode: 'brokered',
      }],
      snapshot: null,
    })).not.toThrow();
  });

  it('requires the exact disclosed direct member to be represented', () => {
    expect(() => assertQualifiedPurposeAuthorityForSelections({
      selections: [{
        kind: 'team_resource',
        serviceId: 'plugin.acme/service',
        resourceId: 'resource-1',
        deliveryMode: 'direct',
        disclosedMember: {
          service: { pluginId: 'plugin.acme', localId: 'service' },
          accountId: 'recipient-visible-source',
        },
      }],
      snapshot: {
        purposes: [],
        bindings: [{
          purpose: {
            consumer: { pluginId: 'plugin.acme-agent', localId: 'agent' },
            purpose: 'inference',
          },
          target: {
            kind: 'account',
            account: {
              service: { pluginId: 'plugin.acme', localId: 'service' },
              accountId: 'different-source',
            },
          },
        }],
      },
    })).toThrow(ConnectedServiceQualifiedPurposeAuthorityError);
  });
});
