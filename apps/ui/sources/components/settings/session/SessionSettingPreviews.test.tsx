import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMessageViewCommonModuleMocks } from '@/components/sessions/transcript/messageViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The settings store is the boundary: every settings hook a preview mounts is recorded here, with the
 * real store hooks still answering underneath.
 *
 * A preview may read only the rendering environment every real component honours: the text scale
 * (the app `Text` primitive), the content width (row max width) and the syntax-tokenization budget
 * (a size cap that never changes a short sample). Any other setting would make the tile follow the
 * account's live choices instead of the option it shows.
 */
const RENDERING_ENVIRONMENT_READS = new Set([
    'useLocalSetting:uiFontScale',
    'useLocalSetting:uiContentWidthMode',
    'useSetting:filesDiffTokenizationMaxBytes',
]);
const settingsReads = vi.hoisted(() => ({ keys: [] as string[] }));

function recordingSettingsHooks<T extends Record<string, any>>(actual: T): Partial<T> {
    const wrap = (name: string) => (...args: unknown[]) => {
        settingsReads.keys.push(`${name}:${String(args[0] ?? '')}`);
        return actual[name](...args);
    };
    return {
        useSetting: wrap('useSetting'),
        useSettings: wrap('useSettings'),
        useSettingMutable: wrap('useSettingMutable'),
        useLocalSetting: wrap('useLocalSetting'),
        useLocalSettingMutable: wrap('useLocalSettingMutable'),
    } as unknown as Partial<T>;
}

installMessageViewCommonModuleMocks({
    storage: async (importOriginal) => {
        const actual = await importOriginal<Record<string, any>>();
        return { ...actual, ...recordingSettingsHooks(actual) };
    },
});

vi.mock('@/sync/store/hooks', async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return { ...actual, ...recordingSettingsHooks(actual) };
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

afterEach(() => {
    standardCleanup();
    settingsReads.keys.length = 0;
});

describe('Session settings previews', () => {
    it('renders real list, transcript and composer pieces from static props without reading display settings', async () => {
        const previews = await import('./SessionSettingPreviews');
        const listPreviews = await import('./SessionListPreview');
        const { SessionTranscriptSourceProvider } = await import('@/components/sessions/transcript/source/SessionTranscriptSourceContext');
        const screen = await renderScreen(
            <>
                <listPreviews.SessionListDensityPreview density="detailed" />
                <listPreviews.SessionListDensityPreview density="cozy" />
                <listPreviews.SessionListDensityPreview density="narrow" />
                <listPreviews.SessionListLayoutPreview layout="layout:projects" />
                <listPreviews.SessionListLayoutPreview layout="layout:recent_activity" />
                <listPreviews.SessionListLayoutPreview layout="layout:active_inactive" />
                <previews.TranscriptLayoutPreview layout="linear" />
                <previews.TranscriptLayoutPreview layout="turns" />
                <previews.ThinkingDisplayPreview mode="inline_summary" inlineChrome="plain" />
                <previews.ThinkingDisplayPreview mode="inline_full" inlineChrome="card" />
                <previews.ThinkingDisplayPreview mode="tool" inlineChrome="plain" />
                <previews.ThinkingDisplayPreview mode="hidden" inlineChrome="plain" />
                <previews.ToolStylePreview style="cards" />
                <previews.ToolStylePreview style="activity_feed" />
                <previews.ComposerActionBarPreview layout="collapsed" />
                <previews.ComposerChipDensityPreview density="icons" />
                <previews.EmbeddedChatPreview />
            </>,
        );

        const sources = screen.findAllByType(SessionTranscriptSourceProvider).map((root) => root.props.source);
        expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
            expect(source).toMatchObject({ kind: 'readOnly', sessionId: 'settings-preview', actions: null, navigate: null });
        }
        expect([...new Set(settingsReads.keys.filter((key) => !RENDERING_ENVIRONMENT_READS.has(key)))]).toEqual([]);
    });
});
