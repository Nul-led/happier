import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Text } from '@/components/ui/text/Text';
import { ThemeProfileExportScreen } from '@/components/settings/appearance/themeProfiles/ThemeProfileExportScreen';
import { BUILT_IN_THEME_PROFILES } from '@/theme/profiles/builtInThemeProfiles';
import { DestinationInstanceHost } from './DestinationInstanceHost';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({ translate: (key) => key }));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useLocalSettingMutable: () => [
        { profiles: [], activeProfileIds: { light: null, dark: null } }, () => {},
    ] });
});
// File export and native sharing are OS boundaries; this test reads the export preview only.
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'cache' } }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn() }));
vi.mock('expo-router', async () => {
    const module = (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module;
    const outsideNavigator = () => { throw new Error('Settings body has no Expo route'); };
    return { ...module, usePathname: outsideNavigator, useLocalSearchParams: outsideNavigator };
});

describe('hosted settings bodies', () => {
    it('exports the profile selected by each settings body rather than global search params', async () => {
        const profiles = BUILT_IN_THEME_PROFILES.slice(0, 2);
        const screen = await renderScreen(<>
            {profiles.map(({ profile }) => <DestinationInstanceHost key={profile.id}
                tabId={profile.id} ref={{ kind: 'settings', params: {
                    pageId: 'appearance/themes/export', profileId: profile.id,
                } }} pathname="/settings/appearance/themes/export" focused visible
                navigation={{ push: () => {}, replace: () => {}, back: () => {} }}>
                <ThemeProfileExportScreen />
            </DestinationInstanceHost>)}
        </>);
        const outputs = screen.findAllHostsByTestId('settings-theme-profile-export-json');
        expect(outputs.map((node) => JSON.parse(node.props.value).profile.name)).toEqual(profiles.map(({ profile }) => profile.name));
    });
    it('renders each settings page identity independently with no Expo route context', async () => {
        const screen = await renderScreen(<>
            {['appearance', 'language'].map((pageId) => <DestinationInstanceHost key={pageId}
                tabId={pageId} ref={{ kind: 'settings', params: { pageId } }}
                pathname={`/settings/${pageId}`} focused={pageId === 'appearance'} visible
                navigation={{ push: () => {}, replace: () => {}, back: () => {} }}>
                <SettingsPageHeader />
            </DestinationInstanceHost>)}
        </>);
        const labels = screen.root.findAllByType(Text).map((node) => node.props.children);
        expect(labels).toContain('settings.appearance');
        expect(labels).toContain('settingsLanguage.title');
    });
});
