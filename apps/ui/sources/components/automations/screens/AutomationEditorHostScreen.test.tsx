import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { installAutomationScreensCommonModuleMocks } from './automationScreensTestHelpers';
import type { StorageState } from '@/sync/store/types';
import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AutomationStoredDefinitionExecutionRecipeV1Schema,
    AutomationTriggerDetailSchema,
    type AutomationSessionLifecycleEvent,
} from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const syncSpies = vi.hoisted(() => ({
    refreshAutomationDefinitionDetail: vi.fn(),
    saveAutomationEditorDraft: vi.fn(),
    refreshSessions: vi.fn(async () => {}),
    getCredentials: vi.fn(() => ({ token: 'token-1', secret: 'secret-1' })),
}));
const authorityState = vi.hoisted(() => ({ current: true }));
const authorityCaptures = vi.hoisted(() => ({ list: [] as Array<{ serverId: string; accountId: string }> }));
const routerSetParamsSpy = vi.hoisted(() => vi.fn());
const routerReplaceSpy = vi.hoisted(() => vi.fn());
const routerBackSpy = vi.hoisted(() => vi.fn());
const navigateWithBlurOnWebSpy = vi.hoisted(() => vi.fn((action: () => void) => action()));
const modalAlertSpy = vi.hoisted(() => vi.fn(async () => {}));
const modalConfirmSpy = vi.hoisted(() => vi.fn(async () => false));
const storageState = vi.hoisted(() => ({
    value: {} as Record<string, unknown>,
}));
const automationState = vi.hoisted(() => ({
    definition: null as any,
}));
const latestEditorProps = vi.hoisted(() => ({
    value: null as any,
}));
const latestWorkflowBodyProps = vi.hoisted(() => ({
    value: null as any,
}));
const preventRemoveState = vi.hoisted(() => ({
    enabled: false,
    handler: null as null | ((event: Readonly<{ data: Readonly<{ action: unknown }> }>) => void),
}));

vi.mock('@react-navigation/native', () => ({
    usePreventRemove: (
        enabled: boolean,
        handler: (event: Readonly<{ data: Readonly<{ action: unknown }> }>) => void,
    ) => {
        preventRemoveState.enabled = enabled;
        preventRemoveState.handler = handler;
    },
}));

vi.mock('@/components/automations/editor/AutomationPluralEditorScreen', () => ({
    AutomationPluralEditorScreen: (props: any) => {
        latestEditorProps.value = props;
        // The stand-in keeps the two document slots the real composition
        // renders, so host content placed there stays observable.
        return React.createElement(
            'AutomationPluralEditorScreen',
            props,
            props.leading ?? null,
            props.recipeEditor ?? null,
        );
    },
}));
vi.mock('@/components/workflows/screens/WorkflowEditorBody', () => ({
    WorkflowEditorBody: (props: any) => {
        latestWorkflowBodyProps.value = props;
        return React.createElement('WorkflowEditorBody', { testID: props.testIDPrefix });
    },
}));
vi.mock('@/components/automations/editor/PluginEventAutomationEditor', () => ({
    PluginEventAutomationEditor: (props: any) => React.createElement('PluginEventAutomationEditor', props),
}));
vi.mock('@/sync/sync', () => ({
    sync: syncSpies,
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: vi.fn(async () => ({ mode: 'plain', updatedAt: 1 })),
    subscribeAccountEncryptionModeCacheInvalidation: () => () => {},
}));
vi.mock('@/sync/api/automations/apiAutomations', () => ({
    isAutomationApiErrorCode: (error: unknown, code: string) => (
        typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
    ),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeLifetime: () => {
        const scope = (storageState.value as {
            profileScope?: { serverId: string; accountId: string };
        }).profileScope;
        if (!scope) return null;
        return {
            scope,
            isCurrent: () => {
                const current = (storageState.value as {
                    profileScope?: { serverId: string; accountId: string };
                }).profileScope;
                return current?.serverId === scope.serverId && current?.accountId === scope.accountId;
            },
            onRetire: () => ({ dispose: () => undefined }),
        };
    },
}));
// Lifetime-sensitive authority mock: each capture binds the serverId+accountId
// scope live at capture time and isCurrent() re-reads the current scope, so a
// same-server Account A→B switch retires every A-era authority exactly like
// the real captureSessionAutomationAuthority owner.
vi.mock('@/sync/domains/automations/sessionAutomationAuthority', () => ({
    captureSessionAutomationAuthority: (params: {
        routeSessionId?: string | null;
        routeServerId?: string | null;
    }) => {
        const scope = (storageState.value as {
            profileScope?: { serverId: string; accountId: string };
        }).profileScope;
        if (!authorityState.current || !scope) return null;
        const captured = { serverId: scope.serverId, accountId: scope.accountId };
        authorityCaptures.list.push(captured);
        return {
            sessionId: params?.routeSessionId ?? null,
            serverId: captured.serverId,
            accountLifetime: { onRetire: () => ({ dispose: () => undefined }) },
            isCurrent: () => {
                if (!authorityState.current) return false;
                const current = (storageState.value as {
                    profileScope?: { serverId: string; accountId: string };
                }).profileScope;
                return !!current
                    && current.serverId === captured.serverId
                    && current.accountId === captured.accountId;
            },
        };
    },
}));
vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>(),
    getActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));
vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: true }),
}));
// The canonical server feature-decision seam. Automations stays enabled here so
// the supported automations-enabled / workflows-unavailable configuration is the
// one under test.
const featureDecisions = vi.hoisted(() => ({
    workflows: { state: 'enabled' } as Record<string, unknown> | null,
}));
vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => (
        featureId === 'workflows' ? featureDecisions.workflows : { state: 'enabled' }
    ),
}));
vi.mock('@/utils/platform/deferOnWeb', () => ({
    navigateWithBlurOnWeb: navigateWithBlurOnWebSpy,
}));

installAutomationScreensCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { back: routerBackSpy, replace: routerReplaceSpy, setParams: routerSetParamsSpy },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: modalAlertSpy,
                confirm: modalConfirmSpy,
                prompt: vi.fn(),
            },
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useAutomation: () => automationState.definition,
            useSessions: () => Object.values(
                (storageState.value as { sessions?: Record<string, unknown> }).sessions ?? {},
            ),
            useActiveServerAccountScope: () => (
                (storageState.value as { profileScope?: unknown }).profileScope ?? null
            ),
            storage: Object.assign(
                ((selector?: (value: StorageState) => unknown) => (
                    typeof selector === 'function'
                        ? selector(storageState.value as unknown as StorageState)
                        : (storageState.value as unknown as StorageState)
                )),
                {
                    getState: () => storageState.value as unknown as StorageState,
                    getInitialState: () => storageState.value as unknown as StorageState,
                    setState: () => undefined,
                    subscribe: () => () => undefined,
                    destroy: () => undefined,
                },
            ),
        });
    },
});

const timestamp = 1_786_257_600_000;

const recipe = AutomationStoredDefinitionExecutionRecipeV1Schema.parse({
    v: 1,
    templateVersion: 4,
    template: { t: 'plain', v: { v: 1, prompt: 'Ship notes' } },
    triggerEvidence: null,
    target: { kind: 'existingSession', sessionId: 'session-target' },
});

function detailTriggers() {
    return {
        schedule: AutomationTriggerDetailSchema.parse({
            id: 'trigger-schedule-1',
            revision: 2,
            enabled: true,
            createdAt: timestamp,
            updatedAt: timestamp,
            kind: 'schedule' as const,
            schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 3_600_000, timezone: null },
            nextRunAt: null,
            triggerDefinitionEnvelope: null,
        }),
        lifecycle: AutomationTriggerDetailSchema.parse({
            id: 'trigger-turn-1',
            revision: 1,
            enabled: true,
            createdAt: timestamp,
            updatedAt: timestamp,
            kind: 'sessionLifecycle' as const,
            sourceSessionId: 'source-session-b',
            events: ['parentTurnCompleted'] as const,
            policy: { kind: 'currentTurn' as const, sourceTurnId: 'turn-old' },
            remainingOccurrences: 1,
            status: { state: 'waiting' as const, runId: null },
            triggerDefinitionEnvelope: null,
        }),
    };
}

function definitionDetailValue() {
    const triggers = detailTriggers();
    return {
        id: 'automation-1',
        name: 'Ship notes',
        description: null,
        enabled: true,
        targetType: 'existingSession' as const,
        existingSessionId: 'session-target',
        templateVersion: 4,
        lastRunAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        assignments: [{ machineId: 'machine-1', enabled: true, priority: 0, updatedAt: timestamp }],
        triggers: [triggers.schedule, triggers.lifecycle],
        executionRecipe: recipe,
    };
}

function seedStoreDefinition() {
    const value = definitionDetailValue();
    automationState.definition = {
        ...value,
        triggers: value.triggers.map(({ triggerDefinitionEnvelope: _envelope, ...summary }) => summary),
        detail: { kind: 'available' as const, templateVersion: 4, value },
        linkedExistingSessionId: 'session-target',
    };
    syncSpies.refreshAutomationDefinitionDetail.mockResolvedValue(
        automationState.definition,
    );
}

function sessionFixture(input: {
    id: string;
    latestTurnId: string;
    latestTurnStatus: 'in_progress' | 'completed';
}) {
    return {
        id: input.id,
        serverId: 'server-1',
        latestTurnId: input.latestTurnId,
        latestTurnStatus: input.latestTurnStatus,
        name: input.id,
        metadata: {
            flavor: 'claude',
            claudeSessionId: `claude-${input.id}`,
            claudeTranscriptPath: `/tmp/${input.id}.jsonl`,
        },
    };
}

function seedStorageSessions() {
    storageState.value = {
        profileScope: { serverId: 'server-1', accountId: 'account-1' },
        sessions: {
            'session-target': sessionFixture({
                id: 'session-target',
                latestTurnId: 'turn-target',
                latestTurnStatus: 'completed',
            }),
            'session-other': sessionFixture({
                id: 'session-other',
                latestTurnId: 'turn-other',
                latestTurnStatus: 'completed',
            }),
            'source-session': sessionFixture({
                id: 'source-session',
                latestTurnId: 'turn-7',
                latestTurnStatus: 'in_progress',
            }),
            'source-session-b': sessionFixture({
                id: 'source-session-b',
                latestTurnId: 'turn-old',
                latestTurnStatus: 'completed',
            }),
            'hidden-history': {
                ...sessionFixture({
                    id: 'hidden-history',
                    latestTurnId: 'turn-hidden',
                    latestTurnStatus: 'in_progress',
                }),
                metadata: {
                    ...sessionFixture({
                        id: 'hidden-history',
                        latestTurnId: 'turn-hidden',
                        latestTurnStatus: 'in_progress',
                    }).metadata,
                    systemSessionV1: { v: 1, key: 'voice_transcript_history', hidden: true },
                },
            },
        },
    };
}

async function flushRender(): Promise<void> {
    await flushHookEffects({ cycles: 3, turns: 3 });
}

