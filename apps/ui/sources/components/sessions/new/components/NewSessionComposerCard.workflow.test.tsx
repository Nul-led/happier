import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { createNewSessionPromptStore } from '../hooks/screenModel/newSessionPromptStore';
import { NewSessionComposerCard } from './NewSessionComposerCard';
import type { NewSessionSimplePanelProps } from './NewSessionSimplePanel';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('New workflow entry', () => {
    it('offers Workflow in the actual New composer without replacing the plain-session prompt', async () => {
        const panelProps = {
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
        const screen = await renderScreen(<NewSessionComposerCard panelProps={panelProps} layout="embedded" attachments={false} />);
        expect(screen.findByTestId('new-session-workflow-chip')).not.toBeNull();
        expect(screen.findByTestId('new-session-composer-input')?.props.value).toBe('Keep this brief');
    });
});
