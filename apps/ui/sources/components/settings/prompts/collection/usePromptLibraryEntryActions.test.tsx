import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installPromptLibrarySettingsCommonModuleMocks,
    promptLibrarySettingsRouterBackSpy,
    promptLibrarySettingsRouterPushSpy,
} from '../promptLibrarySettingsTestHelpers';
import type { usePromptLibraryEntryActions } from './usePromptLibraryEntryActions';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const deleteArtifactMock = vi.hoisted(() => vi.fn(async () => undefined));
const modalConfirmMock = vi.hoisted(() => vi.fn(async () => true));
const duplicatePromptDocMock = vi.hoisted(() => vi.fn(async () => 'doc-1-copy'));
const duplicatePromptBundleMock = vi.hoisted(() => vi.fn(async () => 'bundle-1-copy'));
const modalAlertMock = vi.hoisted(() => vi.fn());
const setPromptInvocationsMock = vi.fn();
const setPromptStacksMock = vi.fn();
const setPromptExternalLinksMock = vi.fn();
const setPromptFoldersMock = vi.fn();

const useArtifactsMock = vi.hoisted(() => vi.fn(() => [
    {
        id: 'doc-1',
        title: 'Prompt One',
        header: { kind: 'prompt_doc.v2', title: 'Prompt One', origin: 'user', folderId: 'folder-1', tags: ['urgent', 'release'] },
    },
    {
        id: 'doc-2',
        title: 'Prompt Two',
        header: { kind: 'prompt_doc.v2', title: 'Prompt Two', origin: 'imported', tags: ['docs'] },
    },
]));

installPromptLibrarySettingsCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                confirm: modalConfirmMock,
                alert: modalAlertMock,
            },
        }).module;
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    groupped: { background: 'white' },
                    textSecondary: '#999',
                    input: { background: '#fff', text: '#111', placeholder: '#666' },
                    accent: { blue: '#00f', indigo: '#60f', purple: '#90f' },
                    deleteAction: '#f00',
                    button: { secondary: { tint: '#777' } },
                },
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: {
                push: promptLibrarySettingsRouterPushSpy,
                back: promptLibrarySettingsRouterBackSpy,
            },
        });
        return routerMock.module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useArtifacts: () => useArtifactsMock(),
            useAllMachines: () => [],
            useSettingMutable: (key: string) => {
                if (key === 'promptInvocationsV1') return [{ v: 1, entries: [{ id: 'template-1', target: { kind: 'doc', artifactId: 'doc-1' } }] }, setPromptInvocationsMock];
                if (key === 'promptStacksV1') {
                    return [{
                        v: 1,
                        surfaces: {
                            coding: [{ id: 'stack-1', ref: { kind: 'doc', artifactId: 'doc-1' }, enabled: true, placement: 'system_append', editPolicy: 'user_only' }],
                            voice: [],
                            profilesById: {},
                        },
                    }, setPromptStacksMock];
                }
                if (key === 'promptExternalLinksV1') {
                    return [{
                        v: 1,
                        links: [
                            {
                                id: 'link-1',
                                artifactId: 'doc-1',
                                assetTypeId: 'claude.command',
                                machineId: 'machine-1',
                                scope: 'user',
                                workspacePath: null,
                                externalRef: { relativePath: 'qa.md' },
                                lastExternalDigest: 'digest-1',
                            },
                        ],
                    }, setPromptExternalLinksMock];
                }
                if (key === 'promptFoldersV1') {
                    return [{
                        v: 1,
                        folders: [
                            { id: 'folder-1', name: 'Ops', parentId: null },
                        ],
                    }, setPromptFoldersMock];
                }
                return [null, vi.fn()];
            },
            storage: {
                getState: () => ({
                    deleteArtifact: vi.fn(),
                }),
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        getCredentials: () => ({ token: 'token' }),
    },
}));

vi.mock('@/sync/api/artifacts/apiArtifacts', () => ({
    deleteArtifact: deleteArtifactMock,
}));