async function mountHost(props: {
    automationId?: string;
    exactTurnPrefill?: {
        sourceSessionId: string;
        sourceTurnId: string;
        sourceServerId: string;
        events: readonly AutomationSessionLifecycleEvent[];
    } | null;
}) {
    const { AutomationEditorHostScreen } = await import('./AutomationEditorHostScreen');
    return await renderScreen(
        <AutomationEditorHostScreen
            automationId={props.automationId ?? 'automation-1'}
            exactTurnPrefill={props.exactTurnPrefill ?? null}
        />,
    );
}

describe('AutomationEditorHostScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        featureDecisions.workflows = { state: 'enabled' };
        authorityState.current = true;
        authorityCaptures.list.length = 0;
        preventRemoveState.enabled = false;
        preventRemoveState.handler = null;
        latestEditorProps.value = null;
        latestWorkflowBodyProps.value = null;
        seedStoreDefinition();
        seedStorageSessions();
    });

    it('settles missing and private-unavailable edit hydration without an indefinite spinner', async () => {
        syncSpies.refreshAutomationDefinitionDetail.mockResolvedValueOnce(null);
        const missingScreen = await mountHost({});
        await flushRender();
        expect(missingScreen.findByProps({ testID: 'automation-editor-not-found' })).toBeDefined();
        expect(missingScreen.findAllByType('ActivitySpinner' as never)).toHaveLength(0);
        await missingScreen.unmount();

        const summary = automationState.definition;
        const unavailable = {
            ...summary,
            detail: {
                kind: 'unavailable' as const,
                templateVersion: summary.templateVersion,
                code: 'automation_stored_content_unavailable' as const,
            },
        };
        automationState.definition = unavailable;
        syncSpies.refreshAutomationDefinitionDetail.mockResolvedValueOnce(unavailable);
        const unavailableScreen = await mountHost({});
        await flushRender();

        expect(unavailableScreen.findByProps({ title: unavailable.name })).toBeDefined();
        expect(unavailableScreen.findByProps({ testID: 'automation-editor-private-unavailable' })).toBeDefined();
        expect(unavailableScreen.findAllByType('ActivitySpinner' as never)).toHaveLength(0);
    });

    it('renders a retryable failed edit hydration state while keeping public facts visible', async () => {
        syncSpies.refreshAutomationDefinitionDetail.mockRejectedValueOnce(new Error('offline'));
        const screen = await mountHost({});
        await flushRender();

        expect(screen.findByProps({ testID: 'automation-editor-public-facts' })).toBeDefined();
        const failed = screen.findByProps({ testID: 'automation-editor-load-failed' });
        expect(failed.props.accessibilitySemantics).toBe('alert');
        await act(async () => failed.props.action.onPress());
        await flushRender();
        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(2);
    });

    it('seeds the exact observed prefill as one new row and saves through the one canonical writer', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        const screen = await mountHost({
            exactTurnPrefill: { sourceSessionId: 'source-session', sourceTurnId: 'turn-7', sourceServerId: 'server-1', events: ['parentTurnCompleted'] },
        });
        await flushRender();

        const editor = latestEditorProps.value;
        expect(editor).not.toBeNull();
        expect(editor.variant).toBe('edit');
        const triggers = editor.value.triggers;
        expect(triggers).toHaveLength(3);
        expect(triggers[0]).toMatchObject({ persisted: { id: 'trigger-schedule-1', revision: 2 } });
        expect(triggers[1]).toMatchObject({ persisted: { id: 'trigger-turn-1', revision: 1 } });
        expect(triggers[2]).toMatchObject({
            persisted: null,
            definition: {
                kind: 'sessionLifecycle',
                sourceSessionId: 'source-session',
                events: ['parentTurnCompleted'],
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            },
        });

        await act(async () => editor.onSubmit());
        await flushRender();

        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        const [savedDraft, saveOptions] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.triggers[2]).toMatchObject({
            persisted: null,
            definition: {
                sourceSessionId: 'source-session',
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            },
        });
        expect(typeof saveOptions.isCurrent).toBe('function');
        expect(routerReplaceSpy).toHaveBeenCalledWith('/automations/automation-1');
        expect(modalAlertSpy).not.toHaveBeenCalled();
        expect(screen).toBeDefined();
    });

    it('treats a route-prefilled Event as visible unsaved intent for Cancel and native beforeRemove', async () => {
        await mountHost({
            exactTurnPrefill: {
                sourceSessionId: 'source-session',
                sourceTurnId: 'turn-7',
                sourceServerId: 'server-1',
                events: ['parentTurnFailed'],
            },
        });
        await flushRender();

        expect(latestEditorProps.value.value.triggers.at(-1)).toMatchObject({
            persisted: null,
            definition: { events: ['parentTurnFailed'] },
        });
        expect(preventRemoveState.enabled).toBe(true);

        await act(async () => latestEditorProps.value.onCancel());
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);
        const cancelButtons = (modalAlertSpy.mock.calls[0] as unknown as [string, string, Array<{ onPress?: () => void }>])[2];
        await act(async () => cancelButtons[2]?.onPress?.());

        await act(async () => preventRemoveState.handler?.({ data: { action: { type: 'GO_BACK' } } }));
        expect(modalAlertSpy).toHaveBeenCalledTimes(2);
        expect(routerBackSpy).not.toHaveBeenCalled();
    });

    it('merges a second prefill Event into the existing same-turn trigger row without duplicating it', async () => {
        // A persisted currentTurn trigger already matches the prefill Session
        // and exact turn with one selected Event; the prefill arrives with a
        // second Event for the same turn.
        const value = definitionDetailValue();
        const triggers = value.triggers.map((trigger) => (
            trigger.kind === 'sessionLifecycle'
                ? {
                    ...trigger,
                    sourceSessionId: 'source-session',
                    policy: { kind: 'currentTurn' as const, sourceTurnId: 'turn-7' },
                }
                : trigger
        ));
        const detailValue = { ...value, triggers };
        automationState.definition = {
            ...detailValue,
            triggers: triggers.map(({ triggerDefinitionEnvelope: _envelope, ...summary }) => summary),
            detail: { kind: 'available' as const, templateVersion: 4, value: detailValue },
            linkedExistingSessionId: 'session-target',
        };
        syncSpies.refreshAutomationDefinitionDetail.mockResolvedValue(automationState.definition);

        await mountHost({
            exactTurnPrefill: {
                sourceSessionId: 'source-session',
                sourceTurnId: 'turn-7',
                sourceServerId: 'server-1',
                events: ['parentTurnCompleted', 'parentTurnFailed'],
            },
        });
        await flushRender();

        const editor = latestEditorProps.value;
        expect(editor).not.toBeNull();
        const draftTriggers = editor.value.triggers;
        // Exactly one lifecycle row for the prefill Session: the prefill
        // Events merge into the stable persisted row instead of appending an
        // overlapping duplicate currentTurn trigger or dropping an Event.
        const lifecycleRows = draftTriggers.filter((trigger: any) => (
            trigger.definition?.kind === 'sessionLifecycle'
        ));
        expect(lifecycleRows).toHaveLength(1);
        expect(lifecycleRows[0]).toMatchObject({
            persisted: { id: 'trigger-turn-1', revision: 1 },
            definition: {
                kind: 'sessionLifecycle',
                sourceSessionId: 'source-session',
                events: ['parentTurnCompleted', 'parentTurnFailed'],
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            },
        });
        // The changed persisted row is marked for reconciliation so the merge
        // is actually saved instead of silently remaining local.
        expect(lifecycleRows[0]!.isDirty).toBe(true);
        expect(preventRemoveState.enabled).toBe(true);
    });

    it('keeps the draft unchanged when the prefill Events are already fully selected', async () => {
        const value = definitionDetailValue();
        const triggers = value.triggers.map((trigger) => (
            trigger.kind === 'sessionLifecycle'
                ? {
                    ...trigger,
                    sourceSessionId: 'source-session',
                    events: ['parentTurnCompleted', 'parentTurnFailed'] as const,
                    policy: { kind: 'currentTurn' as const, sourceTurnId: 'turn-7' },
                }
                : trigger
        ));
        const detailValue = { ...value, triggers };
        automationState.definition = {
            ...detailValue,
            triggers: triggers.map(({ triggerDefinitionEnvelope: _envelope, ...summary }) => summary),
            detail: { kind: 'available' as const, templateVersion: 4, value: detailValue },
            linkedExistingSessionId: 'session-target',
        };
        syncSpies.refreshAutomationDefinitionDetail.mockResolvedValue(automationState.definition);

        await mountHost({
            exactTurnPrefill: {
                sourceSessionId: 'source-session',
                sourceTurnId: 'turn-7',
                sourceServerId: 'server-1',
                events: ['parentTurnCompleted', 'parentTurnFailed'],
            },
        });
        await flushRender();

        const lifecycleRow = latestEditorProps.value!.value.triggers.find(
            (trigger: any) => trigger.definition?.kind === 'sessionLifecycle',
        );
        expect(lifecycleRow).toMatchObject({
            definition: { events: ['parentTurnCompleted', 'parentTurnFailed'] },
        });
        expect(lifecycleRow?.isDirty).toBeUndefined();
        expect(preventRemoveState.enabled).toBe(false);
    });

    it('keeps a hydrated editor draft until the user explicitly discards it before canceling', async () => {
        await mountHost({});
        await flushRender();

        const editor = latestEditorProps.value;
        await act(async () => editor.onChange({
            ...editor.value,
            name: 'Unsaved automation name',
        }));

        await act(async () => latestEditorProps.value.onCancel());
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(modalAlertSpy).toHaveBeenCalledTimes(1);

        const buttons = (modalAlertSpy.mock.calls[0] as unknown as [string, string, Array<{ onPress?: () => void }>])[2];
        await act(async () => buttons[0]?.onPress?.());
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    it('retires the mounted server-bound draft when the active account scope changes', async () => {
        const screen = await mountHost({});
        await flushRender();
        expect(latestEditorProps.value).not.toBeNull();
        const firstScopeDraft = latestEditorProps.value.value;

        storageState.value = {
            ...(storageState.value as Record<string, unknown>),
            profileScope: { serverId: 'server-1', accountId: 'account-2' },
        };
        const { AutomationEditorHostScreen } = await import('./AutomationEditorHostScreen');
        await screen.update(
            <AutomationEditorHostScreen automationId="automation-1" exactTurnPrefill={null} />,
        );

        await flushRender();
        // The host rehydrates a fresh draft for the new scope through the same
        // owner; nothing from the retired draft is reused.
        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(2);
        expect(latestEditorProps.value.value).not.toBe(firstScopeDraft);
        expect(latestEditorProps.value.value.automationId).toBe('automation-1');
    });

    it('keeps the mounted exact-turn draft alive when the source session updates but the exact turn is unchanged', async () => {
        const screen = await mountHost({
            exactTurnPrefill: { sourceSessionId: 'source-session', sourceTurnId: 'turn-7', sourceServerId: 'server-1', events: ['parentTurnCompleted'] },
        });
        await flushRender();

        const mounted = latestEditorProps.value;
        expect(mounted).not.toBeNull();
        await act(async () => mounted.onChange({
            ...mounted.value,
            name: 'Local edit before live update',
        }));
        const editedDraft = latestEditorProps.value.value;
        expect(editedDraft.name).toBe('Local edit before live update');

        // A live transcript update replaces the Session object while the exact
        // turn is unchanged, and the route re-renders with a semantically equal
        // prefill object. Neither is an authority change, so the mounted draft
        // must survive without rehydration.
        storageState.value = {
            ...(storageState.value as Record<string, unknown>),
            sessions: {
                ...((storageState.value as { sessions?: Record<string, unknown> }).sessions ?? {}),
                'source-session': sessionFixture({
                    id: 'source-session',
                    latestTurnId: 'turn-7',
                    latestTurnStatus: 'in_progress',
                }),
            },
        };
        const { AutomationEditorHostScreen } = await import('./AutomationEditorHostScreen');
        await screen.update(
            <AutomationEditorHostScreen
                automationId="automation-1"
                exactTurnPrefill={{ sourceSessionId: 'source-session', sourceTurnId: 'turn-7', sourceServerId: 'server-1', events: ['parentTurnCompleted'] }}
            />,
        );
        await flushRender();

        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(1);
        expect(latestEditorProps.value.value).toBe(editedDraft);
        expect(latestEditorProps.value.value.name).toBe('Local edit before live update');
    });

    it('saves an unrelated edit while a clean terminal lifecycle row is present', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        await mountHost({});
        await flushRender();

        const editor = latestEditorProps.value;
        const lifecycleRow = editor.value.triggers[1];
        expect(lifecycleRow.persisted).toEqual({ id: 'trigger-turn-1', revision: 1 });
        expect(lifecycleRow.isDirty).toBeUndefined();
        // The row's source turn is terminal in storage; a clean row is not
        // revalidated locally and must not block an unrelated metadata edit.
        await act(async () => editor.onChange({
            ...editor.value,
            name: 'Renamed without touching triggers',
        }));
        await act(async () => editor.onSubmit());
        await flushRender();

        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.name).toBe('Renamed without touching triggers');
        expect(savedDraft.triggers[1]?.isDirty).toBeUndefined();
        expect(modalAlertSpy).not.toHaveBeenCalled();
    });

    it('allows disabling a historical lifecycle row without retargeting its completed source turn', async () => {
        await mountHost({});
        await flushRender();

        const editor = latestEditorProps.value;
        const lifecycleRow = editor.value.triggers[1];
        await act(async () => editor.onChange({
            ...editor.value,
            triggers: editor.value.triggers.map((candidate: any) => (
                candidate.clientId === lifecycleRow.clientId
                ? { ...candidate, isDirty: true, definition: { ...candidate.definition, enabled: false } }
                : candidate
            )),
        }));
        await act(async () => editor.onSubmit());
        await flushRender();

        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        expect(syncSpies.refreshSessions).not.toHaveBeenCalled();
        expect(modalAlertSpy).not.toHaveBeenCalled();
    });

    it('presents the existing-session target as non-selectable so the source always differs', async () => {
        await mountHost({});
        await flushRender();

        const editor = latestEditorProps.value;
        expect(editor.value.executionRecipe.target).toEqual({
            kind: 'existingSession',
            sessionId: 'session-target',
        });
        const selectableById = new Map(
            editor.sessionOptions.map((option: any) => [option.sessionId, option.selectable]),
        );
        expect(selectableById.get('session-target')).toBe(false);
        expect(selectableById.get('session-other')).toBe(true);
        expect(selectableById.get('source-session')).toBe(true);
        expect(selectableById.has('hidden-history')).toBe(false);
    });

    it('rebinds the exact-turn authority under the new Account after a same-server Account change', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        const screen = await mountHost({
            exactTurnPrefill: { sourceSessionId: 'source-session', sourceTurnId: 'turn-7', sourceServerId: 'server-1', events: ['parentTurnCompleted'] },
        });
        await flushRender();

        // Authorized under Account A: the observed prefill row is mounted.
        const draftUnderA = latestEditorProps.value.value;
        expect(draftUnderA.triggers.at(-1)).toMatchObject({
            persisted: null,
            definition: {
                sourceSessionId: 'source-session',
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            },
        });
        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(1);

        // Same server, Account B mounts: the A-era binding retires, B
        // rehydrates exactly once, and the prefill re-authorizes under B.
        storageState.value = {
            ...(storageState.value as Record<string, unknown>),
            profileScope: { serverId: 'server-1', accountId: 'account-2' },
        };
        const { AutomationEditorHostScreen } = await import('./AutomationEditorHostScreen');
        await screen.update(
            <AutomationEditorHostScreen
                automationId="automation-1"
                exactTurnPrefill={{ sourceSessionId: 'source-session', sourceTurnId: 'turn-7', sourceServerId: 'server-1', events: ['parentTurnCompleted'] }}
            />,
        );
        await flushRender();
        await flushRender();

        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(2);
        expect(latestEditorProps.value.value).not.toBe(draftUnderA);
        expect(latestEditorProps.value.value.triggers.at(-1)).toMatchObject({
            persisted: null,
            definition: {
                sourceSessionId: 'source-session',
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            },
        });
        expect(authorityCaptures.list.at(-1)).toMatchObject({ serverId: 'server-1', accountId: 'account-2' });

        // The mounted draft saves under B's authority; a retired A authority
        // can never authorize this request.
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();
        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        expect(modalAlertSpy).not.toHaveBeenCalled();
    });

    it('leaves the page scroll and pinned Save to the shared editor instead of nesting its own', async () => {
        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance/KeyboardAwareScrollView');
        const screen = await mountHost({});
        await flushRender();

        // The shared editor owns the one keyboard-aware page scroll with Save
        // pinned above the document; a host scroll around it would nest two
        // owners and push Save back below the fold. (The editor is a stand-in
        // here, so any scroll owner found is the host's.)
        expect(screen.findAllByType(KeyboardAwareScrollView as never)).toHaveLength(0);
        expect(latestEditorProps.value.onSubmit).toBeTypeOf('function');
        expect(latestEditorProps.value.onCancel).toBeTypeOf('function');
    });

    it('advances only the exact-turn row when explicitly adopting the current turn after staleness', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        const screen = await mountHost({
            exactTurnPrefill: {
                sourceSessionId: 'source-session',
                sourceTurnId: 'turn-7',
                sourceServerId: 'server-1',
                // A non-default selection: adopting the current turn may only
                // move the stale source identity, never re-decide which
                // lifecycle Events the author selected.
                events: ['parentTurnFailed', 'userActionRequired'],
            },
        });
        await flushRender();

        // Unsaved work unrelated to the exact-turn row: name, prompt, and a
        // second trigger row's enablement.
        const mounted = latestEditorProps.value;
        await act(async () => mounted.onChange({
            ...mounted.value,
            name: 'Renamed before staleness',
            executionRecipe: {
                ...mounted.value.executionRecipe,
                template: { t: 'plain', v: { v: 1, prompt: 'Revised prompt before staleness' } },
            },
            triggers: mounted.value.triggers.map((trigger: any, index: number) => (
                index === 0 ? { ...trigger, definition: { ...trigger.definition, enabled: false } } : trigger
            )),
        }));

        // The observed turn completes and a new turn starts: the binding is stale.
        storageState.value = {
            ...(storageState.value as Record<string, unknown>),
            sessions: {
                ...((storageState.value as { sessions?: Record<string, unknown> }).sessions ?? {}),
                'source-session': sessionFixture({
                    id: 'source-session',
                    latestTurnId: 'turn-8',
                    latestTurnStatus: 'in_progress',
                }),
            },
        };
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();

        // The stale save is refused locally and typed stale truth is offered.
        expect(syncSpies.saveAutomationEditorDraft).not.toHaveBeenCalled();
        const staleCard = screen.findByProps({ testID: 'automation-edit-exact-turn-stale' });
        expect(staleCard.props.action.label).toBe('automations.exactTurn.useCurrentTurn');

        await act(async () => staleCard.props.action.onPress());
        await flushRender();

        // The mounted draft was NOT rehydrated: only the exact-turn row moved,
        // and adopting never leaves two overlapping current-turn rows.
        expect(syncSpies.refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(1);
        const draft = latestEditorProps.value.value;
        expect(draft.triggers).toHaveLength(3);
        expect(draft.name).toBe('Renamed before staleness');
        expect(draft.executionRecipe.template).toEqual({ t: 'plain', v: { v: 1, prompt: 'Revised prompt before staleness' } });
        expect(draft.triggers[0]).toMatchObject({ definition: { enabled: false } });
        expect(draft.triggers[1]).toMatchObject({ persisted: { id: 'trigger-turn-1', revision: 1 } });
        expect(draft.triggers.at(-1)).toMatchObject({
            persisted: null,
            definition: {
                sourceSessionId: 'source-session',
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-8' },
            },
        });
        // Recovery moves the stale turn identity only: the selected lifecycle
        // Events survive untouched instead of collapsing to the default one.
        expect(draft.triggers.at(-1)?.definition?.events)
            .toEqual(['parentTurnFailed', 'userActionRequired']);
        // Route params stay URL truth for the adopted turn.
        expect(routerSetParamsSpy).toHaveBeenCalledWith({
            sourceSessionId: 'source-session',
            sourceTurnId: 'turn-8',
            sourceServerId: 'server-1',
            sessionLifecycleEvents: 'parentTurnFailed,userActionRequired',
        });
        expect(screen.findAllByProps({ testID: 'automation-edit-exact-turn-stale' })).toHaveLength(0);

        // The adopted binding authorizes the save with every edit intact.
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();
        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.name).toBe('Renamed before staleness');
        expect(savedDraft.triggers.at(-1)?.definition?.policy).toMatchObject({ sourceTurnId: 'turn-8' });
    });
});

