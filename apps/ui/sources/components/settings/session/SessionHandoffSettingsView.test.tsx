import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import {
    installSessionSettingsCommonModuleMocks,
} from './sessionSettingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState: Record<string, any> = {};
// The settings store is the boundary: a write re-renders subscribers, as the real store does.
const settingsListeners = new Set<() => void>();
function writeSetting(key: string, next: any) {
    settingsState[key] = next;
    settingsListeners.forEach((listener) => listener());
}

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
                    React.useSyncExternalStore(
                        (listener) => {
                            settingsListeners.add(listener);
                            return () => settingsListeners.delete(listener);
                        },
                        () => settingsState[key],
                    ),
                    (next: any) => writeSetting(key, next),
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

        const choice = (prefix: string) => screen.findAll((node) => node.props?.testIDPrefix === prefix)[0] ?? null;
        const commonMode = choice('session-handoff-workspace-sync-mode');
        const advanced = screen.findAll((node) => node.props?.testID === 'session-handoff-settings-advanced')[0] ?? null;
        const directMode = choice('session-handoff-direct-target-mode');

        expect(commonMode?.props.options.map((item: any) => item.id)).toEqual(['keep_synced', 'copy_once', 'none']);
        expect(directMode).toBeTruthy();

        await act(async () => {
            advanced?.props.onExpandedChange(true);
        });

        const advancedMode = choice('session-handoff-settings-advanced-mode');
        expect(advancedMode?.props.options.map((item: any) => item.id)).toEqual(['mirror_exactly', 'keep_both_in_sync']);

        await act(async () => {
            advancedMode?.props.onChange('mirror_exactly');
        });
        await act(async () => {
            choice('session-handoff-ignored-mode')?.props.onChange('include_selected');
        });
        await act(async () => {
            choice('session-handoff-direct-target-mode')?.props.onChange('convert_to_persisted');
        });

        const globInput = screen.findAll((node) => String(node.type) === 'TextInput'
            && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0] ?? null;
        expect(globInput).toBeTruthy();
        await act(async () => {
            globInput?.props.onChangeText('dist/**, .env.local');
        });
        const editedGlobInput = screen.findAll((node) => String(node.type) === 'TextInput'
            && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0] ?? null;
        await act(async () => editedGlobInput?.props.onBlur());

        expect(settingsState.sessionHandoffDefaultsV1).toEqual({
            v: 1,
            workspaceSyncMode: 'mirror_exactly',
            includeIgnoredMode: 'include_selected',
            ignoredIncludeGlobs: ['dist/**', '.env.local'],
            directTargetMode: 'convert_to_persisted',
        });
    });

    it('keeps an unfinished comma while editing patterns and commits both entries on blur', async () => {
        const mod = await import('./SessionHandoffSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));
        const advanced = screen.findAll((node) => node.props?.testID === 'session-handoff-settings-advanced')[0];
        await act(async () => advanced?.props.onExpandedChange(true));

        for (const draft of ['dist/**', 'dist/**,', 'dist/**, ', 'dist/**, .env.local']) {
            const input = screen.findAll((node) => String(node.type) === 'TextInput'
                && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0];
            await act(async () => input?.props.onChangeText(draft));
            expect(screen.findAll((node) => String(node.type) === 'TextInput'
                && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0]?.props.value).toBe(draft);
        }

        const input = screen.findAll((node) => String(node.type) === 'TextInput'
            && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0];
        await act(async () => input?.props.onBlur());
        expect(settingsState.sessionHandoffDefaultsV1.ignoredIncludeGlobs).toEqual(['dist/**', '.env.local']);
    });

    it('opens Advanced on arrival when "Include selected" needs its patterns, so the required field is never hidden', async () => {
        const mod = await import('./SessionHandoffSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));

        const advanced = screen.findAll((node) => node.props?.testID === 'session-handoff-settings-advanced')[0];
        expect(advanced?.props.expanded).toBe(true);
        expect(screen.findAll((node) => String(node.type) === 'TextInput'
            && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')).toHaveLength(1);
    });

    it('shows the stored patterns again when they change elsewhere while the page is open', async () => {
        const mod = await import('./SessionHandoffSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));
        const field = () => screen.findAll((node) => String(node.type) === 'TextInput'
            && node.props?.accessibilityLabel === 'settingsSession.handoff.includeIgnoredMode.globsTitle')[0];
        expect(field()?.props.value).toBe('');

        // A settings sync (another device, or the legacy-state reset on this page) writes new patterns.
        await act(async () => {
            writeSetting('sessionHandoffDefaultsV1', { ...settingsState.sessionHandoffDefaultsV1, ignoredIncludeGlobs: ['build/**'] });
        });

        expect(field()?.props.value).toBe('build/**');
    });
});
