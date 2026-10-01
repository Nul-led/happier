import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { widgetInstalledPackage, widgetProjectionOf } from '@/dev/testkit/fixtures/pluginWidgetProjectionFixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Layout = { order: string[]; hidden: string[] };

// The Account Settings document (the synced store boundary): one value plus its subscribers.
const settings = vi.hoisted(() => ({
    layout: { order: [], hidden: [] } as Layout,
    listeners: new Set<() => void>(),
    writes: [] as Layout[],
    guidanceKind: 'select_session' as string,
    machineCount: 0,
    machineMounts: 0,
}));

// Plugin widgets: the app shell's projection, each widget's own data (inside the plugin, behind the
// surface host boundary), and how often the hub and its sections render.
const widgets = vi.hoisted(() => ({
    projection: null as unknown,
    data: {} as Record<string, number>,
    dataListeners: new Set<() => void>(),
    bodyRenders: {} as Record<string, number>,
    bodyMounts: {} as Record<string, number>,
    hubRenders: 0,
    setupRenders: 0,
    focused: true,
    focusListeners: new Set<() => void>(),
}));

// The usage summary owner's value (a server read that arrives, and can go, after the home draws).
const usage = vi.hoisted(() => ({
    summary: { entries: [] as unknown[], asOf: null, source: 'none' } as { entries: unknown[]; asOf: null; source: string },
    listeners: new Set<() => void>(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('@react-navigation/native', async () => {
    const ReactModule = await import('react');
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    const subscribe = (listener: () => void) => {
        widgets.focusListeners.add(listener);
        return () => { widgets.focusListeners.delete(listener); };
    };
    return {
        ...createReactNavigationNativeMock(),
        useIsFocused: () => ReactModule.useSyncExternalStore(subscribe, () => widgets.focused),
    };
});
// The plugin surface host is the plugin runtime boundary: past it the plugin runs its own code
// and keeps its own data. This stand-in renders one widget's data from its own store.
vi.mock('@/components/plugins/surfaces', async () => {
    const ReactModule = await import('react');
    const subscribe = (listener: () => void) => {
        widgets.dataListeners.add(listener);
        return () => { widgets.dataListeners.delete(listener); };
    };
    return {
        PluginInlineSurfaceHost: (props: { placement: { binding: { surface: { localId: string } } } }) => {
            const localId = props.placement.binding.surface.localId;
            const value = ReactModule.useSyncExternalStore(subscribe, () => widgets.data[localId] ?? 0);
            widgets.bodyRenders[localId] = (widgets.bodyRenders[localId] ?? 0) + 1;
            ReactModule.useEffect(() => {
                widgets.bodyMounts[localId] = (widgets.bodyMounts[localId] ?? 0) + 1;
                return () => { widgets.bodyMounts[localId] = (widgets.bodyMounts[localId] ?? 0) - 1; };
            }, [localId]);
            return `widget:${localId}=${value}`;
        },
    };
});
// The popover's positioning and portal are a platform overlay boundary (DOM measurement); past it,
// the content renders as it would inside the real popover.
vi.mock('@/components/ui/popover', async (importOriginal) => {
    const ReactModule = await import('react');
    return {
        ...(await importOriginal<Record<string, unknown>>()),
        Popover: (props: { open: boolean; children: React.ReactNode | ((p: { maxHeight: number; maxWidth: number }) => React.ReactNode) }) => (
            props.open
                ? ReactModule.createElement(ReactModule.Fragment, null, typeof props.children === 'function'
                    ? props.children({ maxHeight: 640, maxWidth: 360 })
                    : props.children)
                : null
        ),
    };
});
vi.mock('@/components/ui/overlays/FloatingOverlay', async (importOriginal) => {
    const ReactModule = await import('react');
    return { ...(await importOriginal<Record<string, unknown>>()), FloatingOverlay: (props: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, props.children) };
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});
vi.mock('@/sync/domains/state/storage', async () => {
    const ReactModule = await import('react');
    const { createStorageModuleStub, createUseSettingMutableMockFromReader } = await import('@/dev/testkit/mocks/storage');
    const subscribe = (listener: () => void) => {
        settings.listeners.add(listener);
        return () => { settings.listeners.delete(listener); };
    };
    // The real `useSettingMutable` setter keeps one identity across renders; so does this one.
    const writeLayout = (next: Layout) => {
        settings.writes.push(next);
        settings.layout = next;
        for (const listener of [...settings.listeners]) listener();
    };
    return createStorageModuleStub({
        useAllMachines: () => Array.from({ length: settings.machineCount }, (_, index) => ({ id: `m${index}` })),
        useProfile: () => ({ id: 'p', firstName: null, lastName: null, username: null, linkedProviders: [] }),
        useSettingMutable: createUseSettingMutableMockFromReader((key) => {
            if (key !== 'homeHubLayoutV1') throw new Error(`unexpected setting ${String(key)}`);
            const value = ReactModule.useSyncExternalStore(subscribe, () => settings.layout);
            return [value, writeLayout] as const;
        }),
    });
});

// Each section is its own owner with its own tests; the home decides only which show, and where.
vi.mock('./composer/HubComposerSection', () => ({ HubComposerSection: () => 'section:start' }));
vi.mock('./HubAttentionSection', () => ({ HubAttentionSection: () => 'section:attention' }));
vi.mock('./HubSetupSection', () => ({
    HubSetupSection: () => {
        widgets.setupRenders += 1;
        return 'section:setup';
    },
}));
vi.mock('./HubMachinesSection', async () => {
    const ReactModule = await import('react');
    return {
        HubMachinesSection: () => {
            ReactModule.useEffect(() => { settings.machineMounts += 1; }, []);
            return 'section:machines';
        },
    };
});
vi.mock('./HubUsageSection', () => ({ HubUsageSection: () => 'section:usage' }));
vi.mock('@/components/automations/home/AutomationsLatestRunsSection', () => ({ AutomationsLatestRunsSection: () => 'section:automations' }));
// The status line is its own owner (it reads the Activity summary, tested there).
vi.mock('./header/HubStatusLine', () => ({ HubStatusLine: () => 'status-line' }));
vi.mock('@/components/homes/journeys/label/HomeWhereLine', () => ({ HomeWhereLine: () => 'home-where' }));
vi.mock('./usage/useUsageSummary', async () => {
    const ReactModule = await import('react');
    const subscribe = (listener: () => void) => {
        usage.listeners.add(listener);
        return () => { usage.listeners.delete(listener); };
    };
    return { useUsageSummary: () => ReactModule.useSyncExternalStore(subscribe, () => usage.summary) };
});

async function setUsage(entries: unknown[]) {
    await act(async () => {
        usage.summary = { entries, asOf: null, source: entries.length > 0 ? 'live' : 'none' };
        for (const listener of [...usage.listeners]) listener();
    });
    await flushHookEffects({ cycles: 2 });
}
vi.mock('@/components/sessions/guidance/useSessionGettingStartedGuidanceBaseModel', () => ({
    useSessionGettingStartedGuidanceBaseModel: () => {
        // Only the hub itself reads this model, so it counts the hub's renders.
        widgets.hubRenders += 1;
        return { kind: settings.guidanceKind };
    },
}));
vi.mock('@/components/sessions/guidance/SessionGettingStartedGuidance', () => ({
    SessionGettingStartedGuidance: () => 'guidance',
}));

afterEach(() => {
    standardCleanup();
    settings.layout = { order: [], hidden: [] };
    settings.writes = [];
    settings.guidanceKind = 'select_session';
    settings.machineCount = 0;
    settings.machineMounts = 0;
    settings.listeners.clear();
    usage.summary = { entries: [], asOf: null, source: 'none' };
    usage.listeners.clear();
    widgets.projection = null;
    widgets.data = {};
    widgets.dataListeners.clear();
    widgets.bodyRenders = {};
    widgets.bodyMounts = {};
    widgets.hubRenders = 0;
    widgets.setupRenders = 0;
    widgets.focused = true;
    widgets.focusListeners.clear();
});

async function renderHome() {
    const { HomeHub } = await import('./HomeHub');
    const { AppShellPluginUiProjectionValueProvider } = await import('@/components/appShell/plugins/AppShellPluginUiProjection');
    const element = () => (
        <AppShellPluginUiProjectionValueProvider
            value={{
                pluginUiProjection: widgets.projection as never,
                pluginBrowserProjection: null,
                phase: 'current',
                interactionEnabled: true,
                machineId: 'machine-1',
                serverId: 'server-1',
                platform: 'web',
                clientExecutableActivation: { status: 'ready' },
                reloadClientExecutables: () => {},
                reloadConnectedAccountProjection: () => {},
            }}
        >
            <HomeHub />
        </AppShellPluginUiProjectionValueProvider>
    );
    const rendered = await renderScreen(element());
    const screen = Object.assign(rendered, {
        /** Re-render under the app shell projection currently in `widgets.projection`. */
        rerender: async () => {
            await rendered.update(element());
            await flushHookEffects({ cycles: 2 });
        },
    });
    await flushHookEffects({ cycles: 2 });
    return screen;
}

function shownSections(text: string): string[] {
    return [...text.matchAll(/section:([a-z]+)/g)].map((match) => match[1]!);
}

describe('HomeHub', () => {
    it('holds a quiet page while it is not known yet whether a machine can run a session', async () => {
        settings.guidanceKind = 'loading';
        const loading = await renderHome();
        // Neither the hub nor the getting-started guidance (and its mark) draws until the answer.
        expect(loading.findByTestId('home-hub.loading')).toBeTruthy();
        expect(loading.getTextContent()).not.toContain('guidance');
        expect(shownSections(loading.getTextContent())).toEqual([]);
        standardCleanup();

        settings.guidanceKind = 'connect_machine';
        const firstRun = await renderHome();
        expect(firstRun.getTextContent()).toContain('guidance');
    });

    it('shows the Account\'s sections in its order, never hiding "Start a session" or "Needs your attention"', async () => {
        settings.layout = { order: ['usage', 'start'], hidden: ['setup', 'start', 'attention'] };
        const screen = await renderHome();

        // Machines is off until the person turns it on.
        expect(shownSections(screen.getTextContent())).toEqual(['usage', 'start', 'attention', 'automations']);
    });

    it('opens Customize over the live page: switches, keyboard moves and reset write the Account layout', async () => {
        const screen = await renderHome();
        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'usage']);

        screen.pressByTestId('home-hub.customize');
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('home-hub.customize.popover')).toBeTruthy();
        // Always shown: no switch.
        expect(screen.findByTestId('home-layout.attention.shown')).toBeNull();
        await act(async () => {
            screen.findByTestId('home-layout.machines.shown')!.props.onValueChange(true);
        });
        await flushHookEffects({ cycles: 2 });
        // The page behind updates at once.
        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'machines', 'usage']);

        // The grip's keyboard/assistive "move up" (⌥↑ on the web) is the drag's accessible twin.
        await act(async () => {
            screen.findByTestId('home-layout.usage.grip')!.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
        });
        await flushHookEffects({ cycles: 2 });
        expect(settings.writes.at(-1)).toEqual({
            order: ['start', 'attention', 'setup', 'automations', 'usage', 'machines'],
            hidden: [],
        });

        screen.pressByTestId('home-layout.reset');
        await flushHookEffects({ cycles: 2 });
        expect(settings.layout).toEqual({ order: [], hidden: [] });
        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'usage']);

        // The header button closes it again.
        screen.pressByTestId('home-hub.customize');
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('home-hub.customize.popover')).toBeNull();
    });

    it('offers dismissed setup steps back from Customize', async () => {
        settings.layout = { order: [], hidden: ['setup:addPhone', 'setup:addMachine'] };
        const screen = await renderHome();
        screen.pressByTestId('home-hub.customize');
        await flushHookEffects({ cycles: 2 });

        screen.pressByTestId('home-layout.hiddenSetupSteps');
        await flushHookEffects({ cycles: 2 });
        expect(settings.layout.hidden).toEqual([]);
        expect(screen.findByTestId('home-layout.hiddenSetupSteps')).toBeNull();
    });

    it('keeps the Machines section mounted while usage arrives and goes away', async () => {
        settings.machineCount = 1;
        settings.layout = { order: ['start', 'attention', 'setup', 'automations', 'machines', 'usage'], hidden: [] };
        const screen = await renderHome();
        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'machines', 'usage']);
        expect(settings.machineMounts).toBe(1);

        await setUsage([{ key: 'claude' }]);
        await setUsage([]);

        // Usage arriving changes the Usage section's content, never the page's structure.
        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'machines', 'usage']);
        expect(settings.machineMounts).toBe(1);
    });
});

