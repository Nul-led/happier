import { describe, expect, it } from 'vitest';

import {
  QualifiedConnectedAccountPurposeBindingV1Schema,
  QualifiedConnectedAccountPurposeBindingsV1Schema,
} from './connectedAccountPurposeBindings.js';

const consumer = {
  pluginId: 'happier.agent.opencode',
  localId: 'opencode',
} as const;

const service = {
  pluginId: 'happier.connected-account.test',
  localId: 'subscription',
} as const;

describe('qualified connected-account purpose bindings', () => {
  it('represents fixed-account and group intent without a launch-selected group member', () => {
    expect(QualifiedConnectedAccountPurposeBindingV1Schema.parse({
      purpose: { consumer, purpose: 'model-openai' },
      target: { kind: 'account', account: { service, accountId: 'work' } },
    })).toEqual({
      purpose: { consumer, purpose: 'model-openai' },
      target: { kind: 'account', account: { service, accountId: 'work' } },
    });

    const group = QualifiedConnectedAccountPurposeBindingV1Schema.parse({
      purpose: { consumer, purpose: 'model-anthropic' },
      target: { kind: 'group', service, groupId: 'fallbacks' },
    });
    expect(group.target).toEqual({ kind: 'group', service, groupId: 'fallbacks' });
    expect(group.target).not.toHaveProperty('accountId');
    expect(group.target).not.toHaveProperty('profileId');
    expect(group.target).not.toHaveProperty('generation');
  });

  it('rejects two selectors for the same qualified consumer purpose', () => {
    expect(QualifiedConnectedAccountPurposeBindingsV1Schema.safeParse({
      v: 1,
      bindings: [
        {
          purpose: { consumer, purpose: 'model-openai' },
          target: { kind: 'account', account: { service, accountId: 'one' } },
        },
        {
          purpose: { consumer, purpose: 'model-openai' },
          target: { kind: 'group', service, groupId: 'two' },
        },
      ],
    }).success).toBe(false);
  });

  // Lane 10 child 02 :271, child 06 :506, :695: the purpose target stays
  // `account | group`. A Team resource travels as the canonical
  // `ConnectedServiceBindingSelectionV2` Team arm, never as a purpose target.
  it('rejects a Team resource as a purpose target', () => {
    for (const selection of [
      { source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered' },
      {
        source: 'team_resource',
        resourceId: 'resource-1',
        deliveryMode: 'direct',
        disclosedMember: { service, accountId: 'source-member' },
      },
    ]) {
      expect(QualifiedConnectedAccountPurposeBindingV1Schema.safeParse({
        purpose: { consumer, purpose: 'model-openai' },
        target: { kind: 'team_resource', service, teamId: 'team-acme', selection },
      }).success).toBe(false);
    }
  });

  it('persists a durable Team purpose default as the canonical Team selection of its Team', () => {
    const selection = {
      source: 'team_resource',
      resourceId: 'resource-1',
      deliveryMode: 'direct',
      disclosedMember: { service, accountId: 'source-member' },
    } as const;
    const parsed = QualifiedConnectedAccountPurposeBindingsV1Schema.parse({
      v: 1,
      bindings: [{
        purpose: { consumer, purpose: 'model-anthropic' },
        target: { kind: 'group', service, groupId: 'fallbacks' },
      }],
      teamResourceSelections: [{
        purpose: { consumer, purpose: 'model-openai' },
        teamId: 'team-acme',
        selection,
      }],
    });
    expect(parsed.teamResourceSelections).toEqual([{
      purpose: { consumer, purpose: 'model-openai' },
      teamId: 'team-acme',
      selection,
    }]);
    expect(parsed.bindings.map((binding) => binding.target.kind)).toEqual(['group']);
    // One purpose has one default: a Team selection and a personal target for
    // the same purpose are two authorities and are refused.
    expect(QualifiedConnectedAccountPurposeBindingsV1Schema.safeParse({
      v: 1,
      bindings: [{
        purpose: { consumer, purpose: 'model-openai' },
        target: { kind: 'account', account: { service, accountId: 'work' } },
      }],
      teamResourceSelections: [{ purpose: { consumer, purpose: 'model-openai' }, teamId: 'team-acme', selection }],
    }).success).toBe(false);
    // A pinned revision is a mutable policy fact, never part of the reference.
    expect(QualifiedConnectedAccountPurposeBindingsV1Schema.safeParse({
      v: 1,
      bindings: [],
      teamResourceSelections: [{
        purpose: { consumer, purpose: 'model-openai' },
        teamId: 'team-acme',
        selection,
        expectedResourceRevision: 3,
      }],
    }).success).toBe(false);
  });

  it('reads a Team purpose target an earlier 0.3 build persisted forward, without rewriting the stored value', () => {
    // Exact shape written by the W28/W29 builds (`kind: 'team_resource'`
    // purpose target with its Team id) next to an ordinary personal binding.
    const stored = {
      v: 1,
      bindings: [
        {
          purpose: { consumer, purpose: 'model-openai' },
          target: {
            kind: 'team_resource',
            service,
            teamId: 'team-acme',
            selection: { source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered' },
          },
        },
        {
          purpose: { consumer, purpose: 'model-anthropic' },
          target: { kind: 'account', account: { service, accountId: 'work' } },
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(stored));
    const parsed = QualifiedConnectedAccountPurposeBindingsV1Schema.parse(stored);
    expect(parsed.bindings).toEqual([stored.bindings[1]]);
    expect(parsed.teamResourceSelections).toEqual([{
      purpose: { consumer, purpose: 'model-openai' },
      teamId: 'team-acme',
      selection: { source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered' },
    }]);
    expect(stored).toEqual(snapshot);
  });

  it('is strict and does not accept legacy service-keyed maps as another authority', () => {
    expect(QualifiedConnectedAccountPurposeBindingsV1Schema.safeParse({
      v: 1,
      bindings: [],
      bindingsByServiceId: {
        'openai-codex': { source: 'connected', selection: 'profile', profileId: 'default' },
      },
    }).success).toBe(false);
  });
});
