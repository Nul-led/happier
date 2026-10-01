import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { createNewSessionPromptStore } from '../hooks/screenModel/newSessionPromptStore';
import { NewSessionComposerCard } from './NewSessionComposerCard';
import type { NewSessionSimplePanelProps } from './NewSessionSimplePanel';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { useNewSessionWorkflowStart } from '../hooks/useNewSessionWorkflowStart';
import { getStorage } from '@/sync/domains/state/storageStore';
import { act } from 'react-test-renderer';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => ({ serverId: 'server-a' }),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

function panelProps(): NewSessionSimplePanelProps {
    return {
            popoverBoundaryRef: React.createRef(), headerHeight: 0, safeAreaTop: 0, safeAreaBottom: 0,
            newSessionTopPadding: 0, newSessionSidePadding: 0, newSessionBottomPadding: 0, containerStyle: {},
            promptStore: createNewSessionPromptStore('Keep this brief'), setSessionPrompt: () => {},
            handleCreateSession: () => {}, canCreate: true, isCreating: false,
            emptyAutocompleteKinds: [], emptyAutocompleteSuggestions: async () => [],
            agentType: 'codex', handleAgentClick: undefined, permissionMode: 'default',
            handlePermissionModeChange: undefined, modelMode: 'default', setModelMode: undefined,
            modelOptions: [], connectionStatus: undefined, machineName: undefined, selectedPath: '/repo',
            useProfiles: false, selectedProfileId: null,
        } satisfies NewSessionSimplePanelProps;
}

describe('New workflow entry', () => {
    it('offers Workflow in the actual New composer without replacing the plain-session prompt', async () => {
        const screen = await renderScreen(<NewSessionComposerCard panelProps={panelProps()} layout="embedded" attachments={false} />);
        expect(screen.findByTestId('new-session-workflow-chip')).not.toBeNull();
        expect(screen.findByTestId('new-session-composer-input')?.props.value).toBe('Keep this brief');
    });
    it('keeps typed text as the first text input, then withdraws that private draft on Account change', async () => {
        getStorage().setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' } });
        const props = panelProps();
        const hook = await renderHook(() => useNewSessionWorkflowStart({ panelProps: props, prompt: 'Keep this brief' }));
        const content = hook.getCurrent().chip.collapsedContentPopover?.renderContent;
        if (typeof content !== 'function') throw new Error('Workflow picker content is missing');
        const pickerNode = content({ requestClose: () => {}, maxHeight: 420 });
        if (!React.isValidElement(pickerNode)) throw new Error('Workflow picker is missing');
        const picker = await renderScreen(pickerNode);
        await picker.pressByTestIdAsync('workflow-choice:builtin:plan-with-a-panel');
        const composer = hook.getCurrent().composer;
        if (composer === null) throw new Error('Selected workflow composer is missing');
        const screen = await renderScreen(composer);
        expect(screen.findByTestId('new-session-composer-input')?.props.value).toBe('Keep this brief');
        await act(async () => { getStorage().setState({ profileScope: { serverId: 'server-a', accountId: 'account-b' } }); });
        expect(hook.getCurrent().composer).toBeNull();
    });
});
