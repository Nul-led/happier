import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHomeGovernanceHarness, installHomeGovernanceBoundaries } from '@/dev/testkit/harness/homeGovernanceHarness';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import { clearActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';

vi.mock('@react-navigation/native', async () => (await import('@/dev/testkit/mocks/reactNavigation')).createReactNavigationNativeMock());
installSettingsViewCommonModuleMocks();
vi.doUnmock('@/sync/domains/state/storage');
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
await loadSyncSingletonForTests();
const { PromptFoldersScreen } = await import('./PromptFoldersScreen');

beforeEach(async () => { await harness.reset(); clearActiveUnsavedChangesGuard(); });
afterEach(() => { standardCleanup(); clearActiveUnsavedChangesGuard(); });

describe('Prompt folder inline drafts through the Account settings writer', () => {
    it('saves a normalized folder only on Save and does not create a case-insensitive duplicate', async () => {
        const serverId = await harness.addHome({ name: 'Folders Home', serverUrl: 'https://folders.test', accountId: 'folder-owner' });
        await harness.selectHomes([serverId]);
        const scope = { serverId, accountId: 'folder-owner' };
        const { storage } = await import('@/sync/domains/state/storage');
        act(() => storage.setState({
            settingsScope: scope, profileScope: scope, settingsVersion: 1,
            settings: { ...storage.getState().settings, promptFoldersV1: { v: 1, folders: [] } },
        }));
        const screen = await renderScreen(<PromptFoldersScreen />);
        await screen.pressByTestIdAsync('promptFolders.add');
        await act(async () => screen.changeTextByTestId('promptFolders.draft.name', '  Release   notes  '));
        expect(storage.getState().settings.promptFoldersV1.folders).toHaveLength(0);
        await screen.pressByTestIdAsync('promptFolders.draft.save');
        const saved = storage.getState().settings.promptFoldersV1.folders;
        expect(saved).toEqual([{ id: expect.any(String), name: 'Release notes', parentId: null }]);
        await screen.pressByTestIdAsync('promptFolders.add');
        await act(async () => screen.changeTextByTestId('promptFolders.draft.name', 'release NOTES'));
        await screen.pressByTestIdAsync('promptFolders.draft.save');
        expect(storage.getState().settings.promptFoldersV1.folders).toEqual(saved);
    });
});
