import { describe, expect, it } from 'vitest';

import { WorkflowDefinitionV1Schema } from '../../workflows/workflowV1.js';
import { createWorkflowDefinitionActions, type WorkflowDefinitionArtifactOperations } from './workflowDefinitions.js';

const definitionId = '11111111-1111-4111-8111-111111111111';
const definition = WorkflowDefinitionV1Schema.parse({ version: 1,
  defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
  blocks: [{ kind: 'step', id: 'review', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
});

describe('shared workflow definition create', () => {
  it.each(['edit', 'admin', undefined] as const)('refuses deletion without owner access (%s) before removing personal triggers', async (access) => {
    const writes: string[] = [];
    const artifactStore: WorkflowDefinitionArtifactOperations = {
      // Missing access models malformed persisted/network boundary output, not an internal mock.
      read: async () => ({ artifactId: definitionId, access, ownerAccountId: 'owner',
        revision: { headerVersion: 1, bodyVersion: 1 },
        header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Review' } },
        body: JSON.stringify({ kind: 'workflow-definition.v1', definition }) }),
      list: async () => ({ items: [] }), create: async () => undefined,
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => { writes.push('artifact'); return { ok: false, errorCode: 'artifact_access_forbidden', error: 'forbidden' }; },
    };
    const actions = createWorkflowDefinitionActions({ artifactStore, encodeListCursor: () => 'cursor',
      assertDefinitionWriteAllowed: () => {}, removeWorkflowTriggers: async () => { writes.push('triggers'); } });
    await expect(actions.delete({ definitionId })).rejects.toMatchObject({ code: 'artifact_access_forbidden' });
    expect(writes).toEqual([]);
  });
  it('stamps create and update from the host caller, preserving the actor on a same-id rejoin', async () => {
    let artifact: Awaited<ReturnType<WorkflowDefinitionArtifactOperations['read']>> = null;
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => artifact,
      create: async (input) => { artifact = { ...input, revision: { headerVersion: 1, bodyVersion: 1 } }; },
      update: async (input) => {
        const revision = { headerVersion: input.expectedRevision.headerVersion + 1, bodyVersion: input.expectedRevision.bodyVersion + 1 };
        artifact = { ...input, revision };
        return { ok: true, revision };
      },
      list: async () => ({ items: [] }),
      delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    const input = { definitionId, definition, metadata: { title: 'Review' } };
    const created = await actions.create(input, undefined, { surface: 'ui_button', runtimeAccountId: 'account-person' });
    expect(created).toMatchObject({ savedBy: { kind: 'person', accountId: 'account-person' } });
    await expect(actions.create(input, undefined, { surface: 'agent', runtimeAccountId: 'account-agent' }))
      .resolves.toMatchObject({ savedBy: { kind: 'person', accountId: 'account-person' } });
    await expect(actions.update({ ...input, expectedRevision: created.revision }, undefined,
      { surface: 'agent', runtimeAccountId: 'account-agent', defaultSessionId: 'session-agent' }))
      .resolves.toMatchObject({ savedBy: { kind: 'agent', accountId: 'account-agent', sessionId: 'session-agent' } });
    await expect(actions.update({ ...input, expectedRevision: { headerVersion: 2, bodyVersion: 2 } }, undefined,
      { surface: 'agent', runtimeAccountId: 'account-agent' }))
      .resolves.toMatchObject({ savedBy: { kind: 'agent', accountId: 'account-agent' } });
    await actions.edit({ definitionId, expectedRevision: { headerVersion: 3, bodyVersion: 3 },
      ops: [{ kind: 'rename', name: 'Reviewed' }] }, undefined,
    { surface: 'ui_button', runtimeAccountId: 'account-person' });
    await expect(actions.get({ definitionId }))
      .resolves.toMatchObject({ metadata: { title: 'Reviewed' }, savedBy: { kind: 'person', accountId: 'account-person' } });
  });

  it('lists grant-reachable workflows with their owner/access and filters other opened kinds', async () => {
    const row = { artifactId: definitionId, headerVersion: 1, updatedAt: 1, ownerAccountId: 'other-owner', access: 'edit' as const,
      header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Shared' } } };
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => null, list: async () => ({ items: [row, { ...row, artifactId: 'role', header: { kind: 'role.v1' } }] }),
      create: async () => undefined, update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }), delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    await expect(actions.list({})).resolves.toEqual({ definitions: [{ ...row.header, ownerAccountId: 'other-owner', access: 'edit' }] });
  });
  it.each(['existing', 'conflict', 'response_loss'] as const)('rejoins same semantic content after %s', async (scenario) => {
    let saved = scenario === 'existing';
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => saved ? { artifactId: definitionId, revision: { headerVersion: 1, bodyVersion: 1 },
        header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 },
          metadata: { title: 'Review', description: 'Same document' } },
        body: JSON.stringify({ kind: 'workflow-definition.v1', definition }) } : null,
      create: async () => { saved = true; throw Object.assign(new Error(scenario), { code: scenario === 'conflict' ? 'conflict' : 'network_error' }); },
      list: async () => ({ items: [] }),
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    await expect(actions.create({ definitionId, definition, metadata: { description: 'Same document', title: 'Review' } }))
      .resolves.toMatchObject({ definitionId, metadata: { title: 'Review', description: 'Same document' } });
  });

  it.each(['conflict', 'response_loss'] as const)('refuses different same-id content after %s', async (scenario) => {
    let saved = false;
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => saved ? { artifactId: definitionId, revision: { headerVersion: 1, bodyVersion: 1 },
        header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Other' } },
        body: JSON.stringify({ kind: 'workflow-definition.v1', definition }) } : null,
      create: async () => { saved = true; throw Object.assign(new Error(scenario), { code: scenario === 'conflict' ? 'conflict' : 'network_error' }); },
      list: async () => ({ items: [] }),
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    await expect(actions.create({ definitionId, definition, metadata: { title: 'Review' } }))
      .rejects.toMatchObject({ code: 'currentness_conflict' });
  });

  it('retains the create failure when no same-id Artifact was committed', async () => {
    const failure = Object.assign(new Error('network_error'), { code: 'network_error' });
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => null,
      create: async () => { throw failure; },
      list: async () => ({ items: [] }),
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    await expect(actions.create({ definitionId, definition, metadata: { title: 'Review' } })).rejects.toBe(failure);
  });

  it('rejects semantically invalid stored definitions before returning private content', async () => {
    const invalidDefinition = { ...definition, finalOutput: { kind: 'result', producer: { blockId: 'missing', scope: { kind: 'current' } }, path: [] } };
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => ({ artifactId: definitionId, revision: { headerVersion: 1, bodyVersion: 1 },
        header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Review' } },
        body: JSON.stringify({ kind: 'workflow-definition.v1', definition: invalidDefinition }) }),
      create: async () => undefined,
      list: async () => ({ items: [] }),
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => ({ ok: true }),
    };
    const actions = createWorkflowDefinitionActions({ artifactStore: store, encodeListCursor: () => 'cursor', assertDefinitionWriteAllowed: () => {} });
    await expect(actions.get({ definitionId })).rejects.toMatchObject({ code: 'content_unavailable' });
  });
});
