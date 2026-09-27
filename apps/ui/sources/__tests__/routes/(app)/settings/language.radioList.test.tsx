import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import { installSessionSettingsEntryModuleMocks } from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    preferredLanguage: null as string | null,
    setPreferredLanguage: vi.fn(),
    confirm: vi.fn(async () => true),
}));

vi.mock('expo-localization', () => ({
    getLocales: () => [{ languageTag: 'fr-FR' }],
}));

vi.mock('@/hooks/inbox/useUpdates', () => ({
    useUpdates: () => ({ reloadApp: vi.fn() }),
}));

beforeEach(() => {
    standardCleanup();
    shared.preferredLanguage = 'de';
    shared.setPreferredLanguage.mockClear();
    shared.confirm.mockClear();
    installSessionSettingsEntryModuleMocks({
        textModule: async () => {
            const actual = await vi.importActual<typeof import('@/text')>('@/text');
            const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
            return {
                ...createTextModuleMock({ translate: (key) => key }),
                SUPPORTED_LANGUAGES: actual.SUPPORTED_LANGUAGES,
                SUPPORTED_LANGUAGE_CODES: actual.SUPPORTED_LANGUAGE_CODES,
                getLanguageNativeName: actual.getLanguageNativeName,
                getLanguageEnglishName: actual.getLanguageEnglishName,
            };
        },
        modalModule: async () => {
            const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
            return createModalModuleMock({ spies: { confirm: shared.confirm } }).module;
        },
        storageModule: async (importOriginal) => {
            const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
            return createStorageModuleStub({
                importOriginal,
                useSettingMutable: (key: string) => (key === 'preferredLanguage'
                    ? [shared.preferredLanguage, shared.setPreferredLanguage]
                    : [null, vi.fn()]),
            });
        },
    });
});

describe('Language settings', () => {
    it('offers the languages as one radio group with only the current language checked', async () => {
        const { default: LanguageSettingsScreen } = await import('@/app/(app)/settings/language');
        const screen = await renderSettingsView(React.createElement(LanguageSettingsScreen));

        const group = screen.findAllByType('ItemGroup' as any).find((node) => node.props.accessibilityRole === 'radiogroup');
        expect(group).toBeTruthy();
        const radios = screen.findAllByType('Item' as any).filter((node) => node.props.accessibilityRole === 'radio');
        expect(radios.length).toBeGreaterThan(2);
        expect(radios.filter((node) => node.props.accessibilityChecked === true).map((node) => node.props.title)).toEqual(['Deutsch']);
        // A language shown in its own name also says which language it is in the viewer's terms.
        expect(radios.find((node) => node.props.title === 'Deutsch')?.props.subtitle).toBe('German');
    });

    it('changes the language only after the restart is confirmed', async () => {
        const { default: LanguageSettingsScreen } = await import('@/app/(app)/settings/language');
        const screen = await renderSettingsView(React.createElement(LanguageSettingsScreen));

        const french = screen.findAllByType('Item' as any).find((node) => node.props.title === 'Français');
        await french?.props.onPress();

        expect(shared.confirm).toHaveBeenCalledTimes(1);
        expect(shared.setPreferredLanguage).toHaveBeenCalledWith('fr');
    });
});
