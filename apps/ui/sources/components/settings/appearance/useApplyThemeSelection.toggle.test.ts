import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const shared = vi.hoisted(() => ({
    /** The theme on screen, as the running Unistyles theme reports it. */
    screenDark: false,
    systemScheme: 'light' as 'light' | 'dark',
    settings: {} as Record<string, unknown>,
    setTheme: vi.fn(),
    setAdaptiveThemes: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Appearance: { getColorScheme: () => shared.systemScheme } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    const base = await createUnistylesMock({
        runtime: { setTheme: shared.setTheme, setAdaptiveThemes: shared.setAdaptiveThemes },
    });
    return {
        ...base,
        useUnistyles: () => {
            const value = base.useUnistyles();
            return { ...value, theme: { ...value.theme, dark: shared.screenDark } };
        },
    };
});
vi.mock('expo-status-bar', () => ({ setStatusBarStyle: vi.fn() }));
vi.mock('expo-system-ui', () => ({ setBackgroundColorAsync: vi.fn(async () => {}) }));
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    const useLocalSettingMutable = (key: string) => [
        shared.settings[key] ?? null,
        (next: unknown) => { shared.settings[key] = next; },
    ];
    return createStorageModuleMock({
        importOriginal,
        overrides: {
            useLocalSettingMutable: useLocalSettingMutable as typeof import('@/sync/domains/state/storage')['useLocalSettingMutable'],
        },
    });
});

const { useToggleThemeMode } = await import('./useApplyThemeSelection');

const CUSTOM_PROFILES = { activeProfileIds: { light: null, dark: 'nightDark' }, profiles: [] };

async function toggleFrom(params: Readonly<{ preference: string; screenDark: boolean; systemScheme: 'light' | 'dark' }>) {
    shared.settings = { themePreference: params.preference, themeProfiles: CUSTOM_PROFILES };
    shared.screenDark = params.screenDark;
    shared.systemScheme = params.systemScheme;
    const hook = await renderHook(() => useToggleThemeMode());
    hook.getCurrent()();
    await Promise.resolve();
    return shared.settings;
}

afterEach(() => {
    standardCleanup();
    shared.setTheme.mockClear();
    shared.setAdaptiveThemes.mockClear();
});

describe('useToggleThemeMode', () => {
    it('turns Adaptive into the explicit opposite of the theme on screen', async () => {
        expect((await toggleFrom({ preference: 'adaptive', screenDark: false, systemScheme: 'light' })).themePreference).toBe('dark');
        expect(shared.setAdaptiveThemes).toHaveBeenLastCalledWith(false);
        expect(shared.setTheme).toHaveBeenLastCalledWith('dark');

        expect((await toggleFrom({ preference: 'adaptive', screenDark: true, systemScheme: 'dark' })).themePreference).toBe('light');
        expect(shared.setTheme).toHaveBeenLastCalledWith('light');
    });

    it('flips an explicit mode and keeps the theme each mode uses', async () => {
        const fromDark = await toggleFrom({ preference: 'dark', screenDark: true, systemScheme: 'light' });
        expect(fromDark.themePreference).toBe('light');
        expect(fromDark.themeProfiles).toEqual(CUSTOM_PROFILES);

        expect((await toggleFrom({ preference: 'light', screenDark: false, systemScheme: 'dark' })).themePreference).toBe('dark');
    });
});
