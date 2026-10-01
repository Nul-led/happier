import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import type { WorkflowBlock } from '@happier-dev/protocol/workflows/workflowV1';

type ParallelBlock = Extract<WorkflowBlock, Readonly<{ kind: 'parallel' }>>;

/**
 * The group's conversation statement must match what the branches actually
 * run: separate conversations only where every step runs fresh, otherwise the
 * shared conversation the branches take turns in. It must never claim
 * separation the canonical authoring facts do not support.
 */

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (
            params ? `${key}:${JSON.stringify(params)}` : key
        ),
    });
});

afterEach(async () => {
    await standardCleanup();
});

function parallelBlock(): ParallelBlock {
    return {
        kind: 'parallel',
        id: 'p1',
        failurePolicy: 'fail_stop',
        branches: [{
            id: 'b1',
            blocks: [{
                kind: 'step',
                id: 'step-a',
                document: { text: 'Do the work', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }],
    };
}

async function renderGroup(branchesUseSeparateConversations: boolean) {
    const { WorkflowGroupOptions } = await import('./WorkflowGroupEditor');
    const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
    const block = parallelBlock();
    // Branches use separate conversations only when every step's effective
    // conversation is fresh; the workflow default decides it here.
    const draft = draftModule.createWorkflowEditorDraft({
        draftId: 'draft-1',
        name: 'Group',
        blocks: [block],
        ...(branchesUseSeparateConversations ? { defaults: { conversation: { kind: 'fresh' as const } } } : {}),
    });
    return renderScreen(
        <WorkflowGroupOptions
            draft={draft}
            block={block}
            onChange={() => {}}
            testIDPrefix="editor"
        />,
    );
}

describe('WorkflowGroupEditor conversation disclosure', () => {
    it('states the shared conversation under the shared default instead of claiming separation', async () => {
        const screen = await renderGroup(false);

        expect(screen.findByTestId('editor-parallel-p1-shared-conversation')).not.toBeNull();
        expect(screen.getTextContent()).toContain('workflows.conversation.branchesShareAndTakeTurns');
        expect(screen.getTextContent()).not.toContain('workflows.conversation.branchesUseSeparate');
    });

    it('keeps the separate-conversations statement only where every branch runs fresh', async () => {
        const screen = await renderGroup(true);

        expect(screen.findByTestId('editor-parallel-p1-separate-conversations')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('workflows.conversation.branchesShareAndTakeTurns');
    });
});
