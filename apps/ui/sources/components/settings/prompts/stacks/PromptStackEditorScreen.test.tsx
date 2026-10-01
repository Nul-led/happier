import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installPromptStacksCommonModuleMocks,
    promptStacksRouterPushSpy,
} from './promptStacksScreenTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setPromptStacksMock = vi.fn();

installPromptStacksCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useArtifacts: () => ([
                {
                    id: 'doc-1',
                    title: 'Prompt One',
                    header: { kind: 'prompt_doc.v2', title: 'Prompt One' },
                },
            ]),
            useSettingMutable: () => [
                {
                    v: 1,
                    surfaces: {
                        coding: [
                            {
                                id: 'entry-1',
                                ref: { kind: 'doc', artifactId: 'doc-1' },
                                enabled: true,
                                placement: 'system_append',
                                editPolicy: 'user_only',
                            },
                        ],
                        voice: [],
                        profilesById: {},
                    },
                },
                setPromptStacksMock,
            ],
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1000 },
    useLayoutMaxWidth: () => 1000,
    useLayoutMaxWidthStyle: () => ({ maxWidth: 1000 }),
}));

vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: any) => React.createElement('ItemRowActions', props),
}));

describe('PromptStackEditorScreen', () => {
    beforeEach(() => {
        promptStacksRouterPushSpy.mockClear();
        setPromptStacksMock.mockClear();
    });

    it('renders stack entries with row actions and an add action on the section', async () => {
        const { PromptStackEditorScreen } = await import('./PromptStackEditorScreen');

        const screen = await renderScreen(React.createElement(PromptStackEditorScreen, {
                surface: 'coding',
                title: 'System Prompt Additions',
            }));

        expect(screen.findByTestId('promptStack.entry.entry-1')).toBeTruthy();
        expect(screen.findByTestId('promptStack.add')).toBeTruthy();

        const actions = screen.findAllByType('ItemRowActions' as any)[0];
        expect(actions).toBeTruthy();
        expect(actions?.props?.actions?.map((action: any) => action.id)).toEqual([
            'edit',
            'moveUp',
            'moveDown',
            'delete',
        ]);
    });
});
