import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const paramsState = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View', Text: 'Text', Pressable: 'Pressable' });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: () => paramsState.value }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const PAGE = await (async () => {
    const { defineSettingsPage } = await import('@/components/settings/catalog/settingDeclarations');
    return defineSettingsPage({
        pageId: 'memory',
        sections: {
            content: {
                titleKey: 'common.enabled',
                settings: {
                    indexMode: { titleKey: 'common.enabled' },
                    backfill: { titleKey: 'common.cancel' },
                },
            },
            other: {
                settings: {
                    unrelated: { titleKey: 'common.save' },
                },
            },
        },
    });
})();

async function renderPage(requested: string, rowMounted: boolean) {
    paramsState.value = { setting: requested };
    const { SettingSection, SettingRow } = await import('./SettingRow');
    const screen = await renderScreen(
        <>
            <SettingSection section={PAGE.sectionRefs.content}>
                <React.Fragment>
                    {rowMounted ? <SettingRow setting={PAGE.settings.indexMode} /> : null}
                    <SettingRow setting={PAGE.settings.backfill} />
                </React.Fragment>
            </SettingSection>
            <SettingSection section={PAGE.sectionRefs.other}>
                <SettingRow setting={PAGE.settings.unrelated} />
            </SettingSection>
        </>,
    );
    await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
    });
    return screen;
}

describe('SettingSection', () => {
    afterEach(() => {
        vi.useRealTimers();
        paramsState.value = {};
    });

    it('lets the requested row reveal itself when the page renders it', async () => {
        vi.useFakeTimers();
        const screen = await renderPage(PAGE.settings.indexMode.anchor, true);

        expect(screen.findByTestId(`setting-reveal.${PAGE.settings.indexMode.anchor}`)).toBeTruthy();
        expect(screen.findByTestId(`setting-reveal.${PAGE.sectionRefs.content.id}`)).toBeNull();
    });

    it('reveals the enclosing section when the page does not render the requested row', async () => {
        vi.useFakeTimers();
        const screen = await renderPage(PAGE.settings.indexMode.anchor, false);

        expect(screen.findByTestId(`setting-reveal.${PAGE.sectionRefs.content.id}`)).toBeTruthy();
        // Only the section that holds the row answers; its neighbours stay quiet.
        expect(screen.findByTestId(`setting-reveal.${PAGE.sectionRefs.other.id}`)).toBeNull();
    });

    it('lets a rendered section answer for a section the page does not render in its state', async () => {
        vi.useFakeTimers();
        paramsState.value = { setting: PAGE.settings.unrelated.anchor };
        const { SettingSection, SettingRow } = await import('./SettingRow');
        // Only `content` is on screen (say, until a machine is chosen); it explains `other`'s rows too.
        const screen = await renderScreen(
            <SettingSection section={PAGE.sectionRefs.content} answersFor={[PAGE.sectionRefs.other]}>
                <SettingRow setting={PAGE.settings.backfill} />
            </SettingSection>,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(screen.findByTestId(`setting-reveal.${PAGE.sectionRefs.content.id}`)).toBeTruthy();
    });

    it('tells a disclosure when search asks for one of its rows', async () => {
        paramsState.value = { setting: PAGE.settings.backfill.anchor };
        const { renderHook } = await import('@/dev/testkit');
        const { useSettingRevealRequested } = await import('./SettingRow');
        const inside = await renderHook(() => useSettingRevealRequested([PAGE.settings.indexMode, PAGE.settings.backfill]));
        expect(inside.getCurrent()).toBe(true);
        await inside.unmount();
        const outside = await renderHook(() => useSettingRevealRequested([PAGE.settings.unrelated]));
        expect(outside.getCurrent()).toBe(false);
        await outside.unmount();
    });
});
