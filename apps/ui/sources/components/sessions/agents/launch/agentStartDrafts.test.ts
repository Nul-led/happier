import { describe, expect, it } from 'vitest';

import type { PaneDetailsStateView } from '@/components/appShell/panes/details/workspace/detailsWorkspaceTypes';

import { projectAgentStartDrafts } from './agentStartDrafts';

function tab(key: string, kind: string, resource: unknown) {
    return { key, kind, title: key, resource, isPreview: false, isPinned: false };
}

function details(tabs: ReturnType<typeof tab>[], activeTabKey: string | null, isOpen = true): PaneDetailsStateView {
    return {
        isOpen,
        tabState: {},
        tabs,
        activeTabKey,
        groups: [{ id: 'g1', tabKeys: tabs.map((entry) => entry.key), activeTabKey, tabs, isFocused: true }],
        root: null,
        focusedGroupId: 'g1',
        maximizedGroupId: null,
    };
}

describe('projectAgentStartDrafts', () => {
    it('lists each unsent start by what it will start, marking the one on screen', () => {
        const drafts = projectAgentStartDrafts(details([
            tab('execution-run-conversation-draft', 'executionRunLauncher', { kind: 'executionRunLauncher', mode: 'conversation' }),
            tab('execution-run-launcher:review', 'executionRunLauncher', { kind: 'executionRunLauncher', intent: 'review' }),
            tab('execution-run:run_1', 'executionRun', { kind: 'executionRun', runId: 'run_1' }),
            tab('execution-run-launcher', 'executionRunLauncher', { kind: 'executionRunLauncher' }),
        ], 'execution-run-launcher:review'));

        expect(drafts).toEqual([
            { tabKey: 'execution-run-conversation-draft', intent: null, active: false },
            { tabKey: 'execution-run-launcher:review', intent: 'review', active: true },
            // The intent-less launcher is "Advanced": a review with every choice.
            { tabKey: 'execution-run-launcher', intent: 'review', active: false },
        ]);
    });

    it('lists nothing once the draft has become its Run, and marks nothing while Details is closed', () => {
        expect(projectAgentStartDrafts(details([
            tab('execution-run:run_1', 'executionRun', { kind: 'executionRun', runId: 'run_1' }),
        ], 'execution-run:run_1'))).toEqual([]);
        expect(projectAgentStartDrafts(details([
            tab('execution-run-launcher:plan', 'executionRunLauncher', { kind: 'executionRunLauncher', intent: 'plan' }),
        ], 'execution-run-launcher:plan', false))[0]?.active).toBe(false);
    });
});
