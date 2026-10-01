import { describe, expect, it } from 'vitest';

import {
    createWorkspaceNavigationHistory,
    recordWorkspaceNavigation,
    restoreWorkspaceNavigationEntry,
    stepWorkspaceNavigation,
} from './workspaceNavigationHistory';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';

const destination = (id: string) => ({ kind: 'session', params: { id, serverId: 'home-1' } });
const entry = (tabId: string, groupId: string, id: string) => ({ tabId, groupId, target: destination(id) });

describe('workspace global navigation history', () => {
    it('walks what the user looked at across tab changes', () => {
        let history = createWorkspaceNavigationHistory();
        history = recordWorkspaceNavigation(history, entry('tab-a', 'group-1', 'A1'));
        history = recordWorkspaceNavigation(history, entry('tab-a', 'group-1', 'A2'));
        history = recordWorkspaceNavigation(history, entry('tab-b', 'group-2', 'B1'));

        const visited: string[] = [];
        for (const direction of [-1, -1, 1, 1] as const) {
            const result = stepWorkspaceNavigation(history, direction);
            history = result.history;
            visited.push(`${result.entry?.tabId}:${result.entry?.target.params.id}`);
        }
        expect(visited).toEqual(['tab-a:A2', 'tab-a:A1', 'tab-a:A2', 'tab-b:B1']);
    });

    it('returns the closed tab identity for the layout owner to reopen as preview and drops the forward branch', () => {
        let history = createWorkspaceNavigationHistory();
        history = recordWorkspaceNavigation(history, entry('closed-tab', 'old-group', 'A1'));
        history = recordWorkspaceNavigation(history, entry('open-tab', 'new-group', 'B1'));
        const back = stepWorkspaceNavigation(history, -1);
        expect(back.entry).toEqual(entry('closed-tab', 'old-group', 'A1'));
        history = recordWorkspaceNavigation(back.history, entry('open-tab', 'new-group', 'B2'));
        expect(stepWorkspaceNavigation(history, 1).entry).toBeNull();
        expect(history.entries.map((item) => item.target.params.id)).toEqual(['A1', 'B2']);
    });

    it('restores the destination and focus of each global entry, reopening a closed tab as preview', () => {
        let state = createWorkspaceState({ id: 'tab-a', target: destination('A1'), pinned: true, preview: false });
        let history = createWorkspaceNavigationHistory();
        history = recordWorkspaceNavigation(history, entry('tab-a', 'group:1', 'A1'));
        state = reduceWorkspaceState(state, { type: 'setTarget', tabId: 'tab-a', target: destination('A2') });
        history = recordWorkspaceNavigation(history, entry('tab-a', 'group:1', 'A2'));
        state = reduceWorkspaceState(state, {
            type: 'openTab', groupId: 'group:1',
            tab: { id: 'tab-b', target: destination('B1'), pinned: true, preview: false },
        });
        history = recordWorkspaceNavigation(history, entry('tab-b', 'group:1', 'B1'));

        for (const [direction, expected] of [[-1, 'A2'], [-1, 'A1'], [1, 'A2'], [1, 'B1']] as const) {
            const step = stepWorkspaceNavigation(history, direction);
            history = step.history;
            state = restoreWorkspaceNavigationEntry(state, step.entry!);
            const active = state.groups[state.focusedGroupId].activeTabId;
            expect(state.tabs[active].target.params.id).toBe(expected);
        }

        state = reduceWorkspaceState(state, {
            type: 'closeTab', groupId: 'group:1', tabId: 'tab-a',
            newTab: { id: 'tab-empty', target: { kind: 'newTab', params: {} }, pinned: false, preview: false },
        });
        expect(state.tabs['tab-a']).toBeUndefined();
        const back = stepWorkspaceNavigation(history, -1);
        state = restoreWorkspaceNavigationEntry(state, back.entry!);
        expect(state.tabs['tab-a']).toMatchObject({ target: destination('A2'), preview: true, pinned: false });
        expect(state.groups[state.focusedGroupId].activeTabId).toBe('tab-a');
    });

    it('reopens a tab in the focused group when its former group is gone', () => {
        const state = createWorkspaceState({ id: 'tab-b', target: destination('B1'), pinned: true, preview: false });
        const restored = restoreWorkspaceNavigationEntry(state, entry('closed-tab', 'removed-group', 'A1'));
        expect(restored.tabs['closed-tab']).toMatchObject({ target: destination('A1'), preview: true });
        expect(restored.groups['group:1'].activeTabId).toBe('closed-tab');
    });
});
