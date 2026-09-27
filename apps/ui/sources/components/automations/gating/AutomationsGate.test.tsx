import React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installAutomationComponentCommonModuleMocks } from '../automationComponentTestHelpers';


const useFeatureDecisionMock = vi.fn();
const getServerFeaturesSnapshotMock = vi.fn(async (_params: unknown) => ({ status: 'ready' }));
const selectionState = { serverIds: ['home-1'] as string[] };

/** A real decision shape (`featureDecisionRuntime.ts`), so the gate's classification runs for real. */
function decision(fields: Record<string, unknown> | null) {
    if (!fields) return null;
    return { featureId: 'automations', diagnostics: [], evaluatedAt: 0, scope: { scopeKind: 'main_selection' }, ...fields };
}

/** Maps the earlier support fixtures onto the decision each one came from. */
const useAutomationsSupportMock = {
    mockReturnValue(support: { enabled: boolean; loading: boolean; discoverable?: boolean; blockedBy: string | null; blockerCode: string | null }) {
        useFeatureDecisionMock.mockReturnValue(support.loading ? null : decision(support.enabled
            ? { state: 'enabled', blockedBy: null, blockerCode: 'none' }
            : { state: 'disabled', blockedBy: support.blockedBy, blockerCode: support.blockerCode }));
    },
    mockReset() { useFeatureDecisionMock.mockReset(); },
};
const routerPushMock = vi.fn();
const settingsState = { experiments: true };

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: routerPushMock } }).module;
});

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createPartialStorageModuleMock(importOriginal, {
        useSetting: (name: string) => (name === 'experiments' ? settingsState.experiments : undefined),
    });
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => useFeatureDecisionMock(),
}));

vi.mock('@/hooks/server/useEffectiveServerSelection', () => ({
    useEffectiveServerSelection: () => ({ serverIds: selectionState.serverIds }),
}));

// The Home's feature probe is a network boundary.
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: (params: unknown) => getServerFeaturesSnapshotMock(params),
}));

installAutomationComponentCommonModuleMocks({
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    textSecondary: '#999',
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => {
                if (key === 'automations.gate.disabledTitle') return 'Automations are disabled';
                if (key === 'automations.gate.disabledBody') return 'Enable them from Settings, then turn on Experiments and Automations.';
                return key;
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: any) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1000 },
    useLayoutMaxWidth: () => 1000,
    useLayoutMaxWidthStyle: () => ({ maxWidth: 1000 }),
}));

afterEach(() => {
    useAutomationsSupportMock.mockReset();
    routerPushMock.mockReset();
    getServerFeaturesSnapshotMock.mockClear();
    selectionState.serverIds = ['home-1'];
    settingsState.experiments = true;
});

describe('AutomationsGate', () => {
    it('renders a loading state while automations support is unresolved', async () => {
        useAutomationsSupportMock.mockReturnValue({
            enabled: false,
            loading: true,
            discoverable: true,
            blockedBy: null,
            blockerCode: null,
        });

        const { AutomationsGate } = await import('./AutomationsGate');
        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<AutomationsGate>
                    <TextStub>Allowed</TextStub>
                </AutomationsGate>)).tree;

        expect(tree.root.findAllByProps({ testID: 'automations-allowed-child' })).toHaveLength(0);
        expect(tree.root.findAllByType('ItemList')).toHaveLength(0);
        expect(tree.root.findAllByProps({ accessibilityRole: 'progressbar' }).length).toBeGreaterThan(0);
    });

    it('renders children when automations are enabled', async () => {
        useAutomationsSupportMock.mockReturnValue({
            enabled: true,
            loading: false,
            discoverable: true,
            blockedBy: null,
            blockerCode: null,
        });

        const { AutomationsGate } = await import('./AutomationsGate');
        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<AutomationsGate>
                    <TextStub>Allowed</TextStub>
                </AutomationsGate>)).tree;

        expect(tree.root.findAllByProps({ testID: 'automations-allowed-child' })).toHaveLength(1);
        expect(tree.root.findAllByType('ItemList')).toHaveLength(0);
        expect(tree.root.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);
    });

    it('renders a disabled state when automations are unavailable', async () => {
        useAutomationsSupportMock.mockReturnValue({
            enabled: false,
            loading: false,
            discoverable: false,
            blockedBy: 'server',
            blockerCode: 'disabled_on_server',
        });

        const { AutomationsGate } = await import('./AutomationsGate');
        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<AutomationsGate>
                    <TextStub>Allowed</TextStub>
                </AutomationsGate>)).tree;

        expect(tree.root.findAllByProps({ testID: 'automations-allowed-child' })).toHaveLength(0);
        expect(tree.root.findAllByType('ItemList')).toHaveLength(1);
        expect(tree.root.findAllByType('Icon')).toHaveLength(1);
        expect(tree.root.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);
    });
});

