import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setSessionListDensity = vi.fn();
const setSessionListOrderingMode = vi.fn();
const setSessionListFolderSortMode = vi.fn();
const setWorkspacePathDisplayMode = vi.fn();
const setWorkspaceFaviconsEnabled = vi.fn();
const setWorkspaceMachineSubtitlesEnabled = vi.fn();
const setSessionListWorkingIndicatorStyle = vi.fn();
const setSessionListIdentityDisplay = vi.fn();
const setSessionHeaderIdentityDisplay = vi.fn();
const setSessionListActiveColorMode = vi.fn();
const setSessionListAttentionPromotionMode = vi.fn();
const setSessionListWorkingPlacementMode = vi.fn();
const setSessionListSeparateBackgroundWork = vi.fn();
const setSessionListSectionMode = vi.fn();
const applySettings = vi.fn();
let translationPrefix = 'en';
let sessionListOrderingModeSetting: 'custom' | 'created' | 'updated' = 'custom';
let sessionListFolderSortModeSetting: 'foldersFirst' | 'mixed' = 'foldersFirst';

// Folder display and folder sort are offered only while the server enables session folders.
const foldersEnabled = (featureId: string) => featureId === 'sessions.folders';

installSessionSettingsEntryModuleMocks({
    featureEnabled: foldersEnabled,
    textModule: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => `${translationPrefix}:${key}`,
            translateLoose: (key: string) => `${translationPrefix}:${key}`,
            getPreferredLanguage: () => translationPrefix,
        });
    },
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        const original = await importOriginal<typeof import('@/sync/domains/state/storage')>();
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                // Both readers answer from one fixture: the page also reads the effective list layout
                // through `useSetting` (`useSessionListLayoutChoice`).
                useSetting: ((key: string) => {
                    const fixture = readSessionSettingFixture(key);
                    return fixture ? fixture[0] : original.useSetting(key as never);
                }) as any,
                useSettingMutable: ((key: string) => readSessionSettingFixture(key) ?? [null, vi.fn()]) as any,
                useLocalSettingMutable: ((key: string) => {
                    if (key === 'sessionsRightPaneDefaultOpen') return [false, vi.fn()];
                    if (key === 'uiMultiPanePanelsEnabled') return [true, vi.fn()];
                    return [null, vi.fn()];
                }) as any,
            },
        });
    },
});