vi.mock('@/sync/ops/promptLibrary/promptDocs', async () => {
    const actual = await vi.importActual<any>('@/sync/ops/promptLibrary/promptDocs');
    return {
        ...actual,
        duplicatePromptDoc: duplicatePromptDocMock,
    };
});

vi.mock('@/sync/ops/promptLibrary/promptBundles', async () => {
    const actual = await vi.importActual<any>('@/sync/ops/promptLibrary/promptBundles');
    return {
        ...actual,
        duplicatePromptBundle: duplicatePromptBundleMock,
    };
});

type EntryActions = ReturnType<typeof usePromptLibraryEntryActions>;

/** Renders the hook the prompt and skill editors' `⋯` menus call, and hands its actions to the test. */
async function renderEntryActions(kind: 'doc' | 'bundle'): Promise<EntryActions> {
    // Imported per test, after the shared module mocks are configured for this file.
    const { usePromptLibraryEntryActions: useEntryActions } = await import('./usePromptLibraryEntryActions');
    let actions: EntryActions | null = null;
    function Probe() {
        actions = useEntryActions(kind);
        return null;
    }
    await renderScreen(<Probe />);
    if (!actions) throw new Error('entry actions not rendered');
    return actions;
}

describe('usePromptLibraryEntryActions', () => {
    beforeEach(() => {
        deleteArtifactMock.mockClear();
        modalConfirmMock.mockClear();
        promptLibrarySettingsRouterPushSpy.mockClear();
        promptLibrarySettingsRouterBackSpy.mockClear();
        setPromptInvocationsMock.mockClear();
        setPromptStacksMock.mockClear();
        setPromptExternalLinksMock.mockClear();
        setPromptFoldersMock.mockClear();
        duplicatePromptDocMock.mockClear();
        duplicatePromptBundleMock.mockClear();
        modalAlertMock.mockClear();
    });

    it('deletes a prompt artifact and prunes linked template, stack, and external-link references', async () => {
        const actions = await renderEntryActions('doc');
        let removed = false;

        await act(async () => {
            removed = await actions.remove('doc-1');
        });

        expect(removed).toBe(true);
        expect(deleteArtifactMock).toHaveBeenCalledWith({ token: 'token' }, 'doc-1');
        expect(setPromptInvocationsMock).toHaveBeenCalledWith({ v: 1, entries: [] });
        expect(setPromptStacksMock).toHaveBeenCalledWith({
            v: 1,
            surfaces: {
                coding: [],
                voice: [],
                profilesById: {},
            },
        });
        expect(setPromptExternalLinksMock).toHaveBeenCalledWith({ v: 1, links: [] });
    });

    it('duplicates a prompt artifact and opens the copy in the collection', async () => {
        const actions = await renderEntryActions('doc');

        await act(async () => {
            await actions.duplicate('doc-1');
        });

        expect(duplicatePromptDocMock).toHaveBeenCalledWith('doc-1');
        expect(promptLibrarySettingsRouterPushSpy).toHaveBeenCalledWith('/settings/prompts/docs/doc-1-copy');
    });

    it('keeps local references unchanged when deleting a prompt artifact fails', async () => {
        deleteArtifactMock.mockRejectedValueOnce(new Error('delete failed'));
        const actions = await renderEntryActions('doc');
        let removed = true;

        await act(async () => {
            removed = await actions.remove('doc-1');
        });

        expect(removed).toBe(false);
        expect(setPromptInvocationsMock).not.toHaveBeenCalled();
        expect(setPromptStacksMock).not.toHaveBeenCalled();
        expect(setPromptExternalLinksMock).not.toHaveBeenCalled();
        expect(modalAlertMock).toHaveBeenCalledWith('common.error', 'errors.unknownError');
    });

    it('shows an error and stays on the current screen when duplication fails', async () => {
        duplicatePromptDocMock.mockRejectedValueOnce(new Error('copy failed'));
        const actions = await renderEntryActions('doc');

        await act(async () => {
            await actions.duplicate('doc-1');
        });

        expect(promptLibrarySettingsRouterPushSpy).not.toHaveBeenCalled();
        expect(modalAlertMock).toHaveBeenCalledWith('common.error', 'errors.unknownError');
    });
});
