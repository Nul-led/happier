import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import { createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';

const setPresentation = vi.fn();
const setColumnsEnabled = vi.fn();

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({
        importOriginal,
        overrides: {
            useSettingMutable: createUseSettingMutableMockFromReader((name) => {
                if (name === 'newSessionWizardSectionPresentationV1') {
                    return [{ models: 'dropdown' }, setPresentation];
                }
                if (name === 'newSessionWizardColumnsEnabled') {
                    return [false, setColumnsEnabled];
                }
                return [null, vi.fn()];
            }),
        },
    });
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('ItemGroup', null, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement(
        React.Fragment,
        null,
        props.itemTrigger ? React.createElement('Item', { ...props.itemTrigger, ...(props.itemTrigger.itemProps ?? {}) }) : null,
        ...(props.items ?? []).map((item: any) => React.createElement('Item', {
            key: `${props.itemTrigger?.title ?? 'unknown'}:${item.id}`,
            title: `DropdownItem:${props.itemTrigger?.title ?? 'unknown'}:${item.title}`,
            onPress: () => props.onSelect?.(item.id),
        })),
    ),
}));

describe('NewSessionWizardSettingsView', () => {
    it('renders every wizard selection section and updates one section without dropping the others', async () => {
        const { NewSessionWizardSettingsView } = await import('./NewSessionWizardSettingsView');
        const screen = await renderSettingsView(React.createElement(NewSessionWizardSettingsView));

        const steps = screen.findAll((node) => typeof node.props?.testID === 'string'
            && node.props.testID.startsWith('settings-new-session-wizard-')
            && Array.isArray(node.props.options));
        expect(steps.map((step) => [step.props.testID, step.props.title, step.props.value])).toEqual([
            ['settings-new-session-wizard-profiles', 'Profile', 'auto'],
            ['settings-new-session-wizard-backends', 'Agent', 'auto'],
            ['settings-new-session-wizard-models', 'Model', 'dropdown'],
            ['settings-new-session-wizard-machines', 'Machine', 'auto'],
            ['settings-new-session-wizard-paths', 'Folder', 'auto'],
            ['settings-new-session-wizard-permissions', 'Permissions', 'auto'],
        ]);
        expect(screen.findRow('settings-new-session-wizard-columns')?.props.subtitle).toBe('Stack every wizard selector in one column.');

        steps.find((step) => step.props.testID === 'settings-new-session-wizard-machines')?.props.onChange('dropdown');
        expect(setPresentation).toHaveBeenCalledWith({
            models: 'dropdown',
            machines: 'dropdown',
        });

        expect(screen.findRowByTitle('Two-column layout')).toBeTruthy();
        screen.pressRowByTitle('Two-column layout');
        expect(setColumnsEnabled).toHaveBeenCalledWith(true);
    });
});
