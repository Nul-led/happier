import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import {
    installSessionSettingsCommonModuleMocks,
} from './sessionSettingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState: Record<string, any> = {};

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

installSessionSettingsCommonModuleMocks({
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
        theme: {
            colors: {
                accent: {
                    blue: '#00f',
                    green: '#0f0',
                    orange: '#f80',
                    indigo: '#80f',
                },
                textSecondary: '#999',
                success: '#0f0',
            },
        },
        });
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: (key: string) => [
                    settingsState[key],
                    (next: any) => {
                        settingsState[key] = next;
                    },
                ],
            },
        });
    },
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: any) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: any) => React.createElement('ItemGroup', null, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.rightElement ?? null, props.children ?? null),
}));

vi.mock('@/components/ui/lists/ExpandableItem', () => ({
    ExpandableItem: (props: any) => React.createElement(
        'ExpandableItem',
        props,
        typeof props.header === 'function'
            ? props.header({
                expanded: props.expanded,
                toggle: () => props.onExpandedChange(!props.expanded),
                headerProps: {
                    onPress: () => props.onExpandedChange(!props.expanded),
                    accessibilityRole: 'button',
                    accessibilityState: { expanded: props.expanded },
                },
            })
            : props.header,
        props.expanded ? props.children : null,
    ),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: any) => React.createElement('Switch', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

vi.mock('@/components/workspaces/sync/WorkspaceSyncLegacyStateRecovery', () => ({
    WorkspaceSyncLegacyStateRecovery: () => null,
}));

describe('SessionHandoffSettingsView', () => {
    beforeEach(() => {
        settingsState.sessionHandoffDefaultsV1 = {
            v: 1,
            workspaceSyncMode: 'keep_synced',
            includeIgnoredMode: 'include_selected',
            ignoredIncludeGlobs: [],
            directTargetMode: 'keep_direct',
        };
    });

    it('keeps common modes concise and reveals advanced modes and content policy through one disclosure', async () => {
        const mod = await import('./SessionHandoffSettingsView');
        const SessionHandoffSettingsView = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionHandoffSettingsView));

        const commonModeMenu = screen.findAll((node) => (
            node.props?.itemTrigger?.title === 'settingsSession.handoff.workspaceMode.title'
        ))[0] ?? null;
        const advanced = screen.findAll((node) => node.props?.testID === 'session-handoff-settings-advanced')[0] ?? null;
        const ignoredMenu = screen.findAll((node) => (
            node.props?.itemTrigger?.title === 'settingsSession.handoff.includeIgnoredMode.title'
        ))[0] ?? null;
        const directModeMenu = screen.findAll((node) => (
            node.props?.itemTrigger?.title === 'settingsSession.handoff.directTargetMode.title'
        ))[0] ?? null;

        expect(commonModeMenu?.props.items.map((item: any) => item.id)).toEqual(['keep_synced', 'copy_once', 'none']);
        expect(advanced?.props.expanded).toBe(false);
        expect(ignoredMenu).toBeFalsy();
        expect(directModeMenu).toBeTruthy();

        await act(async () => {
            advanced?.props.onExpandedChange(true);
        });

        const advancedModeMenu = screen.findAll((node) => (
            node.props?.itemTrigger?.title === 'settingsSession.handoff.advanced.modeTitle'
        ))[0] ?? null;
        const expandedIgnoredMenu = screen.findAll((node) => (
            node.props?.itemTrigger?.title === 'settingsSession.handoff.includeIgnoredMode.title'
        ))[0] ?? null;
        expect(advancedModeMenu?.props.items.map((item: any) => item.id)).toEqual(['mirror_exactly', 'keep_both_in_sync']);

        await act(async () => {
            advancedModeMenu?.props.onSelect('mirror_exactly');
            expandedIgnoredMenu?.props.onSelect('include_selected');
            directModeMenu?.props.onSelect('convert_to_persisted');
        });

        const globInput = screen.findAll((node) => typeof node.props?.onChangeText === 'function')[0] ?? null;
        expect(globInput).toBeTruthy();
        await act(async () => {
            globInput?.props.onChangeText('dist/**, .env.local');
        });

        expect(settingsState.sessionHandoffDefaultsV1).toEqual({
            v: 1,
            workspaceSyncMode: 'mirror_exactly',
            includeIgnoredMode: 'include_selected',
            ignoredIncludeGlobs: ['dist/**', '.env.local'],
            directTargetMode: 'convert_to_persisted',
        });
    });
});
