import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key });
});

afterEach(async () => {
    await standardCleanup();
});

const draft = {
    draftId: 'local-draft',
    name: 'Review',
    version: 1 as const,
    defaults: {},
    inputs: [],
    blocks: [{
        kind: 'step' as const,
        id: 'review',
        document: { text: 'Review local changes', references: [], attachments: [] },
        input: [],
        result: { kind: 'text' as const },
    }],
};

describe('WorkflowSaveStatus', () => {
    it('shows the exact successful Artifact revision as a quiet in-place receipt', async () => {
        const { WorkflowSaveStatus } = await import('./WorkflowSaveStatus');
        const screen = await renderScreen(React.createElement(WorkflowSaveStatus, {
            revision: { headerVersion: 4, bodyVersion: 7 },
            conflict: null,
            localDraft: draft,
            onSaveAsCopy: vi.fn(),
            testIDPrefix: 'workflow-editor',
        }));

        expect(screen.findByTestId('workflow-editor-saved-revision')).not.toBeNull();
        expect(screen.getTextContent()).toContain('h4 · b7');
    });

    it('retains the local document and offers comparison plus save-as-copy recovery', async () => {
        const { WorkflowSaveStatus } = await import('./WorkflowSaveStatus');
        const saveAsCopy = vi.fn();
        const currentDraft = { ...draft, draftId: 'current-draft', blocks: [{ ...draft.blocks[0], document: { ...draft.blocks[0].document, text: 'Review remote changes' } }] };
        const screen = await renderScreen(React.createElement(WorkflowSaveStatus, {
            revision: { headerVersion: 2, bodyVersion: 2 },
            conflict: { currentDraft, currentRevision: { headerVersion: 3, bodyVersion: 3 } },
            localDraft: draft,
            onSaveAsCopy: saveAsCopy,
            testIDPrefix: 'workflow-editor',
        }));

        expect(screen.getTextContent()).toContain('workflows.save.conflictBody');
        await screen.pressByTestIdAsync('workflow-editor-compare');
        expect(screen.getTextContent()).toContain('Review local changes');
        expect(screen.getTextContent()).toContain('Review remote changes');
        await screen.pressByTestIdAsync('workflow-editor-save-as-copy');
        expect(saveAsCopy).toHaveBeenCalledTimes(1);
    });

    it('omits Compare when the current Artifact cannot be read while keeping save-as-copy available', async () => {
        const { WorkflowSaveStatus } = await import('./WorkflowSaveStatus');
        const screen = await renderScreen(React.createElement(WorkflowSaveStatus, {
            revision: { headerVersion: 2, bodyVersion: 2 },
            conflict: { currentDraft: null, currentRevision: null },
            localDraft: draft,
            onSaveAsCopy: vi.fn(),
            testIDPrefix: 'workflow-editor',
        }));

        expect(screen.findByTestId('workflow-editor-compare')).toBeNull();
        expect(screen.findByTestId('workflow-editor-save-as-copy')).not.toBeNull();
    });
});
