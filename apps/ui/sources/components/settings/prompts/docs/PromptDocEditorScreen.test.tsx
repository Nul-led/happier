import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import {
    installPromptLibrarySettingsCommonModuleMocks,
    promptLibrarySettingsRouterBackSpy,
    promptLibrarySettingsRouterPushSpy,
    promptLibrarySettingsRouterReplaceSpy,
} from '../promptLibrarySettingsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const updatePromptDocSpy = vi.fn(async () => {});
const setPromptFoldersSpy = vi.fn();
/** Whether the screen currently asks the navigator to hold a departure (the unsaved-changes guard). */
const preventRemoveState = vi.hoisted(() => ({ last: null as boolean | null }));

// The navigator's remove interception is the navigation library boundary; record what the screen asks for.
vi.mock('@react-navigation/native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@react-navigation/native')>(),
    usePreventRemove: (preventRemove: boolean) => {
        preventRemoveState.last = preventRemove;
    },
}));
const promptExternalLinksState = vi.hoisted(() => ({
    value: {
        v: 1,
        links: [
            {
                id: 'link-1',
                artifactId: 'doc-1',
                assetTypeId: 'claude.command',
                machineId: 'machine-1',
                scope: 'user',
                workspacePath: null,
                externalRef: { relativePath: 'review/code.md' },
                lastExternalDigest: 'digest-1',
            },
        ],
    },
}));
const promptFoldersState = vi.hoisted(() => ({
    value: {
        v: 1,
        folders: [
            { id: 'folder-1', name: 'Ops', parentId: null },
        ],
    },
}));

installPromptLibrarySettingsCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            TextInput: 'TextInput',
            ScrollView: 'ScrollView',
            Platform: {
                OS: 'web',
                select: ({ web, default: defaultValue }: { web?: unknown; default?: unknown }) =>
                    web ?? defaultValue,
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: {
                back: promptLibrarySettingsRouterBackSpy,
                replace: promptLibrarySettingsRouterReplaceSpy,
                push: promptLibrarySettingsRouterPushSpy,
            },
            navigation: { canGoBack: () => false },
        });
        return routerMock.module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useAllMachines: () => [
                {
                    id: 'machine-1',
                    metadata: {
                        displayName: 'Laptop',
                        host: 'laptop.local',
                    },
                },
            ],
            useSetting: (key: string) => {
                if (key === 'promptExternalLinksV1') return promptExternalLinksState.value;
                return null;
            },
            useSettingMutable: (key: string) => {
                if (key === 'promptFoldersV1') {
                    return [promptFoldersState.value, setPromptFoldersSpy];
                }
                return [null, vi.fn()];
            },
            storage: {
                getState: () => ({
                    artifacts: {
                        'doc-1': {
                            id: 'doc-1',
                            header: { title: 'Doc title', folderId: 'folder-1', tags: ['alpha', 'beta'] },
                            body: JSON.stringify({
                                v: 1,
                                markdown: 'existing markdown',
                                createdAtMs: 1,
                                updatedAtMs: 2,
                            }),
                        },
                    },
                    updateArtifact: vi.fn(),
                }),
            },
        });
    },
});

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 960 },
    useLayoutMaxWidth: () => 960,
    useLayoutMaxWidthStyle: () => ({ maxWidth: 960 }),
}));

vi.mock('@/components/ui/markdown/editor/MarkdownCodeEditorField', () => ({
    MarkdownCodeEditorField: ({ onChange, ...props }: any) => React.createElement('MarkdownCodeEditorField', {
        ...props,
        onChangeText: onChange,
    }),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        getCredentials: () => ({ ok: true }),
        fetchArtifactWithBody: vi.fn(async () => null),
    },
}));

vi.mock('@/sync/ops/promptLibrary/promptDocs', () => ({
    createPromptDoc: vi.fn(async () => 'new-doc'),
    updatePromptDoc: updatePromptDocSpy,
}));

