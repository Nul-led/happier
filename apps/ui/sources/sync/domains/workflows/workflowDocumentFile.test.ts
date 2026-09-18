import { describe, expect, it, vi } from 'vitest';

import {
  readPickedWorkflowDocument,
  saveWorkflowDocumentWithRuntime,
} from './workflowDocumentFile';
import { importWorkflowDocument } from './workflowInterchange';
import { createWorkflowEditorDraft } from './workflowEditorDraft';

describe('workflow document file boundary', () => {
  it('reads both browser and native picker results through their platform owner', async () => {
    const readNative = vi.fn(async () => '{"native":true}');
    const web = await readPickedWorkflowDocument(
      { kind: 'web', file: new File(['{"web":true}'], 'review.json') },
      readNative,
    );
    const native = await readPickedWorkflowDocument(
      { kind: 'native', uri: 'file:///review.json', name: 'review.json', sizeBytes: null, mimeType: 'application/json' },
      readNative,
    );

    expect(web).toBe('{"web":true}');
    expect(native).toBe('{"native":true}');
    expect(readNative).toHaveBeenCalledWith('file:///review.json');
  });

  it('downloads on web and shares on native without changing the JSON', async () => {
    const downloadWeb = vi.fn(async () => undefined);
    const shareNative = vi.fn(async () => undefined);
    const artifact = { fileName: 'review.workflow.json', json: '{"kind":"happier.workflow"}' };

    await saveWorkflowDocumentWithRuntime(artifact, { platformOS: 'web', downloadWeb, shareNative });
    expect(downloadWeb).toHaveBeenCalledWith(artifact);
    expect(shareNative).not.toHaveBeenCalled();

    await saveWorkflowDocumentWithRuntime(artifact, { platformOS: 'ios', downloadWeb, shareNative });
    expect(shareNative).toHaveBeenCalledWith(artifact);
  });

  it('reads and canonically imports the 500-file workflow without truncation or an invented size limit', async () => {
    const files = Array.from({ length: 500 }, (_, index) => `src/file-${index}.ts`);
    const source = JSON.stringify({
      kind: 'happier.workflow',
      version: 1,
      definition: {
        version: 1,
        inputs: [],
        defaults: {},
        blocks: [{
          kind: 'loop',
          id: 'review-files',
          body: ['Review the current file'],
          repetition: {
            kind: 'items',
            items: { kind: 'literal', value: files },
            execution: 'parallel',
            failurePolicy: 'collect_outcomes',
          },
        }],
      },
    });
    const pickedText = await readPickedWorkflowDocument(
      { kind: 'web', file: new File([source], 'review-500.workflow.json') },
      async () => { throw new Error('native reader should not be used'); },
    );
    const imported = importWorkflowDocument({
      source: pickedText,
      currentDraft: createWorkflowEditorDraft({ draftId: 'current' }),
      draftId: 'imported',
      context: {
        agentTarget: {
          kind: 'agent',
          identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
        },
      },
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const loop = imported.definition.blocks[0];
    expect(loop?.kind).toBe('loop');
    if (loop?.kind !== 'loop' || loop.repetition.kind !== 'items') return;
    expect(loop.repetition.items.kind).toBe('literal');
    if (loop.repetition.items.kind !== 'literal') return;
    expect(loop.repetition.items.value).toEqual(files);
  });
});