/** The Account settings this screen reads, with the setter each test observes; `undefined` when not fixed here. */
function readSessionSettingFixture(key: string): [unknown, (...args: any[]) => unknown] | undefined {
    if (key === 'sessionTagsEnabled') return [true, vi.fn()];
    if (key === 'sessionListDensity') return ['narrow', setSessionListDensity];
    if (key === 'sessionListIdentityDisplay') return ['agentLogo', setSessionListIdentityDisplay];
    if (key === 'sessionHeaderIdentityDisplay') return ['avatar', setSessionHeaderIdentityDisplay];
    if (key === 'sessionListActiveColorModeV1') return ['activityAndAttention', setSessionListActiveColorMode];
    if (key === 'sessionListAttentionPromotionModeV1') return ['global', setSessionListAttentionPromotionMode];
    if (key === 'sessionListWorkingPlacementModeV1') return ['off', setSessionListWorkingPlacementMode];
    if (key === 'sessionListSeparateBackgroundWorkV1') return [false, setSessionListSeparateBackgroundWork];
    if (key === 'sessionListOrderingModeV1') return [sessionListOrderingModeSetting, setSessionListOrderingMode];
    if (key === 'sessionListFolderSortModeV1') return [sessionListFolderSortModeSetting, setSessionListFolderSortMode];
    if (key === 'sessionFolderViewModeV1') return ['tree', vi.fn()];
    if (key === 'workspacePathDisplayModeV1') return ['name', setWorkspacePathDisplayMode];
    if (key === 'workspaceFaviconsEnabled') return [true, setWorkspaceFaviconsEnabled];
    if (key === 'workspaceMachineSubtitlesEnabled') return [true, setWorkspaceMachineSubtitlesEnabled];
    if (key === 'sessionListNarrowWorkingIndicatorStyle') return ['spinner', setSessionListWorkingIndicatorStyle];
    if (key === 'hideInactiveSessions') return [false, vi.fn()];
    if (key === 'sessionListSectionModeV1') return ['activity', setSessionListSectionMode];
    if (key === 'sessionListActiveGroupingV1') return ['project', vi.fn()];
    if (key === 'sessionListInactiveGroupingV1') return ['date', vi.fn()];
    if (key === 'agentInputActionBarLayout') return ['auto', vi.fn()];
    if (key === 'agentInputChipDensity') return ['auto', vi.fn()];
    if (key === 'alwaysShowContextSize') return [false, vi.fn()];
    if (key === 'sessionUseTmux') return [false, vi.fn()];
    if (key === 'sessionTmuxSessionName') return ['happy', vi.fn()];
    if (key === 'sessionTmuxIsolated') return [true, vi.fn()];
    if (key === 'sessionTmuxTmpDir') return [null, vi.fn()];
    if (key === 'sessionMessageSendMode') return ['agent_queue', vi.fn()];
    if (key === 'sessionBusySteerSendPolicy') return ['steer_immediately', vi.fn()];
    if (key === 'agentInputEnterToSend') return [true, vi.fn()];
    if (key === 'agentInputHistoryScope') return ['perSession', vi.fn()];
    if (key === 'terminalConnectLegacySecretExportEnabled') return [false, vi.fn()];
    if (key === 'sessionReplayEnabled') return [false, vi.fn()];
    if (key === 'sessionReplayStrategy') return ['recent_messages', vi.fn()];
    if (key === 'sessionReplayRecentMessagesCount') return [250, vi.fn()];
    if (key === 'sessionReplayMaxSeedChars') return [120000, vi.fn()];
    if (key === 'sessionReplaySummaryRunnerV1') return [null, vi.fn()];
    if (key === 'usageLimitRecoverySettingsV1') return [{ v: 1, mode: 'ask' }, vi.fn()];
    return undefined;
}

vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettings,
}));

beforeEach(() => {
    sessionSettingsEntryState.options.featureEnabled = foldersEnabled;
});

afterEach(() => {
    standardCleanup();
    setSessionListDensity.mockClear();
    setSessionListOrderingMode.mockClear();
    setSessionListFolderSortMode.mockClear();
    setWorkspacePathDisplayMode.mockClear();
    setWorkspaceFaviconsEnabled.mockClear();
    setWorkspaceMachineSubtitlesEnabled.mockClear();
    setSessionListWorkingIndicatorStyle.mockClear();
    setSessionListIdentityDisplay.mockClear();
    setSessionHeaderIdentityDisplay.mockClear();
    setSessionListActiveColorMode.mockClear();
    setSessionListAttentionPromotionMode.mockClear();
    setSessionListWorkingPlacementMode.mockClear();
    setSessionListSeparateBackgroundWork.mockClear();
    setSessionListSectionMode.mockClear();
    applySettings.mockClear();
    resetSessionSettingsEntryState();
    translationPrefix = 'en';
    sessionListOrderingModeSetting = 'custom';
    sessionListFolderSortModeSetting = 'foldersFirst';
});

