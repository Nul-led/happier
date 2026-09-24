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

  it('represents a Team direct selection by its disclosed-member binding, never a Team purpose target', () => {
    const service = { pluginId: 'plugin.acme', localId: 'service' } as const;
    const disclosedMember = { service, accountId: 'recipient-visible-source' } as const;
    const purpose = { consumer: { pluginId: 'plugin.acme-agent', localId: 'agent' }, purpose: 'inference' } as const;
    const selections = [{
      kind: 'team_resource' as const,
      serviceId: 'plugin.acme/service',
      resourceId: 'resource-1',
      deliveryMode: 'direct' as const,
      disclosedMember,
    }];
    expect(() => assertQualifiedPurposeAuthorityForSelections({
      selections,
      snapshot: {
        purposes: [purpose],
        bindings: [{ purpose, target: { kind: 'account', account: disclosedMember } }],
      },
    })).not.toThrow();
    expect(() => assertQualifiedPurposeAuthorityForSelections({
      selections,
      snapshot: {
        purposes: [purpose],
        bindings: [{ purpose, target: { kind: 'account', account: { service, accountId: 'another-member' } } }],
      },
    })).toThrow(ConnectedServiceQualifiedPurposeAuthorityError);
  });
});