describe('HomeHub plugin widgets', () => {
    const LATEST = 'widget:acme.review/latest';
    const RUNS = 'widget:acme.ci/runs';
    const CHECKS = 'widget:acme.ci/checks';

    function installWidgets() {
        widgets.projection = widgetProjectionOf([
            { pluginId: 'acme.review', localId: 'latest', title: 'Latest reviews', target: 'app', homeDefault: 'shown' },
            { pluginId: 'acme.ci', localId: 'checks', title: 'Checks', target: 'app', homeDefault: 'shown' },
            { pluginId: 'acme.ci', localId: 'runs', title: 'Recent runs', target: 'app' },
            // A Session widget is the Board's, never Home's.
            { pluginId: 'acme.ci', localId: 'session-log', title: 'Session log', target: 'session' },
        ], {
            'acme.review': widgetInstalledPackage('acme.review', 'Review Assistant'),
            'acme.ci': widgetInstalledPackage('acme.ci', 'CI'),
        });
    }

    function layoutEvent(y: number, height: number) {
        return { nativeEvent: { layout: { x: 0, y, width: 600, height } } };
    }

    /** The page's viewport and each widget section's place in it, as the platform reports them. */
    async function lay(screen: Awaited<ReturnType<typeof renderHome>>, places: Readonly<Record<string, number>>) {
        await act(async () => {
            screen.findByTestId('home-hub')!.props.onLayout(layoutEvent(0, 800));
            for (const [id, y] of Object.entries(places)) {
                screen.findByTestId(`home-hub.section.${id}`)!.props.onLayout(layoutEvent(y, 200));
            }
        });
        await flushHookEffects({ cycles: 2 });
    }

    async function setWidgetData(localId: string, value: number) {
        await act(async () => {
            widgets.data = { ...widgets.data, [localId]: value };
            for (const listener of [...widgets.dataListeners]) listener();
        });
        await flushHookEffects({ cycles: 2 });
    }

    it('shows the widgets that declare themselves shown after the built-in sections; the rest wait in Add widgets', async () => {
        installWidgets();
        const screen = await renderHome();

        expect(shownSections(screen.getTextContent())).toEqual(['start', 'attention', 'setup', 'automations', 'usage']);
        expect(screen.findByTestId(`home-hub.section.${LATEST}`)).toBeTruthy();
        expect(screen.findByTestId(`home-hub.section.${CHECKS}`)).toBeTruthy();
        expect(screen.findByTestId(`home-hub.section.${RUNS}`)).toBeNull();
        expect(screen.findByTestId('home-hub.section.widget:acme.ci/session-log')).toBeNull();

        // Customize is one list: built-ins, widgets on Home, and the widgets plugins offer, switched off.
        screen.pressByTestId('home-hub.customize');
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId(`home-layout.${LATEST}.shown`)!.props.value).toBe(true);
        expect(screen.findByTestId(`home-layout.${RUNS}.shown`)!.props.value).toBe(false);
        expect(screen.findByTestId(`home-layout.${RUNS}.grip`)).toBeNull();

        await act(async () => {
            screen.findByTestId(`home-layout.${RUNS}.shown`)!.props.onValueChange(true);
        });
        await flushHookEffects({ cycles: 2 });
        expect(settings.writes.at(-1)).toEqual({
            order: ['start', 'attention', 'setup', CHECKS, LATEST, 'automations', 'machines', 'usage', RUNS],
            hidden: ['machines'],
        });
        await act(async () => {
            screen.findByTestId(`home-layout.${LATEST}.shown`)!.props.onValueChange(false);
        });
        await flushHookEffects({ cycles: 2 });
        expect(settings.writes.at(-1)?.hidden).toEqual(['machines', LATEST]);
        expect(screen.findByTestId(`home-layout.${LATEST}.shown`)!.props.value).toBe(false);
        expect(screen.findByTestId(`home-hub.section.${LATEST}`)).toBeNull();
        expect(screen.findByTestId(`home-hub.section.${RUNS}`)).toBeTruthy();
    });

    it('builds a widget body only while Home is focused and the widget is near the viewport', async () => {
        installWidgets();
        const screen = await renderHome();
        // Not laid out yet: nothing runs.
        expect(widgets.bodyMounts.latest ?? 0).toBe(0);

        await lay(screen, { [LATEST]: 900, [CHECKS]: 5000 });
        expect(widgets.bodyMounts.latest).toBe(1);
        expect(widgets.bodyMounts.checks ?? 0).toBe(0);
        expect(screen.findByTestId(`home-hub.section.${CHECKS}.deferred`)).toBeTruthy();

        // Scrolled far down: the first leaves, the second arrives.
        await act(async () => {
            screen.findByTestId('home-hub')!.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 4600 } } });
        });
        await flushHookEffects({ cycles: 2 });
        expect(widgets.bodyMounts.latest).toBe(0);
        expect(widgets.bodyMounts.checks).toBe(1);

        // Another page covers Home: nothing keeps running behind it.
        await act(async () => {
            widgets.focused = false;
            for (const listener of [...widgets.focusListeners]) listener();
        });
        await flushHookEffects({ cycles: 2 });
        expect(widgets.bodyMounts.checks).toBe(0);
    });

    it('re-renders only the widget whose data changed — never the hub or its sibling sections', async () => {
        installWidgets();
        const screen = await renderHome();
        await lay(screen, { [LATEST]: 900, [CHECKS]: 1100 });
        expect(widgets.bodyMounts.latest).toBe(1);
        expect(widgets.bodyMounts.checks).toBe(1);

        const before = {
            hub: widgets.hubRenders,
            setup: widgets.setupRenders,
            checks: widgets.bodyRenders.checks,
            latest: widgets.bodyRenders.latest!,
        };
        await setWidgetData('latest', 1);
        await setWidgetData('latest', 2);

        expect(screen.getTextContent()).toContain('widget:latest=2');
        expect(widgets.bodyRenders.latest).toBe(before.latest + 2);
        expect(widgets.bodyRenders.checks).toBe(before.checks);
        expect(widgets.setupRenders).toBe(before.setup);
        expect(widgets.hubRenders).toBe(before.hub);

        // A new projection that leaves the widgets as they were (another plugin updated) reaches the
        // hub, but no section re-renders for it.
        installWidgets();
        const setupBeforeProjection = widgets.setupRenders;
        await screen.rerender();
        expect(widgets.setupRenders).toBe(setupBeforeProjection);
        before.hub = widgets.hubRenders;

        // Scrolling moves the window, never the hub.
        await act(async () => {
            screen.findByTestId('home-hub')!.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 300 } } });
        });
        await flushHookEffects({ cycles: 2 });
        expect(widgets.hubRenders).toBe(before.hub);
        expect(widgets.setupRenders).toBe(before.setup);
    });
});