describe('Session settings session list density', () => {
    it('defaults to the narrow density option and updates only the canonical density setting', async () => {
        setSessionListDensity.mockClear();
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const densityTiles = screen.findByProps({ testID: 'settings-session-sessionListDensity' }).props.rightElement;
        const headerIdentityDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionHeaderIdentityDisplay-trigger');
        const orderingDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListOrderingMode-trigger');
        const folderDisplayDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionFolderViewMode-trigger');
        const folderSortDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListFolderSortMode-trigger');
        expect(densityTiles.props.variant).toBe('visual');
        expect(headerIdentityDropdown).toBeTruthy();
        expect(densityTiles.props.value).toBe('narrow');
        expect(orderingDropdown).toBeTruthy();
        expect(orderingDropdown?.props?.selectedId).toBe('ordering:custom');
        expect(folderDisplayDropdown).toBeTruthy();
        expect(folderDisplayDropdown?.props?.selectedId).toBe('folderDisplay:tree');
        expect(folderSortDropdown).toBeTruthy();
        expect(folderSortDropdown?.props?.selectedId).toBe('folderSort:foldersFirst');

        expect(densityTiles.props.options.map((option: any) => option.id)).toEqual(['detailed', 'cozy', 'narrow']);
        expect(orderingDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['ordering:custom', 'ordering:updated', 'ordering:created']);
        expect(folderDisplayDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['folderDisplay:off', 'folderDisplay:tree']);
        expect(folderSortDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['folderSort:foldersFirst', 'folderSort:mixed']);

        await act(async () => {
            densityTiles.props.onChange('cozy');
        });

        expect(setSessionListDensity).toHaveBeenCalledWith('cozy');

        await act(async () => {
            headerIdentityDropdown!.props.onSelect('agentLogo');
        });

        expect(setSessionHeaderIdentityDisplay).toHaveBeenCalledTimes(1);
        expect(setSessionHeaderIdentityDisplay).toHaveBeenCalledWith('agentLogo');

        await act(async () => {
            orderingDropdown!.props.onSelect('ordering:updated');
        });

        expect(applySettings).toHaveBeenCalledWith({ sessionListOrderingModeV1: 'updated' });

        await act(async () => {
            folderDisplayDropdown!.props.onSelect('folderDisplay:off');
        });

        expect(applySettings).toHaveBeenCalledWith({ sessionFolderViewModeV1: 'off' });

        await act(async () => {
            folderSortDropdown!.props.onSelect('folderSort:mixed');
        });

        expect(applySettings).toHaveBeenCalledWith({ sessionListFolderSortModeV1: 'mixed' });
    });

    it('refreshes the density, ordering, and grouping dropdown labels when the language changes and the screen rerenders', async () => {
        translationPrefix = 'en';
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const readDropdowns = () => {
            const dropdowns = screen.findAllByType('DropdownMenu' as any);
            return {
                density: screen.findByProps({ testID: 'settings-session-sessionListDensity' }).props.rightElement,
                ordering: dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListOrderingMode-trigger'),
                folderSort: dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListFolderSortMode-trigger'),
                grouping: dropdowns.find((node: any) => String(node.props?.itemTrigger?.title).endsWith('settingsFeatures.sessionListActiveGrouping')),
            };
        };

        expect(readDropdowns().density?.props?.options?.map((option: { title: string }) => option.title)).toEqual([
            'en:settingsAppearance.sessionListDensity.detailed',
            'en:settingsAppearance.sessionListDensity.cozy',
            'en:settingsAppearance.sessionListDensity.narrow',
        ]);
        expect(readDropdowns().ordering?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'en:settingsSession.sessionList.orderingOptions.custom',
            'en:settingsSession.sessionList.orderingOptions.updated',
            'en:settingsSession.sessionList.orderingOptions.created',
        ]);
        expect(readDropdowns().folderSort?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'en:settingsSession.sessionList.folderSortModeFoldersFirstTitle',
            'en:settingsSession.sessionList.folderSortModeMixedTitle',
        ]);
        expect(readDropdowns().grouping?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'en:settingsFeatures.sessionListGrouping.projectTitle',
            'en:settingsFeatures.sessionListGrouping.dateTitle',
        ]);
        const preview = await renderSettingsView(readDropdowns().density);
        expect(preview.getTextContent()).toContain('en:settingsSessionPages.preview.userMessage');

        translationPrefix = 'fr';
        await act(async () => {
            await screen.update(React.createElement(SessionSettingsScreen));
        });
        await act(async () => {
            await preview.update(readDropdowns().density);
        });
        expect(preview.getTextContent()).toContain('fr:settingsSessionPages.preview.userMessage');
        expect(preview.getTextContent()).not.toContain('en:settingsSessionPages.preview.userMessage');

        expect(readDropdowns().density?.props?.options?.map((option: { title: string }) => option.title)).toEqual([
            'fr:settingsAppearance.sessionListDensity.detailed',
            'fr:settingsAppearance.sessionListDensity.cozy',
            'fr:settingsAppearance.sessionListDensity.narrow',
        ]);
        expect(readDropdowns().ordering?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'fr:settingsSession.sessionList.orderingOptions.custom',
            'fr:settingsSession.sessionList.orderingOptions.updated',
            'fr:settingsSession.sessionList.orderingOptions.created',
        ]);
        expect(readDropdowns().folderSort?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'fr:settingsSession.sessionList.folderSortModeFoldersFirstTitle',
            'fr:settingsSession.sessionList.folderSortModeMixedTitle',
        ]);
        expect(readDropdowns().grouping?.props?.items?.map((item: { title: string }) => item.title)).toEqual([
            'fr:settingsFeatures.sessionListGrouping.projectTitle',
            'fr:settingsFeatures.sessionListGrouping.dateTitle',
        ]);
    });

    it('shows folders-first as the effective folder sort mode while mixed is dormant in date ordering mode', async () => {
        sessionListOrderingModeSetting = 'updated';
        sessionListFolderSortModeSetting = 'mixed';

        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const folderSortDropdown = dropdowns.find((node: any) => node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListFolderSortMode-trigger');
        expect(folderSortDropdown?.props?.selectedId).toBe('folderSort:foldersFirst');

        const mixedItem = folderSortDropdown?.props?.items?.find((item: any) => item.id === 'folderSort:mixed');
        expect(mixedItem?.disabled).toBe(true);
        expect(mixedItem?.subtitle).toBe('en:settingsSession.sessionList.folderSortModeMixedDisabledInDateModeSubtitle');

        await act(async () => {
            folderSortDropdown!.props.onSelect('folderSort:mixed');
        });
        expect(applySettings).not.toHaveBeenCalled();
    });

    it('exposes workspace name and favicon controls in the session list settings', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const workspaceNameDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-workspacePathDisplay-trigger');
        expect(workspaceNameDropdown).toBeTruthy();
        expect(workspaceNameDropdown?.props?.selectedId).toBe('name');
        expect(workspaceNameDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['name', 'path']);

        await act(async () => {
            workspaceNameDropdown!.props.onSelect('path');
        });
        expect(setWorkspacePathDisplayMode).toHaveBeenCalledWith('path');

        const faviconItem = screen.findAllByType('Item' as any).find((node: any) =>
            node.props?.title === 'en:settingsSession.sessionList.workspaceFaviconsTitle');
        expect(faviconItem).toBeTruthy();
        await act(async () => {
            faviconItem!.props.onPress();
        });
        expect(setWorkspaceFaviconsEnabled).toHaveBeenCalledWith(false);

        const machineSubtitleItem = screen.findAllByType('Item' as any).find((node: any) =>
            node.props?.title === 'en:settingsSession.sessionList.workspaceMachineSubtitlesTitle');
        expect(machineSubtitleItem).toBeTruthy();
        await act(async () => {
            machineSubtitleItem!.props.onPress();
        });
        expect(setWorkspaceMachineSubtitlesEnabled).toHaveBeenCalledWith(false);

        const workingIndicatorDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-workingIndicator-trigger');
        expect(workingIndicatorDropdown).toBeTruthy();
        expect(workingIndicatorDropdown?.props?.selectedId).toBe('spinner');
        expect(workingIndicatorDropdown?.props?.itemTrigger?.title).toBe('en:settingsSession.sessionList.workingIndicatorTitle');

        await act(async () => {
            workingIndicatorDropdown!.props.onSelect('pulse');
        });
        expect(setSessionListWorkingIndicatorStyle).toHaveBeenCalledWith('pulse');
    });

    it('exposes the session list identity display selector near density', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const identityDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListIdentityDisplay-trigger');
        expect(identityDropdown).toBeTruthy();
        expect(identityDropdown?.props?.selectedId).toBe('agentLogo');
        expect(identityDropdown?.props?.itemTrigger?.title).toBe('en:settingsSession.sessionList.identityDisplayTitle');
        expect(identityDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['avatar', 'agentLogo', 'none']);
        expect(identityDropdown?.props?.items?.[1]?.title).toBe('en:settingsSession.sessionList.identityDisplayAgentLogoTitle');

        await act(async () => {
            identityDropdown!.props.onSelect('agentLogo');
        });

        expect(setSessionListIdentityDisplay).toHaveBeenCalledWith('agentLogo');
    });

    it('exposes the session list active color mode selector', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const activeColorDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-sessionListActiveColorMode-trigger');
        expect(activeColorDropdown).toBeTruthy();
        expect(activeColorDropdown?.props?.selectedId).toBe('activityAndAttention');
        expect(activeColorDropdown?.props?.itemTrigger?.title).toBe('en:settingsSession.sessionList.activeColorTitle');
        expect(activeColorDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['activityAndAttention', 'attentionOnly', 'allActive']);

        await act(async () => {
            activeColorDropdown!.props.onSelect('attentionOnly');
        });

        expect(setSessionListActiveColorMode).toHaveBeenCalledWith('attentionOnly');
    });

    it('exposes the session list attention promotion selector', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const attentionPromotionDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-attentionPromotionMode-trigger');
        expect(attentionPromotionDropdown).toBeTruthy();
        expect(attentionPromotionDropdown?.props?.selectedId).toBe('attention:global');
        expect(attentionPromotionDropdown?.props?.itemTrigger?.title).toBe('en:settingsSession.sessionList.attentionPromotionModeTitle');
        expect(attentionPromotionDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['attention:off', 'attention:global', 'attention:withinGroups']);

        await act(async () => {
            attentionPromotionDropdown!.props.onSelect('attention:withinGroups');
        });

        expect(applySettings).toHaveBeenCalledWith({ sessionListAttentionPromotionModeV1: 'withinGroups' });
    });

    it('exposes the session list working placement selector', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const dropdowns = screen.findAllByType('DropdownMenu' as any);
        const workingPlacementDropdown = dropdowns.find((node: any) =>
            node.props?.itemTrigger?.itemProps?.testID === 'settings-session-workingPlacementMode-trigger');
        expect(workingPlacementDropdown).toBeTruthy();
        expect(workingPlacementDropdown?.props?.selectedId).toBe('working:off');
        expect(workingPlacementDropdown?.props?.itemTrigger?.title).toBe('en:settingsSession.sessionList.workingPlacementModeTitle');
        expect(workingPlacementDropdown?.props?.items?.map((item: any) => item.id)).toEqual(['working:off', 'working:global', 'working:withinGroups']);

        await act(async () => {
            workingPlacementDropdown!.props.onSelect('working:global');
        });

        expect(applySettings).toHaveBeenCalledWith({ sessionListWorkingPlacementModeV1: 'global' });
    });

    it('offers all layout previews as visible choices and applies the canonical atomic settings delta', async () => {
        const mod = await import('../../../../app/(app)/settings/session');
        const SessionSettingsScreen = (mod.default as unknown as {
            type: React.ComponentType<Record<string, never>>;
        }).type;

        const screen = await renderSettingsView(React.createElement(SessionSettingsScreen));
        const layoutRow = screen.findByTestId('settings-session-sessionListLayout');
        expect(layoutRow).not.toBeNull();
        // The route harness keeps Item opaque. Mount its real picker to exercise
        // the visible radio controls, not a callback on a mocked menu.
        const picker = await renderSettingsView(layoutRow!.props.rightElement);
        const projects = picker.findByTestId('settings-session-sessionListLayout:layout:projects');
        const recent = picker.findByTestId('settings-session-sessionListLayout:layout:recent_activity');
        const activeInactive = picker.findByTestId('settings-session-sessionListLayout:layout:active_inactive');
        expect(projects?.props.accessibilityRole).toBe('radio');
        expect(recent?.props.accessibilityRole).toBe('radio');
        expect(activeInactive?.props['aria-checked']).toBe(true);
        expect(recent?.props['aria-checked']).toBe(false);

        await picker.pressByTestIdAsync('settings-session-sessionListLayout:layout:recent_activity');

        expect(applySettings).toHaveBeenCalledWith({
            sessionListSectionModeV1: 'single',
            sessionListActiveGroupingV1: 'date',
        });
    });
});
