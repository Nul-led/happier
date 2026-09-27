import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSettingsView } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let executionRunsEnabledState = false;
let guidanceEntriesState: any[] = [];
let guidanceEnabledState: boolean | null = null;
let guidanceMaxCharsState: number | null = null;
let notifyParentOnCompletionState: boolean | null = null;
let pluginProjectionByIdState: Record<string, any> = {};
const routerPushSpy = vi.fn();
const notifyParentOnCompletionSetter = vi.fn();
const guidanceEntriesSetter = vi.fn();
const guidanceMaxCharsSetter = vi.fn();
const modalConfirm = vi.fn(async () => false);

installSettingsViewCommonModuleMocks({
    icons: () => ({
        Ionicons: 'Ionicons',
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Platform: {
                OS: 'web',
                select: (options: any) => (options && 'default' in options ? options.default : undefined),
            },
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { confirm: modalConfirm as any } }).module;
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { push: routerPushSpy },
        });
        return routerMock.module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSettingMutable: (key: string) => {
                if (key === 'executionRunsGuidanceEnabled') return [guidanceEnabledState, vi.fn()];
                if (key === 'executionRunsGuidanceMaxChars') return [guidanceMaxCharsState, guidanceMaxCharsSetter];
                if (key === 'executionRunsGuidanceEntries') return [guidanceEntriesState, guidanceEntriesSetter];
                if (key === 'executionRunsNotifyParentOnCompletionDefault') return [notifyParentOnCompletionState, notifyParentOnCompletionSetter];
                return [null, vi.fn()];
            },
            useSetting: () => ({
                v: 2,
                backends: [{
                    id: 'custom-review',
                    name: 'custom-review',
                    title: 'Custom Review Bot',
                    description: 'Custom ACP',
                    command: 'custom-acp',
                    args: [],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                }],
            }),
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key, params) => {
                if (params && typeof params.value === 'string') {
                    return `${key}: ${params.value}`;
                }
                return key;
            },
        });
    },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => executionRunsEnabledState,
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: any) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, action }: any) => React.createElement('ItemGroup', null, action, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: 'Switch',
}));

vi.mock('@/constants/Typography', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/constants/Typography')>(),
    Typography: new Proxy({}, { get: () => () => ({}) }),
}));

vi.mock('@/sync/domains/settings/executionRunsGuidance', () => ({
    buildExecutionRunsGuidanceBlock: () => ({ text: '' }),
    coerceExecutionRunsGuidanceEntries: (value: any) => value,
}));

vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({
        inputs: { pluginProjectionById: pluginProjectionByIdState },
    }),
}));

vi.mock('@/agents/backendCatalog/getResolvedBackendCatalogEntries', () => ({
    getResolvedBackendCatalogEntries: () => [
        {
            backendTarget: { kind: 'backend', backendId: 'custom-review', configuredBackendId: 'custom-review' },
            backendTargetKey: 'backend:custom-review:configured:custom-review',
            kind: 'configuredBackend',
            backendId: 'custom-review',
            providerId: 'custom-review',
            catalogAgentId: null,
            builtInAgentId: null,
            iconAgentId: 'customAcp',
            title: 'Custom Review Bot',
            subtitle: 'Custom ACP',
        },
    ],
}));

vi.mock('@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState', () => ({
    useNewSessionPreflightModelsState: () => ({
        preflightModels: null,
        modelOptions: [],
        probe: { phase: 'idle', refreshedAt: null, refresh: () => {} },
    }),
}));

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => 'uuid-test',
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['claude', 'customAcp'],
    DEFAULT_AGENT_ID: 'customAcp',
    getAgentCore: () => ({ displayNameKey: 'agent.name' }),
    isBundledAgentId: () => false,
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => ['claude', 'customAcp'],
}));