describe('PromptDocEditorScreen', () => {
    beforeEach(() => {
        promptLibrarySettingsRouterBackSpy.mockReset();
        promptLibrarySettingsRouterReplaceSpy.mockReset();
        promptLibrarySettingsRouterPushSpy.mockReset();
        updatePromptDocSpy.mockClear();
        setPromptFoldersSpy.mockClear();
        promptFoldersState.value = {
            v: 1,
            folders: [
                { id: 'folder-1', name: 'Ops', parentId: null },
            ],
        };
    });

    it('saves an edited prompt in place and keeps its editor open', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: 'doc-1' }));

        expect(screen.findByTestId('promptDoc.save')?.props.disabled).toBe(true);
        await act(async () => {
            screen.changeTextByTestId('promptDoc.title', 'Renamed');
        });
        expect(screen.findByTestId('promptDoc.save')?.props.disabled).toBe(false);

        await act(async () => {
            await screen.findByTestId('promptDoc.save')?.props.onPress();
        });

        expect(updatePromptDocSpy).toHaveBeenCalledWith({
            artifactId: 'doc-1',
            title: 'Renamed',
            markdown: 'existing markdown',
            folderId: 'folder-1',
            tags: ['alpha', 'beta'],
        });
        expect(promptLibrarySettingsRouterReplaceSpy).not.toHaveBeenCalled();
        expect(promptLibrarySettingsRouterBackSpy).not.toHaveBeenCalled();
        expect(screen.findByTestId('promptDoc.save')?.props.disabled).toBe(true);
    });

    it('opens a new prompt in the collection once its draft is saved', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: null }));

        await act(async () => {
            screen.changeTextByTestId('promptDoc.title', 'Fresh');
        });
        expect(preventRemoveState.last).toBe(true);
        await act(async () => {
            await screen.findByTestId('promptDoc.save')?.props.onPress();
        });

        expect(promptLibrarySettingsRouterReplaceSpy).toHaveBeenCalledWith('/settings/prompts/docs/new-doc');
        expect(promptLibrarySettingsRouterBackSpy).not.toHaveBeenCalled();
        // The saved draft has nothing left to lose, so opening the saved prompt is not held for a decision.
        expect(preventRemoveState.last).toBe(false);
    });

    it('navigates to the external export screen for an existing prompt doc', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: 'doc-1' }));

        await screen.pressByTestIdAsync('promptDoc.manageExternalAssets');

        expect(promptLibrarySettingsRouterPushSpy).toHaveBeenCalledWith('/(app)/settings/prompts/docs/doc-1/export');
    });

    it('renders linked exports and the organisation fields for existing docs', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: 'doc-1' }));

        expect(screen.findByTestId('promptDoc.link.0')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Laptop');
        expect(screen.findByTestId('promptDoc.folderName')?.props.value).toBe('Ops');
        expect(screen.findByTestId('promptDoc.tags')?.props.value).toBe('alpha, beta');
        expect(screen.findByTestId('promptDoc.save')).toBeTruthy();
    });

    it('preserves dirty prompt doc fields when prompt-folder settings refresh', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: 'doc-1' }));

        await act(async () => {
            screen.changeTextByTestId('promptDoc.title', 'Draft title');
            screen.changeTextByTestId('promptDoc.editor', 'draft markdown');
            screen.changeTextByTestId('promptDoc.folderName', 'Draft folder');
            screen.changeTextByTestId('promptDoc.tags', 'draft, tag');
        });

        promptFoldersState.value = {
            v: 1,
            folders: [
                { id: 'folder-1', name: 'Renamed Ops', parentId: null },
            ],
        };

        await act(async () => {
            screen.changeTextByTestId('promptDoc.tags', 'draft, tag updated');
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(screen.findByTestId('promptDoc.title')?.props.value).toBe('Draft title');
        expect(screen.findByTestId('promptDoc.editor')?.props.value).toBe('draft markdown');
        expect(screen.findByTestId('promptDoc.folderName')?.props.value).toBe('Draft folder');
        expect(screen.findByTestId('promptDoc.tags')?.props.value).toBe('draft, tag updated');
    });

    it('renders a title input, markdown editor, and save action for new docs', async () => {
        const { PromptDocEditorScreen } = await import('./PromptDocEditorScreen');
        const screen = await renderScreen(React.createElement(PromptDocEditorScreen, { artifactId: null }));

        expect(screen.findByTestId('promptDoc.title')).toBeTruthy();
        expect(screen.findByTestId('promptDoc.editor')).toBeTruthy();
        expect(screen.findByTestId('promptDoc.folderName')).toBeTruthy();
        expect(screen.findByTestId('promptDoc.tags')).toBeTruthy();
        expect(screen.findByTestId('promptDoc.save')).toBeTruthy();
        expect(screen.findAllByTestId('promptDoc.manageExternalAssets')).toHaveLength(0);
    });
});
