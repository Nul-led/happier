import { describe, expect, it } from 'vitest';
import type { AutomationDefinitionDetail, AutomationDefinitionReconcileRequest } from '../../automations/automationApiV3.js';
import type { AvailableAutomationAccountEncryptionV1 } from '../../automations/automationAccountCurrentnessV1.js';
import { AutomationTriggerDetailSchema } from '../../automations/automationTriggerProjectionV1.js';
import { AutomationTriggerIdSchema } from '../../automations/automationTriggerIdentity.js';
import { sealAutomationTriggerDefinitionStoredEnvelopeV1 } from '../../automations/automationTriggerDefinitionStoredContent.js';
import { createAccountScopedCryptoMaterialSnapshotV1 } from '../../crypto/accountScopedCipher.js';
import { WorkflowDefinitionV1Schema } from '../../workflows/workflowV1.js';
import { createAccountWorkflowTriggerActions, type WorkflowTriggerAccountHostParams } from './workflowTriggerAccountHost.js';

const definition = WorkflowDefinitionV1Schema.parse({ version: 1, blocks: [{ kind: 'action', id: 'notice',
  actionId: 'notifications.notify_me', input: { message: { kind: 'literal', value: 'PR changed' } } }] });
const pullRequest = { repository: 'happier-dev/happier', number: 42 };
const modes: AvailableAutomationAccountEncryptionV1[] = [
  { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } },
  { kind: 'available', witness: { mode: 'e2ee', version: 1, contentKeyFingerprint: 'current' },
    material: createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee',
      material: { type: 'legacy', secret: new Uint8Array(32).fill(7) } }) },
];

function fixture(encryption: AvailableAutomationAccountEncryptionV1) {
  let row: AutomationDefinitionDetail | null = null;
  let written: AutomationDefinitionReconcileRequest | null = null;
  let nextId = 0;
  let linked = false;
  // Automation HTTP persistence and Channels transport are external boundaries; codecs and Actions stay real.
  const params: WorkflowTriggerAccountHostParams = {
    resolveEncryption: async () => encryption, randomBytes: (length) => new Uint8Array(length).fill(1),
    newId: () => `id-${++nextId}`, resolveWorkflow: async () => definition,
    resolveSession: async () => ({ project: { machineId: 'machine-one', directory: '/repo' }, nativeGoalOwner: false }),
    pullRequests: { listLinks: async () => linked ? [{ provider: 'github', ...pullRequest }] : [],
      attach: async () => { linked = true; }, removeTrigger: async () => undefined },
    automations: {
      list: async () => ({ automations: row ? [row] : [], nextCursor: null }), get: async () => row,
      delete: async () => { row = null; },
      create: async (input) => {
        row = { id: input.automationId, name: input.name, description: null, enabled: input.enabled,
          targetType: null, existingSessionId: null, templateVersion: 1, workflowDefinitionId: null,
          scopeSessionId: input.scopeSessionId ?? null, lastRunAt: null, createdAt: 1, updatedAt: 1,
          assignments: [{ machineId: 'machine-one', enabled: true, priority: 0, updatedAt: 1 }],
          executionRecipe: input.executionRecipe, triggers: input.triggers.map((item) => {
            if (item.trigger.kind !== 'prComment' && item.trigger.kind !== 'ciFailed') throw new Error('Unexpected trigger');
            const envelope = 'triggerDefinitionEnvelope' in item.trigger ? item.trigger.triggerDefinitionEnvelope
              : sealAutomationTriggerDefinitionStoredEnvelopeV1({ mode: 'plain',
                binding: { v: 1, automationId: input.automationId, triggerId: AutomationTriggerIdSchema.parse(item.triggerId),
                  triggerRevision: 0, triggerKind: item.trigger.kind },
                definition: { kind: item.trigger.kind, pullRequest: item.trigger.pullRequest } });
            return AutomationTriggerDetailSchema.parse({ id: item.triggerId, kind: item.trigger.kind,
              revision: 0, enabled: item.trigger.enabled, sourceSessionId: input.scopeSessionId,
              createdAt: 1, updatedAt: 1, triggerDefinitionEnvelope: JSON.stringify(envelope) });
          }) };
        return row;
      },
      reconcile: async (_id, input) => {
        if (!row) throw new Error('Missing row');
        written = input;
        const current = row;
        row = { ...current, templateVersion: current.templateVersion + 1, executionRecipe: input.executionRecipe ?? current.executionRecipe,
          triggers: input.triggers.map((item) => {
            if (item.kind !== 'existing') throw new Error('Unexpected new trigger');
            const old = current.triggers.find((trigger) => trigger.id === item.triggerId)!;
            return { ...old, revision: old.revision + (item.enabled === undefined ? 0 : 1),
              enabled: item.enabled ?? old.enabled,
              ...(item.triggerDefinitionEnvelope ? { triggerDefinitionEnvelope: JSON.stringify(item.triggerDefinitionEnvelope) } : {}) };
          }) };
        return row;
      },
    },
  };
  return { params, row: () => row!, written: () => written };
}

describe('Account PR trigger private content', () => {
  it.each(['prComment', 'ciFailed'] as const)('opens %s selectors and reseals encrypted enablement revisions', async (kind) => {
    const f = fixture(modes[1]!);
    const host = createAccountWorkflowTriggerActions(f.params);
    const result = await host.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition },
      trigger: { kind, enabled: true, pullRequest } });
    expect(result.set.triggers).toMatchObject([{ kind, pullRequest }]);
    expect(f.row().triggers[0]?.triggerDefinitionEnvelope).not.toContain(pullRequest.repository);
    await host.sessionUpdate({ sessionId: 'session-one', triggerId: result.triggerId!, expectedRevision: 1, patch: { enabled: false } });
    expect(f.written()?.triggers[0]).toMatchObject({ kind: 'existing', expectedRevision: 0, enabled: false,
      triggerDefinitionEnvelope: { t: 'encrypted' } });
    expect((await host.sessionList({ sessionId: 'session-one' })).sets[0]?.triggers)
      .toMatchObject([{ kind, revision: 1, enabled: false, pullRequest }]);
  });

  it('opens plain private selectors and rejects a moved binding before disclosure', async () => {
    const f = fixture(modes[0]!);
    const host = createAccountWorkflowTriggerActions(f.params);
    const result = await host.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition },
      trigger: { kind: 'prComment', enabled: true, pullRequest } });
    expect(result.set.triggers).toMatchObject([{ pullRequest }]);
    f.row().triggers[0]!.revision++;
    await expect(host.sessionList({ sessionId: 'session-one' })).rejects.toMatchObject({ code: 'content_unavailable' });
  });
});
