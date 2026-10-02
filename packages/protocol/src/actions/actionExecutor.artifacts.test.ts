import { describe, expect, it } from 'vitest';

import { ActionIdSchema, type ActionId } from './actionIds.js';
import { getActionSpec } from './actionSpecs.js';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { resolveActionApprovalRouting } from './actionApprovalPolicy.js';
import { prepareArtifactHeaderForRevisionV1 } from '../artifacts/artifactHeaderRestorationV1.js';
import { buildWorkBoardArtifactHeaderV1, readWorkBoardArtifactSummaryV1 } from '../boards/workBoardArtifactV1.js';
import { createWorkBoardV1 } from '../boards/workBoardV1.js';

const ids = ['artifact.create', 'artifact.get', 'artifact.list', 'artifact.update', 'artifact.delete',
  'artifact.publish_from_file', 'artifact.revisions.list', 'artifact.revisions.restore', 'artifact.storage.usage'] as const;

describe('ordinary Artifact Actions', () => {
  it('keeps public-link secrets out of Action input and results and requires approval by default', () => {
    for (const id of ['artifact.public_link.create', 'artifact.public_link.list', 'artifact.public_link.revoke'] as const) {
      expect(ActionIdSchema.safeParse(id).success).toBe(true);
      const spec = getActionSpec(id as ActionId);
      const input = id.endsWith('revoke') ? { artifactId: 'artifact-1', shareId: 'share-1' } : { artifactId: 'artifact-1' };
      expect(spec.inputSchema.safeParse(input).success).toBe(true);
      expect(spec.inputSchema.safeParse({ ...input, secret: 'must-remain-local' }).success).toBe(false);
      if (id === 'artifact.public_link.create') expect(spec.inputSchema.safeParse({ ...input, expiresAt: 0 }).success).toBe(true);
      expect(spec.sideEffectClass).toBe(id === 'artifact.public_link.list' ? 'read' : 'write');
      expect(resolveActionApprovalRouting({ actionId: id as ActionId, spec,
        context: { surface: 'agent', authority: 'account_automation' } }).required).toBe(true);
      expect(spec.outputSchema.safeParse({ publicShare: { secret: 'must-remain-local' } }).success).toBe(false);
    }
  });
  it('offers reads and approval-based writes to Agents, MCP and CLI through the canonical catalog', () => {
    for (const id of ids) {
      expect(ActionIdSchema.safeParse(id).success).toBe(true);
      const spec = getActionSpec(id as ActionId);
      expect(spec.surfaces).toMatchObject({ agent: true, mcp: true, cli: true, ui: true });
      expect(spec.requiredAuthority).toBe('account_automation');
      const read = ['artifact.get', 'artifact.list', 'artifact.revisions.list', 'artifact.storage.usage'].includes(id);
      expect(spec.safety).toBe(read ? 'safe' : 'danger');
      expect(resolveActionApprovalRouting({ actionId: id as ActionId, spec,
        context: { surface: 'agent', authority: 'account_automation' } }).required).toBe(!read);
    }
  });

  it('settles quota refusal without losing the configured budget details', async () => {
    const quota = { ok: false, errorCode: 'quota_exceeded', error: 'quota_exceeded',
      details: { budget: 'account', limitBytes: 100, usedBytes: 110 } };
    const executor = createActionExecutor({ artifactAction: async () => quota,
      isActionApprovalRequired: () => false } as unknown as ActionExecutorDeps);
    expect(await executor.execute('artifact.create' as ActionId, { header: { title: 'Test' }, body: 'text' },
      { surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' } })).toMatchObject(quota);
  });

  it('requires a read revision for destructive mutation and refuses caller-authored publish provenance', () => {
    expect(getActionSpec('artifact.delete' as ActionId).inputSchema.safeParse({ artifactId: 'artifact-1' }).success).toBe(false);
    expect(getActionSpec('artifact.publish_from_file' as ActionId).inputSchema.safeParse({ path: 'result.md',
      source: { sessionId: 'foreign', machineId: 'foreign', path: '/private' } }).success).toBe(false);
  });

  it('accepts one caller-workspace upload path instead of text and refuses ambiguous or caller-authored blob inputs', () => {
    for (const id of ['artifact.create', 'artifact.update'] as const) {
      const spec = getActionSpec(id);
      const identity = id === 'artifact.update' ? { artifactId: 'artifact-1', expectedRevision: { headerVersion: 1, bodyVersion: 1 } } : {};
      expect(spec.inputSchema.safeParse({ ...identity, header: {}, uploadPath: 'images/result.png', mime: 'image/png' }).success).toBe(true);
      expect(spec.inputSchema.safeParse({ ...identity, header: {}, body: 'text', uploadPath: 'images/result.png' }).success).toBe(false);
      expect(spec.inputSchema.safeParse({ ...identity, header: {}, body: { blobId: 'foreign' } }).success).toBe(false);
    }
  });

  it('restores Board list and Inbox membership from the historical body, not the displaced header', () => {
    const current = createWorkBoardV1({ id: 'board-1', name: 'Current' });
    const historical = { ...current, name: 'Prior', pinnedInSessions: true,
      source: { picked: [], sections: ['needs_you'] } };
    const header = prepareArtifactHeaderForRevisionV1({ artifactId: current.id,
      header: { ...buildWorkBoardArtifactHeaderV1(current), source: { sessionId: 'session-1' } },
      body: JSON.stringify(historical), expectedRevision: { headerVersion: 2, bodyVersion: 2 },
      nextRevision: { headerVersion: 3, bodyVersion: 3 } });
    expect(readWorkBoardArtifactSummaryV1(current.id, header)).toEqual({
      id: 'board-1', name: 'Prior', pinnedInSessions: true, source: { sections: ['needs_you'] },
    });
    expect(header.source).toEqual({ sessionId: 'session-1' });
  });
});
