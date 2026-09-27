import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    renderSettingsView,
    standardCleanup,
} from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';
import { createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    setThinkingDisplayMode: vi.fn(),
    setThinkingInlinePresentation: vi.fn(),
}));

installSessionSettingsEntryModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            TextInput: 'TextInput',
        });
    },
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: createUseSettingMutableMockFromReader((key) => {
                    if (key === 'sessionThinkingDisplayMode') return ['inline', shared.setThinkingDisplayMode];
                    if (key === 'sessionThinkingInlinePresentation') return ['summary', shared.setThinkingInlinePresentation];
                    return [null, vi.fn()];
                }),
            },
        });
    },
});

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
    shared.setThinkingDisplayMode.mockClear();
    shared.setThinkingInlinePresentation.mockClear();
});

describe('Transcript settings (thinking display mode)', () => {
    it('renders the thinking display choices and updates session thinking mode + inline presentation', async () => {
        const mod = await import('@/app/(app)/settings/session/transcript');
        const screen = await renderSettingsView(React.createElement(mod.default));

        // A visual picker row: `Item` is a host element here, the tiles are its `rightElement`.
        const row = screen.findAll((node) => (node.type as unknown) === 'Item' && node.props?.testID === 'settings-session-thinking-display')[0];
        expect(row?.props.title).toBe('settingsSession.thinking.displayModeTitle');
        const tiles = row!.props.rightElement.props;
        expect(tiles.value).toBe('inline_summary');
        expect(tiles.options.map((option: { id: string }) => option.id)).toEqual(['inline_summary', 'inline_full', 'tool', 'hidden']);

        await act(async () => {
            tiles.onChange('inline_full');
        });

        expect(shared.setThinkingDisplayMode).toHaveBeenCalledWith('inline');
        expect(shared.setThinkingInlinePresentation).toHaveBeenCalledWith('full');
    });
});
