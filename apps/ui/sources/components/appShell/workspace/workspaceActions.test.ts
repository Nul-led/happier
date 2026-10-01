import { describe, expect, it } from 'vitest';
import { ActionIdSchema, isWorkspaceActionId } from '@happier-dev/protocol';
import { resolveCompactAppDestinations } from '../destinations/compactAppDestinationCatalog';
import { installPanelCommonModuleMocks } from '@/components/ui/panels/panelTestHelpers';
import { createWorkspaceActionAdapter } from './workspaceActions';
import { createWorkspaceNavigationAdapter } from './workspaceNavigationAdapter';
import { createWorkspaceEmptyTab, createWorkspaceState, reduceWorkspaceState } from './workspaceState';

installPanelCommonModuleMocks();

describe('workspace Action intent adapter', () => {
    it('reorders through the real navigation reducer and returns typed rejection for invalid positions', () => {
        let state = createWorkspaceState({ id: 'a', target: { kind: 'session', params: { id: 'a', serverId: 'home-a' } }, pinned: false, preview: false });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: createWorkspaceEmptyTab('b') });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: createWorkspaceEmptyTab('c') });
        const catalog = resolveCompactAppDestinations({ builtins: { externalSessions: false, inbox: true, workflows: true, friends: false }, pages: [] });
        let id = 0;
        const navigation = createWorkspaceNavigationAdapter({
            getState: () => state, getCatalog: () => catalog,
            dispatch: (action) => { state = reduceWorkspaceState(state, action); },
            transport: { commit: () => {} }, createId: () => `new:${++id}`, onChange: () => {},
        });
        const execute = createWorkspaceActionAdapter({ getState: () => state, navigation, readCanvas: () => null, createId: () => `new:${++id}` });
        navigation.initialize('/session/a?serverId=home-a');
        navigation.activateTab('group:1', 'c');
        const history = navigation.history;
        const actionId = ActionIdSchema.parse('workspace.tabs.reorder');
        if (!isWorkspaceActionId(actionId)) throw new Error('Expected a workspace Action');
        expect(execute(actionId, { tabId: 'a', index: 2 })).toEqual({ ok: true });
        expect(state.groups['group:1'].tabIds).toEqual(['b', 'c', 'a']);
        expect(state.groups['group:1'].activeTabId).toBe('c');
        const beforeInvalid = state;
        expect(execute(actionId, { tabId: 'a', index: 3 })).toMatchObject({ ok: false, errorCode: 'workspace_tab_index_out_of_range' });
        expect(execute(actionId, { tabId: 'a', index: -1 })).toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
        expect(execute(actionId, { tabId: 'a', index: 0.5 })).toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
        expect(execute(actionId, { tabId: 'missing', index: 0 })).toMatchObject({ ok: false, errorCode: 'workspace_tab_not_found' });
        expect(state).toBe(beforeInvalid);
        expect(navigation.history).toBe(history);
    });
});
