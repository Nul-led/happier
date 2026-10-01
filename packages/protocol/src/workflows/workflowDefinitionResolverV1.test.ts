import { describe, expect, it } from 'vitest';
import { resolveWorkflowDefinitionRefV1 } from './workflowDefinitionResolverV1.js';

const artifactId = '11111111-1111-4111-8111-111111111111';

describe('workflow reference resolution', () => {
  it('retains the authorized Artifact reader definition and revision as one saved source', async () => {
    const saved = { definition: { version: 1, blocks: [] }, definitionId: artifactId,
      revision: { headerVersion: 2, bodyVersion: 3 }, metadata: { name: 'Saved workflow' } };
    await expect(resolveWorkflowDefinitionRefV1(artifactId, {
      readArtifact: async (id) => { expect(id).toBe(artifactId); return saved; },
    })).resolves.toEqual({ ...saved, kind: 'saved', sourceKey: artifactId });
  });

  it('refuses unavailable sources and unsupported plugin refs without an Artifact read', async () => {
    for (const ref of ['builtin:unknown', 'builtin:plan-with-a-panel ', 'plugin:example/workflow', 'not-a-ref']) {
      await expect(resolveWorkflowDefinitionRefV1(ref, {
        readArtifact: async () => { throw new Error('must_not_read_artifact'); },
      })).resolves.toBeNull();
    }
    await expect(resolveWorkflowDefinitionRefV1(artifactId, { readArtifact: async () => null })).resolves.toBeNull();
    await expect(resolveWorkflowDefinitionRefV1(artifactId, {
      readArtifact: async () => { throw Object.assign(new Error('missing'), { code: 'content_unavailable' }); },
    })).resolves.toBeNull();
  });

  it('preserves transport uncertainty and cancellation rather than declaring a deleted source', async () => {
    const unavailable = new Error('transport_offline');
    await expect(resolveWorkflowDefinitionRefV1(artifactId, {
      readArtifact: async () => { throw unavailable; },
    })).rejects.toBe(unavailable);
    const controller = new AbortController();
    const aborted = new Error('caller_aborted');
    await expect(resolveWorkflowDefinitionRefV1(artifactId, { signal: controller.signal,
      readArtifact: async (_id, signal) => {
        expect(signal).toBe(controller.signal);
        controller.abort(aborted);
        throw Object.assign(new Error('content_unavailable'), { code: 'content_unavailable' });
      },
    })).rejects.toBe(aborted);
    await expect(resolveWorkflowDefinitionRefV1('builtin:plan-with-a-panel', { signal: controller.signal })).rejects.toBe(aborted);
  });
});
