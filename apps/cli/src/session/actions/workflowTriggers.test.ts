import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowDefinitionV1Schema, createAccountScopedCryptoMaterialSnapshotV1,
  convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1,
  type AutomationDefinitionDetail, type AutomationDefinitionCreateRequest } from '@happier-dev/protocol';

const network = vi.hoisted(() => ({ currentness: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), reconcile: vi.fn(), remove: vi.fn() }));
// These are network transport adapters; Workflow semantics and the Account codec remain real.
vi.mock('@/api/client/connectedServiceCredentialApi', () => ({ fetchAccountEncryptionCurrentness: network.currentness }));
vi.mock('@/api/automations', () => ({ listAutomationDefinitions: network.list, getAutomationDefinition: network.get,
  createAutomationDefinition: network.create, reconcileAutomationDefinition: network.reconcile, deleteAutomationDefinition: network.remove }));

const definition = WorkflowDefinitionV1Schema.parse({ version: 1,
  defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
  blocks: [{ kind: 'step', id: 'prompt', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
});
const trigger = { kind: 'schedule' as const, enabled: true,
  schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 60_000, timezone: null } };

describe('CLI workflow trigger Account codec', () => {
  let stored: AutomationDefinitionDetail;
  beforeEach(() => {
    for (const adapter of Object.values(network)) adapter.mockReset();
    network.create.mockImplementation(async ({ input }: { input: AutomationDefinitionCreateRequest }) => {
      stored = { id: input.automationId, name: input.name, description: null,
      enabled: true, targetType: null, existingSessionId: null, templateVersion: 1, lastRunAt: null,
      createdAt: 1, updatedAt: 1, workflowDefinitionId: input.workflowDefinitionId ?? null, scopeSessionId: input.scopeSessionId ?? null,
      executionRecipe: input.executionRecipe, assignments: (input.assignments ?? []).map((assignment) => ({ ...assignment,
        enabled: assignment.enabled ?? true, priority: assignment.priority ?? 0, updatedAt: 1 })),
      triggers: [] };
      network.list.mockResolvedValue({ automations: [stored], nextCursor: null });
      return stored;
    });
    network.get.mockImplementation(async () => stored);
    network.list.mockResolvedValue({ automations: [], nextCursor: null });
  });
  it('writes a keyless plain Account inline payload through the Automation owner', async () => {
    network.currentness.mockResolvedValue({ mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 });
    const { createCliWorkflowTriggerActions } = await import('./workflowTriggers');
    const actions = createCliWorkflowTriggerActions({ credentials: { token: 'token', encryption: null }, resolveWorkflow: async () => definition });
    const written = await actions.add({ target: { kind: 'inline', definition }, project: { machineId: 'machine', directory: '/work' }, trigger });
    expect(written.set.health).toBe('available');
    expect(written.set.context).toMatchObject({ inlineDefinition: definition, executionTarget: { kind: 'session' } });
    expect(network.create.mock.calls[0]?.[0].input.executionRecipe.workflow).toMatchObject({ t: 'plain', v: { workspace: { directory: '/work' } } });
  });
  it('opens real E2EE context only while the Account mode and key witness match', async () => {
    const secret = new Uint8Array(32).fill(7);
    const material = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material: { type: 'legacy', secret } });
    network.currentness.mockResolvedValue({ mode: 'e2ee', version: 1, signingKeyFingerprint: null,
      contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint), updatedAt: 1 });
    const { createCliWorkflowTriggerActions } = await import('./workflowTriggers');
    const actions = createCliWorkflowTriggerActions({ credentials: { token: 'token', encryption: { type: 'legacy', secret } },
      resolveWorkflow: async () => definition });
    const written = await actions.add({ target: { kind: 'inline', definition }, project: { machineId: 'machine', directory: '/work' }, trigger });
    expect(stored.executionRecipe?.v === 2 && stored.executionRecipe.workflow.t).toBe('encrypted');
    expect(written.set.context?.inlineDefinition).toEqual(definition);
    network.currentness.mockResolvedValue({ mode: 'plain', version: 2, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 2 });
    await expect(actions.list({ scope: 'account_inline' })).rejects.toMatchObject({ code: 'content_unavailable' });
  });
  it.each(['plain', 'e2ee'] as const)('validates the saved Workflow audience before encoding the %s trigger context', async (mode) => {
    const secret = new Uint8Array(32).fill(7);
    const material = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material: { type: 'legacy', secret } });
    network.currentness.mockResolvedValue({ mode, version: 1, signingKeyFingerprint: null,
      contentKeyFingerprint: mode === 'plain' ? null
        : convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint), updatedAt: 1 });
    const { createCliWorkflowTriggerActions } = await import('./workflowTriggers');
    const actions = createCliWorkflowTriggerActions({ credentials: { token: 'token',
      encryption: mode === 'plain' ? null : { type: 'legacy', secret } },
      resolveWorkflow: async () => definition, resolveWorkflowTeamIds: async () => ['team-one', 'team-two'] });
    const input = { workflow: '11111111-1111-4111-8111-111111111111', project: { machineId: 'machine', directory: '/work' }, trigger };
    await expect(actions.add(input)).rejects.toMatchObject({ code: 'visible_team_not_granted' });
    expect(network.create).not.toHaveBeenCalled();
    const written = await actions.add({ ...input, visibleTeamId: 'team-two' });
    expect(written.set.context?.visibleTeamId).toBe('team-two');
    expect(stored.executionRecipe).toMatchObject({ v: 2, workflow: { t: mode === 'plain' ? 'plain' : 'encrypted' } });
  });
  it('keeps scoped trigger writes in the authorized Session and the keyless Account codec', async () => {
    network.currentness.mockResolvedValue({ mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 });
    const { createCliWorkflowTriggerActions } = await import('./workflowTriggers');
    const actions = createCliWorkflowTriggerActions({ credentials: { token: 'token', encryption: null }, resolveWorkflow: async () => definition,
      resolveSession: async () => ({ project: { machineId: 'session-machine', directory: '/session-work' }, nativeGoalOwner: false }) });
    const written = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger,
      onComplete: { kind: 'originating_session' } });
    expect(written.set.health).toBe('available');
    expect(stored).toMatchObject({ scopeSessionId: 'session-one', assignments: [{ machineId: 'session-machine' }], executionRecipe: {
      v: 2, workflow: { t: 'plain', v: { workspace: { directory: '/session-work' }, onComplete: { kind: 'originating_session' } } },
    } });
    expect((await actions.list({ scope: 'account_inline' })).sets).toEqual([]);
    expect((await actions.sessionList({ sessionId: 'session-one' })).sets).toHaveLength(1);
  });
  it('refuses retained V1 mutation when the Channel binding owner cannot prove handoff absence', async () => {
    network.currentness.mockResolvedValue({ mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 });
    const retained = { id: 'automation-old', name: 'Old', description: null,
      enabled: true, targetType: 'newSession', existingSessionId: null, templateVersion: 1, lastRunAt: null,
      createdAt: 1, updatedAt: 1, workflowDefinitionId: null, scopeSessionId: null,
      executionRecipe: { v: 1, templateVersion: 1, template: { t: 'plain', v: { v: 1, prompt: 'Review' } },
        triggerEvidence: null, target: { kind: 'newSession', spawn: {
          executionTarget: { serverId: 'portable-source-server', machineId: 'machine' },
          directory: { kind: 'path', path: '/work' }, agentTarget: definition.defaults!.agentTarget!,
        } } }, assignments: [{ machineId: 'machine', enabled: true, priority: 0, updatedAt: 1 }], triggers: [],
    } satisfies AutomationDefinitionDetail;
    network.get.mockResolvedValue(retained);
    network.list.mockResolvedValue({ automations: [retained], nextCursor: null });
    const { createCliWorkflowTriggerActions } = await import('./workflowTriggers');
    const actions = createCliWorkflowTriggerActions({ credentials: { token: 'token', encryption: null }, resolveWorkflow: async () => definition });
    await expect(actions.update({ automationId: 'automation-old', expectedRevision: 1, patch: { enabled: false } }))
      .rejects.toMatchObject({ code: 'legacy_conversion_unsupported', details: { reason: 'channel_association_unknown' } });
    expect(network.reconcile).not.toHaveBeenCalled();
    expect((await actions.list({ scope: 'account_inline' })).sets[0]?.target)
      .toMatchObject({ kind: 'inline', definition: { blocks: [{ document: { text: 'Review' } }] } });
  });
});