describe('SubAgentSettingsView', () => {
    beforeEach(() => {
        executionRunsEnabledState = false;
        guidanceEnabledState = null;
        guidanceMaxCharsState = null;
        notifyParentOnCompletionState = null;
        guidanceEntriesState = [];
        pluginProjectionByIdState = {};
        routerPushSpy.mockReset();
        notifyParentOnCompletionSetter.mockReset();
        guidanceEntriesSetter.mockReset();
        guidanceMaxCharsSetter.mockReset();
        modalConfirm.mockReset();
        modalConfirm.mockImplementation(async () => false);
    });

    it('renders an execution-runs-disabled state when execution runs are not enabled', async () => {
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const enableItem = screen.findRowByTitle('subAgentGuidance.settings.disabled.enableExecutionRuns.title');
        expect(enableItem).toBeTruthy();
    });

    it('leads to Features from the off state', async () => {
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        screen.pressRowByTitle('subAgentGuidance.settings.disabled.enableExecutionRuns.title');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/features');
    });

    it('updates the canonical parent-completion notification setting', async () => {
        executionRunsEnabledState = true;
        notifyParentOnCompletionState = false;
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        screen.pressRowByTitle('subAgentGuidance.settings.notifyParentOnCompletion.title');

        expect(notifyParentOnCompletionSetter).toHaveBeenCalledWith(true);
    });

    it('explains that disabling Happier run instructions removes routing and mechanics', async () => {
        executionRunsEnabledState = true;
        guidanceEnabledState = true;
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const guidanceItem = screen.findRowByTitle('subAgentGuidance.settings.enableInjection.title');

        expect(guidanceItem?.props.subtitle).toBe('subAgentGuidance.settings.enableInjection.subtitle');
    });

    it('renders related subagent settings links and routes to Session settings', async () => {
        executionRunsEnabledState = true;
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const sessionItem = screen.findRowByTitle('subAgentGuidance.settings.related.sessionTitle');
        expect(sessionItem).toBeTruthy();

        screen.pressRowByTitle('subAgentGuidance.settings.related.sessionTitle');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/session');
    });

    it('routes the related Agents entry to the Agents collection', async () => {
        executionRunsEnabledState = true;
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        screen.pressRowByTitle('subAgentGuidance.settings.related.agentsTitle');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/agents');
    });

    it('edits the custom-rules budget in place, keeping it within its bounds', async () => {
        executionRunsEnabledState = true;
        guidanceMaxCharsState = 4000;
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const budgetRow = () => screen.findByTestId('sub-agent-guidance-character-budget');
        expect(budgetRow()?.props.rightElement?.props.value).toBe('4000');
        await act(async () => {
            budgetRow()!.props.rightElement.props.onChangeText('90000');
        });
        await act(async () => {
            budgetRow()!.props.rightElement.props.onBlur();
        });

        expect(guidanceMaxCharsSetter).toHaveBeenCalledWith(50_000);
    });

    it('adds a rule in place: a draft editor opens in the rules and saving appends it', async () => {
        executionRunsEnabledState = true;
        guidanceEnabledState = true;
        guidanceEntriesState = [{ id: 'rule-1', description: 'Existing rule', enabled: true }];
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        // The editor's fields are row controls (`Item` `rightElement`), found through their row.
        const descriptionRowTitle = 'subAgentGuidance.ruleEditor.descriptionField.label';
        expect(screen.findRowByTitle(descriptionRowTitle)).toBeNull();
        await act(async () => {
            screen.pressRowByTitle('subAgentGuidance.settings.rules.addRuleTitle');
        });

        const description = screen.findRowByTitle(descriptionRowTitle)?.props.rightElement;
        expect(description?.props.testID).toBe('sub-agent-guidance-rule-editor.description');
        await act(async () => {
            description.props.onChangeText('Delegate UI reviews');
        });
        await act(async () => {
            await screen.findByTestId('sub-agent-guidance-rule-editor.save')!.props.onPress();
        });

        expect(guidanceEntriesSetter).toHaveBeenCalledWith([
            { id: 'rule-1', description: 'Existing rule', enabled: true },
            expect.objectContaining({ id: 'guidance_uuid-test', description: 'Delegate UI reviews' }),
        ]);
    });

    it('asks before dropping a typed draft rule when another rule is opened', async () => {
        executionRunsEnabledState = true;
        guidanceEnabledState = true;
        guidanceEntriesState = [{ id: 'rule-1', description: 'Existing rule', enabled: true }];
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const descriptionRowTitle = 'subAgentGuidance.ruleEditor.descriptionField.label';
        await act(async () => {
            screen.pressRowByTitle('subAgentGuidance.settings.rules.addRuleTitle');
        });
        await act(async () => {
            screen.findRowByTitle(descriptionRowTitle)!.props.rightElement.props.onChangeText('Delegate UI reviews');
        });

        // Keep editing: the draft and its text stay.
        await act(async () => {
            screen.pressRowByTitle('Existing rule');
        });
        expect(modalConfirm).toHaveBeenCalledTimes(1);
        expect(screen.findRowByTitle(descriptionRowTitle)?.props.rightElement.props.value).toBe('Delegate UI reviews');

        // Discard: the other rule opens and the draft is gone.
        modalConfirm.mockImplementation(async () => true);
        await act(async () => {
            screen.pressRowByTitle('Existing rule');
        });
        expect(screen.findRowByTitle(descriptionRowTitle)?.props.rightElement.props.value).toBe('Existing rule');
        expect(screen.findRowByTitle('subAgentGuidance.ruleEditor.header.newRule')).toBeNull();
    });

    it('edits a rule in place and deletes it from its editor', async () => {
        executionRunsEnabledState = true;
        guidanceEnabledState = true;
        guidanceEntriesState = [
            { id: 'rule-1', description: 'Keep this rule', enabled: true },
            { id: 'rule-2', description: 'Remove this rule', enabled: true },
        ];
        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        await act(async () => {
            screen.pressRowByTitle('Remove this rule');
        });
        await act(async () => {
            await screen.findByTestId('sub-agent-guidance-rule-editor.delete')!.props.onPress();
        });

        expect(guidanceEntriesSetter).toHaveBeenCalledWith([
            { id: 'rule-1', description: 'Keep this rule', enabled: true },
        ]);
    });

    it('renders configured ACP backend titles in rule subtitles', async () => {
        executionRunsEnabledState = true;
        guidanceEnabledState = true;
        guidanceMaxCharsState = 4000;
        guidanceEntriesState = [{
            id: 'rule-1',
            description: 'Use the custom backend',
            enabled: true,
            suggestedBackendTarget: { kind: 'configuredAcpBackend', backendId: 'custom-review' },
        }];

        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        const ruleItem = screen.findRowByTitle('Use the custom backend');
        expect(ruleItem).toBeTruthy();
        expect(ruleItem!.props.subtitle).toContain('subAgentGuidance.settings.rules.meta.target: Custom Review Bot');
    });

    it('keeps colliding external Agent local ids qualified when routing to their settings', async () => {
        pluginProjectionByIdState = {
            'example.agent-one': {
                editableSettingsGroups: [{
                    target: {
                        kind: 'agent',
                        agent: { pluginId: 'example.agent-one', localId: 'assistant' },
                    },
                    presentation: {
                        subagentSections: [{
                            id: 'agentOneTeams',
                            title: 'Agent One teams',
                            description: 'Manage Agent One subagent behavior.',
                            items: [{
                                id: 'agent-one-team-settings',
                                title: 'Agent One settings',
                                description: 'Open Agent One settings',
                                iconIonName: 'people-outline',
                            }],
                        }],
                    },
                }],
            },
            'example.agent-two': {
                editableSettingsGroups: [{
                    target: {
                        kind: 'agent',
                        agent: { pluginId: 'example.agent-two', localId: 'assistant' },
                    },
                    presentation: {
                        subagentSections: [{
                            id: 'agentTwoTeams',
                            title: 'Agent Two teams',
                            description: 'Manage Agent Two subagent behavior.',
                            items: [{
                                id: 'agent-two-team-settings',
                                title: 'Agent Two settings',
                                description: 'Open Agent Two settings',
                                iconIonName: 'people-outline',
                            }],
                        }],
                    },
                }],
            },
        };

        const { SubAgentSettingsView } = await import('./SubAgentSettingsView');

        const screen = await renderSettingsView(React.createElement(SubAgentSettingsView));
        expect(screen.findRowByTitle('Agent One settings')).toBeTruthy();
        expect(screen.findRowByTitle('Agent Two settings')).toBeTruthy();

        screen.pressRowByTitle('Agent One settings');
        screen.pressRowByTitle('Agent Two settings');

        expect(routerPushSpy).toHaveBeenNthCalledWith(
            1,
            '/(app)/settings/agents/assistant?pluginId=example.agent-one',
        );
        expect(routerPushSpy).toHaveBeenNthCalledWith(
            2,
            '/(app)/settings/agents/assistant?pluginId=example.agent-two',
        );
    });
});
