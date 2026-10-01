import { describe, expect, it } from 'vitest';
import { getActionSpec } from './actionSpecs.js';
import { ActionIdSchema, type ActionId } from './actionIds.js';

const service = { pluginId: 'happier.agent.codex', localId: 'openai' };

describe('connected-service configuration Action parity', () => {
  it.each([
    ['connectedServices.accounts.rename', { account: { service, accountId: 'work' }, label: 'Team' }],
    ['connectedServices.pools.switchNow', { group: { service, groupId: 'pool' }, connectedAccountId: 'work', expectedGeneration: 1, expectedIncarnation: '11111111-1111-4111-8111-111111111111', expectedRuntimeStateRevision: 1 }],
    ['connectedServices.pools.reorder', { group: { service, groupId: 'pool' }, accountIds: ['work', 'personal'] }],
    ['connectedServices.pools.default.set', { group: { service, groupId: 'pool' }, agentId: 'codex', makeDefault: true }],
    ['connectedServices.quota.reset', { machineId: 'machine-1', serviceId: 'openai-codex', profileId: 'work' }],
    ['connectedServices.identityPrivacy.set', { hidden: true }],
  ])('admits %s through a closed Action input', (id, input) => {
    const spec = getActionSpec(id as ActionId);
    expect(ActionIdSchema.safeParse(id).success).toBe(true);
    expect(spec.inputSchema.safeParse(input).success).toBe(true);
    expect(spec.inputSchema.safeParse({ ...input, accountId: 'caller-selected-account' }).success).toBe(false);
    expect(spec.surfaces.ui).toBe(true);
    expect(spec.surfaces.agent).toBe(true);
  });
  it('routes quota-reset execution to its machine owner rather than an Account server', () => {
    expect(getActionSpec('connectedServices.quota.reset').executionPlacement).toBe('machine');
  });
});