describe('AutomationsGate next action', () => {
    it.each([
        { experiments: true, anchor: 'features.automations' },
        // Experimental toggles render only under the Experiments switch, so the link lands there first.
        { experiments: false, anchor: 'features.experimentalFeatures' },
    ])('links a setting-blocked state to the Features toggle that turns it on (experiments $experiments)', async ({ experiments, anchor }) => {
        settingsState.experiments = experiments;
        useAutomationsSupportMock.mockReturnValue({
            enabled: false,
            loading: false,
            discoverable: true,
            blockedBy: 'local_policy',
            blockerCode: 'flag_disabled',
        });

        const { AutomationsGate } = await import('./AutomationsGate');
        const { tree } = await renderScreen(<AutomationsGate><TextStub>Allowed</TextStub></AutomationsGate>);

        const action = tree.root.findAllByProps({ testID: 'automations-gate-disabled-action' })[0];
        expect(action).toBeDefined();
        await renderer.act(async () => {
            await action!.props.action();
        });
        expect(routerPushMock).toHaveBeenCalledWith(`/settings/features?setting=${encodeURIComponent(anchor)}`);
    });

    it('says the Home turned automations off, and offers no link, when the server blocks them', async () => {
        useAutomationsSupportMock.mockReturnValue({
            enabled: false,
            loading: false,
            discoverable: false,
            blockedBy: 'server',
            blockerCode: 'feature_disabled',
        });

        const { AutomationsGate } = await import('./AutomationsGate');
        const { tree } = await renderScreen(<AutomationsGate><TextStub>Allowed</TextStub></AutomationsGate>);

        expect(tree.root.findAllByProps({ testID: 'automations-gate-disabled-action' })).toHaveLength(0);
        const card = tree.root.findAllByProps({ testID: 'automations-gate-disabled' })[0];
        expect(card?.props.title).toBe('automationPages.gate.serverTitle');
        expect(card?.props.reason).toBe('automationPages.gate.serverBody');
    });
});

describe('AutomationsGate availability truth', () => {
    it('does not claim administrators turned automations off when the Home could not be checked, and retries the probe', async () => {
        useFeatureDecisionMock.mockReturnValue(decision({ state: 'unknown', blockedBy: 'server', blockerCode: 'probe_failed' }));

        const { AutomationsGate } = await import('./AutomationsGate');
        const { tree } = await renderScreen(<AutomationsGate><TextStub>Allowed</TextStub></AutomationsGate>);

        const card = tree.root.findAllByProps({ testID: 'automations-gate-unknown' })[0];
        expect(card).toBeDefined();
        expect(card?.props.title).toBe('automationPages.gate.unknownTitle');
        expect(tree.root.findAllByProps({ title: 'automationPages.gate.serverTitle' })).toHaveLength(0);
        await renderer.act(async () => {
            await card!.props.action.onPress();
        });
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledWith({ serverId: 'home-1', force: true });
    });

    it('says the Home does not support automations yet when its server predates them', async () => {
        useFeatureDecisionMock.mockReturnValue(decision({ state: 'unsupported', blockedBy: 'server', blockerCode: 'endpoint_missing' }));

        const { AutomationsGate } = await import('./AutomationsGate');
        const { tree } = await renderScreen(<AutomationsGate><TextStub>Allowed</TextStub></AutomationsGate>);

        const card = tree.root.findAllByProps({ testID: 'automations-gate-unsupported' })[0];
        expect(card?.props.title).toBe('automationPages.gate.unsupportedTitle');
        expect(card?.props.reason).toBe('automationPages.gate.unsupportedBody');
        expect(card?.props.action).toBeUndefined();
        expect(tree.root.findAllByProps({ title: 'automationPages.gate.serverTitle' })).toHaveLength(0);
    });
});

function TextStub(props: { children: string }) {
    return React.createElement('Text', { ...props, testID: 'automations-allowed-child' });
}
