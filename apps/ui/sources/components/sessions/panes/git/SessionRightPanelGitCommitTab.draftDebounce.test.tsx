import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { createThemeFixture } from '@/dev/testkit/fixtures/themeFixtures';
import { installSessionGitPaneCommonModuleMocks } from './sessionGitPaneTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const gitCommitTabTheme = createThemeFixture();
import { readSessionScmDraft, resetSessionDraftValueCachesForTests } from '@/dev/testkit/sessionDraftRepositoryTestkit';

vi.mock('@/sync/domains/state/browserRecordStorage', async () => {
    const { createBrowserRecordStorageModuleMock } = await import('@/dev/testkit/mocks/browserRecordStorage');
    return createBrowserRecordStorageModuleMock();
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({ importOriginal, tokenStorage: { getCredentialsForServerUrl: async () => ({ token: 'header.' + Buffer.from(JSON.stringify({ sub: 'account-git-draft' })).toString('base64') + '.signature', secret: '' }) } });
});

installSessionGitPaneCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            FlatList: 'FlatList',
            ScrollView: 'ScrollView',
            Pressable: 'Pressable',
            Platform: {
                select: (value: any) => value?.default ?? null,
                OS: 'web',
            },
            AppState: {
                currentState: 'active',
                addEventListener: () => ({ remove: () => {} }),
            },
        });
    },
});

describe('SessionRightPanelGitCommitTab (draft debounce)', () => {
    it('debounces typing into the session draft and restores the persisted message after remount', async () => {
        resetSessionDraftValueCachesForTests();
        const { prepareSessionDraftPersistenceStorage } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
        await prepareSessionDraftPersistenceStorage();
        const { upsertServerProfile, resolveServerProfileScopeIdForIdentifier } = await import('@/sync/domains/server/serverProfiles');
        const profile = await upsertServerProfile({ serverUrl: 'https://git-draft.example.test', name: 'Git draft test' });
        const scope = { serverId: resolveServerProfileScopeIdForIdentifier(profile.id), accountId: 'account-git-draft' };
        const { useSessionScmDraft } = await import('@/hooks/session/sourceControl/useSessionScmDraft');
        let available = false;
        const { SessionRightPanelGitCommitTab } = await import('./SessionRightPanelGitCommitTab');

        function Controller() {
            const draft = useSessionScmDraft({ sessionId: 's1', serverId: profile.id });
            available = draft.available;
            return <SessionRightPanelGitCommitTab
            theme={gitCommitTabTheme}
            sessionId="s1"
            sessionPath="/workspace"
            backendLabel="Git"
            commitActionLabel="Commit"
            scmSnapshot={null}
            hasConflicts={false}
            scmOperationBusy={false}
            scmOperationStatus={null}
            hasGlobalOperationInFlight={false}
            inFlightScmOperation={null}
            commitAllowed={false}
            commitBlockedMessage={null}
            changedFilesViewMode="repository"
            sessionAttribution={{ confidence: 'unknown', reason: 'unavailable' }}
            sessionCheckpointOverlap="unknown"

            allRepositoryChangedFiles={[] as any}
            sessionAttributedFiles={[] as any}
            repositoryOnlyFiles={[] as any}

            repositorySelectedCount={0}
            onSelectAll={() => {}}
            onSelectNone={() => {}}
            disableSelectAll={true}
            disableSelectNone={true}
            onFilePress={() => {}}
            onFilePressPinned={() => {}}
            onToggleSelectionForFile={() => {}}
            renderFileActions={() => null}
            renderFileTrailingActions={() => null}
            commitDraftMessage={draft.draft.commitMessage}
            onCommitDraftMessageChange={draft.setCommitMessage}
            onCommitFromMessage={() => {}}
            commitMessageGeneratorEnabled={false}
            onGenerateCommitMessageSuggestion={async () => ({ ok: true, message: '' })}
            scmStatusFiles={null}
            showCommitComposer={true}
        />;
        }
        const screen = await renderScreen(<Controller />);
        await flushHookEffects({ cycles: 3 });
        expect(available).toBe(true);


        vi.useFakeTimers();
        try {
            act(() => {
                screen.changeTextByTestId('scm-commit-message', 'h');
                screen.changeTextByTestId('scm-commit-message', 'he');
                screen.changeTextByTestId('scm-commit-message', 'hel');
            });
            expect(readSessionScmDraft(scope, 's1').commitMessage).toBe('');
            await act(async () => { vi.advanceTimersByTime(350); });
            expect(readSessionScmDraft(scope, 's1').commitMessage).toBe('hel');
        } finally {
            vi.useRealTimers();
        }
        await act(async () => { screen.tree.unmount(); });
        const remounted = await renderScreen(<Controller />);
        await flushHookEffects({ cycles: 3 });
        expect(remounted.findByTestId('scm-commit-message')?.props.value).toBe('hel');
    });
});
