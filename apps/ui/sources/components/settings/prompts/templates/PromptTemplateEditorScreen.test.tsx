import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installPromptTemplatesCommonModuleMocks,
    promptTemplatesRouterBackSpy,
    promptTemplatesRouterPushSpy,
} from './promptTemplatesScreenTestHelpers';

const promptTemplatesRouterReplaceSpy = vi.hoisted(() => vi.fn());


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setInvocationsMock = vi.fn();

installPromptTemplatesCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            ScrollView: 'ScrollView',
            View: 'View',
            Switch: 'Switch',
            Platform: {
                OS: 'web',
                select: ({ web, default: defaultValue }: { web?: unknown; default?: unknown }) =>
                    web ?? defaultValue,
            },
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    groupped: { background: 'white' },
                    input: { background: '#fff', text: '#111', placeholder: '#666' },
                    accent: { blue: '#00f', indigo: '#60f' },
                    textSecondary: '#999',
                    textDestructive: '#f00',
                },
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { push: promptTemplatesRouterPushSpy, back: promptTemplatesRouterBackSpy, replace: promptTemplatesRouterReplaceSpy },
        });
        return routerMock.module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useArtifacts: () => [
                { id: 'doc-1', title: 'Prompt One', header: { kind: 'prompt_doc.v2', title: 'Prompt One' } },
                { id: 'doc-2', title: 'Prompt Two', header: { kind: 'prompt_doc.v2', title: 'Prompt Two' } },
            ],
            useSettingMutable: () => [
                {
                    v: 1,
                    entries: [],
                },
                setInvocationsMock,
            ],
        });
    },
});

/** Whether the screen currently asks the navigator to hold a departure (the unsaved-changes guard). */
const preventRemoveState = vi.hoisted(() => ({ last: null as boolean | null }));

// The navigator's remove interception is the navigation library boundary; record what the screen asks for.
vi.mock('@react-navigation/native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@react-navigation/native')>(),
    usePreventRemove: (preventRemove: boolean) => {
        preventRemoveState.last = preventRemove;
    },
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1000 },
    useLayoutMaxWidth: () => 1000,
    useLayoutMaxWidthStyle: () => ({ maxWidth: 1000 }),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', {
        ...props,
        // The target prompt select; the header's `⋯` menu keeps its own id.
        testID: props.testID ?? 'promptTemplate.target',
    }),
}));

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => 'template-1',
}));

describe('PromptTemplateEditorScreen', () => {
    beforeEach(() => {
        promptTemplatesRouterPushSpy.mockClear();
        promptTemplatesRouterBackSpy.mockClear();
        promptTemplatesRouterReplaceSpy.mockClear();
        setInvocationsMock.mockClear();
    });

    it('uses a dropdown selector for the target prompt and exposes create/edit prompt actions', async () => {
        const { PromptTemplateEditorScreen } = await import('./PromptTemplateEditorScreen');

        const screen = await renderScreen(React.createElement(PromptTemplateEditorScreen, { invocationId: null }));

        const dropdown = screen.findByTestId('promptTemplate.target');
        expect(dropdown?.props?.selectedId).toBe('');
        expect(dropdown?.props?.items?.map((item: any) => item.id)).toEqual(['doc-1', 'doc-2']);

        expect(screen.findByTestId('promptTemplate.target.edit')).toBeTruthy();
        expect(screen.findByTestId('promptTemplate.target.new')).toBeTruthy();
        expect(screen.findByTestId('promptTemplate.behavior:insert_on_send')).toBeTruthy();
        expect(screen.findByTestId('promptTemplate.save')).toBeTruthy();
    });

    it('explains under the command field why a reserved slash command cannot be saved', async () => {
        const { PromptTemplateEditorScreen } = await import('./PromptTemplateEditorScreen');
        const screen = await renderScreen(React.createElement(PromptTemplateEditorScreen, { invocationId: null }));

        await act(async () => {
            screen.changeTextByTestId('promptTemplate.title', 'Clear');
            screen.changeTextByTestId('promptTemplate.token', '/clear');
            screen.findByTestId('promptTemplate.target')?.props.onSelect('doc-1');
        });
        await act(async () => {
            await screen.findByTestId('promptTemplate.save')?.props.onPress();
        });

        expect(screen.findByTestId('promptTemplate.token.error')).toBeTruthy();
        expect(setInvocationsMock).not.toHaveBeenCalled();
    });

    it('opens a new template in the collection once its draft is saved', async () => {
        const { PromptTemplateEditorScreen } = await import('./PromptTemplateEditorScreen');
        const screen = await renderScreen(React.createElement(PromptTemplateEditorScreen, { invocationId: null }));

        await act(async () => {
            screen.changeTextByTestId('promptTemplate.title', 'Daily');
            screen.changeTextByTestId('promptTemplate.token', 'daily');
            screen.findByTestId('promptTemplate.target')?.props.onSelect('doc-1');
        });
        expect(preventRemoveState.last).toBe(true);
        await act(async () => {
            await screen.findByTestId('promptTemplate.save')?.props.onPress();
        });
        // The saved draft has nothing left to lose, so opening the saved template is not held for a decision.
        expect(preventRemoveState.last).toBe(false);

        expect(setInvocationsMock).toHaveBeenCalledWith({
            v: 1,
            entries: [expect.objectContaining({ id: 'template-1', token: '/daily', title: 'Daily' })],
        });
        expect(promptTemplatesRouterReplaceSpy).toHaveBeenCalledWith('/settings/prompts/templates/template-1');
    });
});
