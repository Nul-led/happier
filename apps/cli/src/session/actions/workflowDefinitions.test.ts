import {
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  isExternalActionResultWithinResponseEnvelopeLimitV1,
} from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { encodeAccountArtifactListCursor, type createAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';

import { createWorkflowDefinitionActions } from './workflowDefinitions';

const definitionBody = JSON.stringify({
  kind: 'workflow-definition.v1',
  definition: {
    version: 1,
    defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
    blocks: [{ kind: 'step', id: 'step-1', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
  },
});

type ArtifactCreateInput = Parameters<ReturnType<typeof createAccountArtifactStore>['create']>[0];

describe('workflow definition Actions', () => {
  it('normalizes through the canonical workflow validator before Artifact create', async () => {
    const create = vi.fn(async (_input: ArtifactCreateInput) => ({ artifactId: 'definition-1', revision: { headerVersion: 1, bodyVersion: 1 } }));
    const read = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(async () => {
        const request = create.mock.calls[0]![0];
        return { artifactId: 'definition-1', header: request.header, body: request.body,
          revision: { headerVersion: 1, bodyVersion: 1 }, seq: 1, createdAt: 1, updatedAt: 1 };
      });
    const actions = createWorkflowDefinitionActions({ artifactStore: { create, read } as never });
    await actions.create({ definitionId: 'definition-1', metadata: { title: 'Review' },
      definition: { version: 1, defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } }, blocks: ['Review this'] } });
    expect(create).toHaveBeenCalledOnce();
    const body = JSON.parse(create.mock.calls[0]![0].body);
    expect(body.kind).toBe('workflow-definition.v1');
    expect(body.definition.blocks[0]).toMatchObject({ kind: 'step', id: 'wf--step-0' });
  });

  it('rejects invalid definitions without writing', async () => {
    const create = vi.fn();
    const actions = createWorkflowDefinitionActions({ artifactStore: { create, read: vi.fn() } as never });
    await expect(actions.create({ definitionId: 'definition-1', metadata: { title: 'Review' }, definition: { blocks: [] } }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a definition header whose identity or current revision disagrees with the Artifact row', async () => {
    const read = vi.fn(async () => ({
      artifactId: 'definition-1',
      header: {
        kind: 'workflow-definition.v1',
        definitionId: 'definition-2',
        revision: { headerVersion: 1, bodyVersion: 1 },
        metadata: { title: 'Wrong identity' },
      },
      body: JSON.stringify({
        kind: 'workflow-definition.v1',
        definition: {
          version: 1,
          defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
          blocks: [{ kind: 'step', id: 'step-1', document: { text: 'Work', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
        },
      }),
      revision: { headerVersion: 2, bodyVersion: 2 },
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const actions = createWorkflowDefinitionActions({ artifactStore: { read } as never });

    await expect(actions.get({ definitionId: 'definition-1' }))
      .rejects.toMatchObject({ code: 'content_unavailable' });
  });

  it('continues across sparse encrypted-header pages without dropping the next matching row', async () => {
    const workflowHeader = (id: string, updatedAt: number) => ({ artifactId: id, updatedAt, headerVersion: 1,
      seq: updatedAt, createdAt: updatedAt, header: { kind: 'workflow-definition.v1', definitionId: id,
        revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: id } } });
    const definitionOne = '11111111-1111-4111-8111-111111111111';
    const definitionTwo = '22222222-2222-4222-8222-222222222222';
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [{ ...workflowHeader('other', 3), header: { kind: 'prompt_doc.v2' } }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: [workflowHeader(definitionOne, 2), workflowHeader(definitionTwo, 1)] });
    const actions = createWorkflowDefinitionActions({ artifactStore: { list } as never });
    await expect(actions.list({ limit: 1 })).resolves.toMatchObject({
      definitions: [{ definitionId: definitionOne }], nextCursor: expect.any(String),
    });
    expect(list).toHaveBeenNthCalledWith(2, { limit: 500, cursor: 'page-2' });
  });

  it('fails closed when private header identity/currentness disagrees with the Artifact row', async () => {
    const definitionId = '11111111-1111-4111-8111-111111111111';
    const read = vi.fn(async () => ({
      artifactId: definitionId,
      header: {
        kind: 'workflow-definition.v1',
        definitionId,
        revision: { headerVersion: 1, bodyVersion: 1 },
        metadata: { title: 'Review' },
      },
      body: JSON.stringify({
        kind: 'workflow-definition.v1',
        definition: {
          version: 1,
          defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
          blocks: [{ kind: 'step', id: 'step-1', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
        },
      }),
      revision: { headerVersion: 2, bodyVersion: 1 },
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const actions = createWorkflowDefinitionActions({ artifactStore: { read } as never });

    await expect(actions.get({ definitionId })).rejects.toMatchObject({ code: 'content_unavailable' });
  });

  it('shortens a page by the complete public Action response envelope and replays the omitted row', async () => {
    const definitionOne = '11111111-1111-4111-8111-111111111111';
    const definitionTwo = '22222222-2222-4222-8222-222222222222';
    const row = (id: string, updatedAt: number, description: string) => ({ artifactId: id, updatedAt, headerVersion: 1,
      seq: updatedAt, createdAt: updatedAt, header: { kind: 'workflow-definition.v1', definitionId: id,
        revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: id, description } } });
    const partialBytes = (rows: ReadonlyArray<ReturnType<typeof row>>) => Buffer.byteLength(
      JSON.stringify({ ok: true, result: { definitions: rows.map((candidate) => candidate.header) } }), 'utf8');
    const rowOne = row(definitionOne, 2, 'x'.repeat(12_000_000));
    const rowTwo = row(definitionTwo, 1, 'x'.repeat(
      EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES - partialBytes([rowOne, row(definitionTwo, 1, '')])));
    // Both rows fit the former partial `{ ok, result }` measure exactly; only the
    // public `v`/`actionId`/`requestId` framing pushes the candidate page over.
    expect(partialBytes([rowOne, rowTwo])).toBe(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES);
    const list = vi.fn(async ({ cursor }: { cursor?: string }) => cursor === encodeAccountArtifactListCursor(rowOne)
      ? { items: [rowTwo] }
      : { items: [rowOne, rowTwo] });
    const actions = createWorkflowDefinitionActions({ artifactStore: { list } as never });

    const firstPage = await actions.list({});
    expect(firstPage.definitions.map((definition) => definition.definitionId)).toEqual([definitionOne]);
    expect(firstPage.nextCursor).toBe(encodeAccountArtifactListCursor(rowOne));
    expect(isExternalActionResultWithinResponseEnvelopeLimitV1(firstPage)).toBe(true);

    const secondPage = await actions.list({ cursor: firstPage.nextCursor });
    expect(secondPage).toEqual({ definitions: [rowTwo.header] });
    expect(list).toHaveBeenLastCalledWith({ limit: 500, cursor: firstPage.nextCursor });
  });

  describe('delete', () => {
    const definitionId = '11111111-1111-4111-8111-111111111111';
    const headerFor = (id: string, revision: { headerVersion: number; bodyVersion: number }) => ({
      kind: 'workflow-definition.v1', definitionId: id, revision, metadata: { title: 'Review' },
    });
    const artifactWith = (header: ReturnType<typeof headerFor>) => ({
      artifactId: definitionId, header, body: definitionBody,
      revision: { headerVersion: 2, bodyVersion: 2 }, seq: 1, createdAt: 1, updatedAt: 1,
    });

    it('refuses to delete when the valid header identity or revision disagrees with the Artifact row', async () => {
      for (const header of [
        headerFor('22222222-2222-4222-8222-222222222222', { headerVersion: 2, bodyVersion: 2 }),
        headerFor(definitionId, { headerVersion: 2, bodyVersion: 1 }),
      ]) {
        const remove = vi.fn(async () => ({ ok: true as const }));
        const actions = createWorkflowDefinitionActions({
          artifactStore: { read: vi.fn(async () => artifactWith(header)), delete: remove } as never,
        });
        await expect(actions.delete({ definitionId })).rejects.toMatchObject({ code: 'content_unavailable' });
        expect(remove).not.toHaveBeenCalled();
      }
    });

    it('deletes through the incumbent Artifact owner when the exact header matches the row', async () => {
      const remove = vi.fn(async () => ({ ok: true as const }));
      const actions = createWorkflowDefinitionActions({
        artifactStore: { read: vi.fn(async () => artifactWith(headerFor(definitionId, { headerVersion: 2, bodyVersion: 2 }))), delete: remove } as never,
      });
      await expect(actions.delete({ definitionId })).resolves.toEqual({ deleted: true, definitionId });
      expect(remove).toHaveBeenCalledWith(definitionId);
    });
  });
});
