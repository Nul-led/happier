import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import { createUseSettingMock } from '@/dev/testkit/mocks/storage';
import { installSessionSettingsCommonModuleMocks } from './sessionSettingsViewTestHelpers';

installSessionSettingsCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: createUseSettingMock({ values: { sessionUseTmux: false, sessionTerminalHost: 'herdr' } }),
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: { children?: React.ReactNode; title?: string }) =>
        React.createElement('ItemGroup', { title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/lists/SegmentedChoiceItem', () => ({
    SegmentedChoiceItem: (props: Record<string, unknown>) => React.createElement('SegmentedChoiceItem', props),
}));

describe('SessionRuntimeSettingsView', () => {
    it('keeps the runtime control without offering obsolete legacy-secret issuance', async () => {
        const { SessionRuntimeSettingsView } = await import('./SessionRuntimeSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionRuntimeSettingsView));

        const row = screen.findRowByTitle('settingsSessionPages.runtime.terminalHostTitle');
        expect(row).toBeTruthy();
        expect(row?.props.value).toBe('herdr');
        expect(screen.findRowByTitle('settingsSession.terminalConnect.legacySecretExportTitle')).toBeNull();
    });
});