describe('AutomationEditorHostScreen shared Workflow editor body', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        featureDecisions.workflows = { state: 'enabled' };
        authorityState.current = true;
        authorityCaptures.list.length = 0;
        latestEditorProps.value = null;
        latestWorkflowBodyProps.value = null;
        seedStoreDefinition();
        seedStorageSessions();
    });

    function seedWorkflowRecipeDefinition() {
        const value = definitionDetailValue();
        const workflowRecipe = {
            v: 2 as const,
            templateVersion: 4,
            workflow: {
                t: 'plain' as const,
                v: {
                    definition: {
                        version: 1 as const,
                        inputs: [],
                        defaults: {
                            agentTarget: {
                                kind: 'agent' as const,
                                identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
                            },
                        },
                        blocks: [{
                            kind: 'step' as const,
                            id: 'analyze',
                            document: { text: 'Analyze the release', references: [], attachments: [] },
                            input: [],
                            result: { kind: 'text' as const },
                        }],
                    },
                    project: { machineId: 'machine-1', directory: '/repo' },
                },
            },
            triggerEvidence: null,
        };
        const detail = { ...value, targetType: null, executionRecipe: workflowRecipe };
        automationState.definition = {
            ...detail,
            triggers: detail.triggers.map(({ triggerDefinitionEnvelope: _envelope, ...summary }) => summary),
            detail: { kind: 'available' as const, templateVersion: 4, value: detail },
        };
        syncSpies.refreshAutomationDefinitionDetail.mockResolvedValue(automationState.definition);
    }

    function editWorkflowPrompt(text: string) {
        const body = latestWorkflowBodyProps.value;
        const step = body.draft.blocks[0];
        body.onChange({
            ...body.draft,
            blocks: [{ ...step, document: { ...step.document, text } }],
        });
    }

    it('opens a saved one-shot Automation in the shared Workflow definition editor', async () => {
        const screen = await mountHost({});
        await flushRender();

        expect(latestEditorProps.value.recipeEditor).toBeTruthy();
        const body = latestWorkflowBodyProps.value;
        expect(body).not.toBeNull();
        // The stored one-shot program is adapted into the canonical one-step
        // definition, so the prompt is editable in the same editor a workflow
        // Automation uses.
        expect(body.draft.blocks).toHaveLength(1);
        expect(body.draft.blocks[0].document.text).toBe('Ship notes');
        expect(body.draft.defaults.conversation).toEqual({
            kind: 'existing_session',
            sessionId: 'session-target',
            machineId: 'machine-1',
        });
        // The wrapper keeps one primary Save; the body offers no rival commit.
        expect(body.onSave).toBeUndefined();
        expect(body.onRunNow).toBeUndefined();
        expect(screen).toBeDefined();
    });

    it('saves an edited prompt back through the released one-shot recipe', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        await mountHost({});
        await flushRender();

        await act(async () => editWorkflowPrompt('Ship notes and highlight risks'));
        await flushRender();
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();

        expect(modalAlertSpy).not.toHaveBeenCalled();
        expect(syncSpies.saveAutomationEditorDraft).toHaveBeenCalledTimes(1);
        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.recipeDirty).toBe(true);
        expect(savedDraft.executionRecipe.v).toBe(1);
        expect(savedDraft.executionRecipe.templateVersion).toBe(5);
        expect(savedDraft.executionRecipe.template).toEqual({
            t: 'plain',
            v: { v: 1, prompt: 'Ship notes and highlight risks' },
        });
        // One-shot execution semantics are preserved, not converted.
        expect(savedDraft.executionRecipe.target).toEqual({
            kind: 'existingSession',
            sessionId: 'session-target',
        });
    });

    it('names an empty required one-shot prompt beside Save and clears the reason once repaired', async () => {
        await mountHost({});
        await flushRender();

        await act(async () => editWorkflowPrompt(''));
        await flushRender();

        expect(latestEditorProps.value.submitDisabled).toBe(true);
        expect(latestEditorProps.value.submitDisabledReason).toBe('workflows.issue.invalid_input');

        await act(async () => editWorkflowPrompt('Ship notes again'));
        await flushRender();

        expect(latestEditorProps.value.submitDisabled).toBe(false);
        expect(latestEditorProps.value.submitDisabledReason).toBeNull();
    });

    it('leaves the stored recipe untouched when only Automation metadata changed', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        await mountHost({});
        await flushRender();

        await act(async () => latestEditorProps.value.onChange({
            ...latestEditorProps.value.value,
            name: 'Renamed only',
        }));
        await flushRender();
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();

        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.name).toBe('Renamed only');
        expect(savedDraft.recipeDirty).not.toBe(true);
        expect(savedDraft.executionRecipe.templateVersion).toBe(4);
    });

    it('requires an explicit conversion before a grown workflow replaces the one-shot recipe', async () => {
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        const screen = await mountHost({});
        await flushRender();

        await act(async () => {
            const body = latestWorkflowBodyProps.value;
            body.onChange({
                ...body.draft,
                blocks: [...body.draft.blocks, {
                    kind: 'step',
                    id: 'step-2',
                    document: { text: 'Then publish them', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'text' },
                }],
            });
        });
        await flushRender();

        // The consequence is stated before Save, and Save cannot silently
        // convert how future occurrences execute.
        const card = screen.findByProps({ testID: 'automation-editor-workflow-conversion-required' });
        expect(latestEditorProps.value.submitDisabled).toBe(true);
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();
        expect(syncSpies.saveAutomationEditorDraft).not.toHaveBeenCalled();

        // Explicit conversion, then the one-machine workflow contract.
        await act(async () => card.props.action.onPress());
        await flushRender();
        await act(async () => {
            const body = latestWorkflowBodyProps.value;
            body.onChangeProjectTarget({ machineId: 'machine-1', directory: '/repo' });
        });
        await flushRender();
        await act(async () => {
            const body = latestWorkflowBodyProps.value;
            body.onChange({
                ...body.draft,
                defaults: {
                    ...body.draft.defaults,
                    agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
                },
            });
        });
        await flushRender();

        expect(latestEditorProps.value.submitDisabled).toBe(false);
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();

        expect(modalAlertSpy).not.toHaveBeenCalled();
        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.executionRecipe.v).toBe(2);
        expect(savedDraft.executionRecipe.workflow.v.definition.blocks).toHaveLength(2);
        expect(savedDraft.executionRecipe.workflow.v.project)
            .toEqual({ machineId: 'machine-1', directory: '/repo' });
        // One workflow runs on exactly one reviewed machine. The Automation's
        // existing assignment already names it, so its priority is preserved
        // rather than silently rewritten by the conversion.
        expect(savedDraft.assignments).toEqual([{ machineId: 'machine-1', enabled: true, priority: 0 }]);
    });

    it('opens a saved managed workflow Automation from its frozen definition', async () => {
        seedWorkflowRecipeDefinition();
        await mountHost({});
        await flushRender();

        const body = latestWorkflowBodyProps.value;
        expect(body).not.toBeNull();
        expect(body.draft.blocks[0].id).toBe('analyze');
        expect(body.draft.blocks[0].document.text).toBe('Analyze the release');
        expect(body.projectTarget).toEqual({ machineId: 'machine-1', directory: '/repo' });
    });

    it('reseals an edited managed workflow definition through the canonical workflow recipe writer', async () => {
        seedWorkflowRecipeDefinition();
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        await mountHost({});
        await flushRender();

        await act(async () => editWorkflowPrompt('Analyze the release and report risks'));
        await flushRender();
        await act(async () => latestEditorProps.value.onSubmit());
        await flushRender();

        expect(modalAlertSpy).not.toHaveBeenCalled();
        const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
        expect(savedDraft.recipeDirty).toBe(true);
        expect(savedDraft.executionRecipe.v).toBe(2);
        expect(savedDraft.executionRecipe.templateVersion).toBe(5);
        expect(savedDraft.executionRecipe.workflow.t).toBe('plain');
        expect(savedDraft.executionRecipe.workflow.v.definition.blocks[0].document.text)
            .toBe('Analyze the release and report risks');
        expect(savedDraft.executionRecipe.workflow.v.project)
            .toEqual({ machineId: 'machine-1', directory: '/repo' });
    });

    /**
     * The outer Save of a saved managed workflow Automation answers to the
     * same canonical draft validation the create wrapper and the neutral editor
     * consume. An invalid edit disables Save up front — the body names the
     * issue inline — and never reaches the recipe writer.
     */
    it('refuses to save an invalid managed workflow edit through the canonical draft validation', async () => {
        seedWorkflowRecipeDefinition();
        syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
        await mountHost({});
        await flushRender();
        expect(latestEditorProps.value.submitDisabled).toBe(false);

        await act(async () => editWorkflowPrompt(''));
        await flushRender();
        expect(latestEditorProps.value.submitDisabled).toBe(true);

        await act(async () => editWorkflowPrompt('Analyze the release again'));
        await flushRender();
        expect(latestEditorProps.value.submitDisabled).toBe(false);
        expect(syncSpies.saveAutomationEditorDraft).not.toHaveBeenCalled();
    });

    it('treats an unsaved workflow edit as dirty for Cancel and native beforeRemove', async () => {
        await mountHost({});
        await flushRender();

        expect(preventRemoveState.enabled).toBe(false);
        await act(async () => editWorkflowPrompt('Ship notes, carefully'));
        await flushRender();
        expect(preventRemoveState.enabled).toBe(true);
    });

    describe('under an unavailable canonical Workflows decision', () => {
        const unavailableDecisions = [
            ['disabled', { state: 'disabled', blockedBy: 'server' }],
            ['unknown', { state: 'unknown' }],
            ['unresolved', null],
        ] as const;

        async function growBeyondOneShot() {
            await act(async () => {
                const body = latestWorkflowBodyProps.value;
                body.onChange({
                    ...body.draft,
                    blocks: [...body.draft.blocks, {
                        kind: 'step',
                        id: 'step-2',
                        document: { text: 'Then publish them', references: [], attachments: [] },
                        input: [],
                        result: { kind: 'text' },
                    }],
                });
            });
            await flushRender();
        }

        it.each(unavailableDecisions)(
            'keeps a saved one-shot Automation editable and saveable while the decision is %s',
            async (_label, decision) => {
                featureDecisions.workflows = decision as Record<string, unknown> | null;
                syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
                await mountHost({});
                await flushRender();

                await act(async () => editWorkflowPrompt('Ship notes and highlight risks'));
                await flushRender();
                await act(async () => latestEditorProps.value.onSubmit());
                await flushRender();

                const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
                expect(savedDraft.executionRecipe.v).toBe(1);
            },
        );

        it.each(unavailableDecisions)(
            'offers no conversion and refuses the v2 write while the decision is %s',
            async (_label, decision) => {
                featureDecisions.workflows = decision as Record<string, unknown> | null;
                syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
                const screen = await mountHost({});
                await flushRender();

                await growBeyondOneShot();

                // The reason is stated, but the conversion offer is not: adopting
                // the workflow contract is exactly what the canonical decision
                // does not authorize here.
                expect(screen.findByTestId('automation-editor-workflows-unavailable')).not.toBeNull();
                expect(screen.findAllByTestId('automation-editor-workflow-conversion-required')).toHaveLength(0);
                expect(latestEditorProps.value.submitDisabled).toBe(true);

                await act(async () => latestEditorProps.value.onSubmit());
                await flushRender();
                expect(syncSpies.saveAutomationEditorDraft).not.toHaveBeenCalled();
            },
        );

        it.each(unavailableDecisions)(
            'opens a saved managed workflow Automation read-only while the decision is %s',
            async (_label, decision) => {
                seedWorkflowRecipeDefinition();
                featureDecisions.workflows = decision as Record<string, unknown> | null;
                syncSpies.saveAutomationEditorDraft.mockResolvedValue({ id: 'automation-1' });
                const screen = await mountHost({});
                await flushRender();

                // The stored v2 definition stays exactly as saved: it is neither
                // editable here nor rewritten into a one-shot recipe.
                expect(screen.findByTestId('automation-editor-workflow-recipe-unavailable')).not.toBeNull();
                expect(latestWorkflowBodyProps.value).toBeNull();

                // Ordinary Automation metadata remains editable and saveable; the
                // untouched v2 recipe travels through unchanged.
                await act(async () => latestEditorProps.value.onChange({
                    ...latestEditorProps.value.value,
                    name: 'Renamed only',
                }));
                await flushRender();
                await act(async () => latestEditorProps.value.onSubmit());
                await flushRender();

                const [savedDraft] = syncSpies.saveAutomationEditorDraft.mock.calls[0]!;
                expect(savedDraft.name).toBe('Renamed only');
                expect(savedDraft.executionRecipe.v).toBe(2);
                expect(savedDraft.executionRecipe.templateVersion).toBe(4);
                expect(savedDraft.executionRecipe.workflow.v.definition.blocks[0].document.text)
                    .toBe('Analyze the release');
            },
        );
    });
});
