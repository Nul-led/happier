import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackendTargetKeyV2 } from '@happier-dev/protocol';

import { flattenTestStyle, flushHookEffects, pressTestInstance, renderScreen, standardCleanup } from '@/dev/testkit';
import { createStorageModuleStub, createStorageStoreMock } from '@/dev/testkit/mocks/storage';
import { installSessionHooksCommonModuleMocks } from '@/hooks/session/sessionHooksTestHelpers';

type ProtocolCheckResult =
    | Readonly<{ ok: true; exactMachineId?: string }>
    | Readonly<{ ok: false; errorCode: string; error: string }>;

const actionExecuteSpy = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
const executionRunProtocolCheckSpy = vi.fn(async (..._args: unknown[]): Promise<ProtocolCheckResult> => ({
    ok: true,
    exactMachineId: 'machine-launcher',
}));
const resumeSessionSpy = vi.fn(async (..._args: unknown[]) => ({ type: 'success' as const }));
const launchOrder: string[] = [];
const emptyExecutionRunBackends = vi.hoisted(() => ({}));
const emptyResumeCapabilityOptions = vi.hoisted(() => [] as const);
const idleMachineCapabilitiesState = vi.hoisted(() => ({ status: 'idle' as const }));
const machineTargetMock = vi.hoisted(() => ({ machineId: 'machine-launcher', basePath: '/workspace' }));
const daemonMergedProjectionMock = vi.hoisted(() => ({ inputs: null }));
const createDefaultActionExecutorSpy = vi.fn((..._args: unknown[]) => ({
    execute: (...args: unknown[]) => {
        launchOrder.push('action');
        return actionExecuteSpy(...args);
    },
}));
const useResumeCapabilityOptionsSpy = vi.fn((..._args: unknown[]) => ({ resumeCapabilityOptions: emptyResumeCapabilityOptions }));
const useMachineCapabilitiesCacheSpy = vi.fn((..._args: unknown[]) => ({ state: idleMachineCapabilitiesState }));
const useHydrateSessionForRouteSpy = vi.fn((sessionId: string) => ({ kind: 'available', sessionId }));
const useSessionExecutionRunLaunchabilitySpy = vi.fn();
const modelPickerPropsSpy = vi.fn();
const modalConfirmSpy = vi.fn(async (..._args: unknown[]) => true);
const teamCredentialCatalogArgsSpy = vi.fn();
const secretOverlayFieldPropsSpy = vi.fn();
const featureState = vi.hoisted(() => ({ credentialResources: true }));
const enabledAgentIdsMock = vi.hoisted(() => [] as string[]);
const credentialScopeBindingsTestState = vi.hoisted(() => ({
    byKey: new Map<string, ReadonlyMap<string, Readonly<{
        serverId: string;
        accountId: string;
        scope: Readonly<{ serverId: string; accountId: string }>;
        isCurrent: () => boolean;
    }>>>(),
}));
const launcherCatalogTestState = vi.hoisted(() => ({
    backendChoices: [] as Array<Record<string, unknown>>,
    catalog: {
        resources: [] as Array<Record<string, unknown>>,
        teamNameById: {} as Record<string, string>,
        homeNameByTeamId: {} as Record<string, string>,
        currentResourceKeys: new Set<string>(),
        current: true,
    },
}));
const accountSettingsTestState = vi.hoisted(() => ({
    activeScope: { serverId: 'server-launcher', accountId: 'account-1' } as { serverId: string; accountId: string } | null,
    activeSettings: {
        analyticsOptOut: false,
        executionRunsGuidanceEnabled: false,
        executionRunsGuidanceMaxChars: 0,
        executionRunsGuidanceEntries: [],
        acpCatalogSettingsV1: { v: 2, backends: [] },
    },
    persistedSettings: { analyticsOptOut: true, acpCatalogSettingsV1: { v: 2, backends: [] } },
}));
const launchabilityState = vi.hoisted(() => {
    let sessionServerId = 'server-launcher';
    const listeners = new Set<(nextValue: string) => void>();

    return {
        get sessionServerId() {
            return sessionServerId;
        },
        set sessionServerId(nextValue: string) {
            sessionServerId = nextValue;
            for (const listener of listeners) {
                listener(nextValue);
            }
        },
        subscribe(listener: (nextValue: string) => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
});
const resolveSessionTargetServerIdSpy = vi.fn((_sessionId: string, fallbackServerId?: string | null) => fallbackServerId ?? null);
const routerPushSpy = vi.fn();
let mockSession: {
    id: string;
    active: boolean;
    metadata: {
        flavor?: string;
        agent?: string;
        machineId: string;
    };
} = {
    id: 'session-launcher',
    active: false,
    metadata: {
        flavor: 'claude',
        machineId: 'machine-launcher',
    },
};

installSessionHooksCommonModuleMocks({
    // The shared helper owns the `@/modal` mock (a file-level `vi.mock('@/modal')` is shadowed by it),
    // so the confirm spy is routed through the canonical modal testkit here.
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: { confirm: (...args: Parameters<typeof modalConfirmSpy>) => modalConfirmSpy(...args) },
        }).module;
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                push: routerPushSpy,
                replace: vi.fn(),
                back: vi.fn(),
                setParams: vi.fn(),
            },
        }).module;
    },
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: (props: any) => React.createElement('ActivitySpinner', props),
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => enabledAgentIdsMock,
}));
vi.mock('@/agents/catalog/enabled', () => ({
    getEnabledAgentIds: () => enabledAgentIdsMock,
}));

vi.mock('@/agents/hooks/useResumeCapabilityOptions', () => ({
    useResumeCapabilityOptions: (...args: unknown[]) => useResumeCapabilityOptionsSpy(...args),
}));

vi.mock('@/components/sessions/model/useSessionMachineReachability', () => ({
    useSessionMachineReachability: () => ({ machineReachable: true }),
}));

vi.mock('@/components/sessions/model/useSessionMachineTarget', () => ({
    useSessionMachineTarget: () => machineTargetMock,
}));

vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => daemonMergedProjectionMock,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession', () => ({
    usePreferredServerIdForSession: (target: Readonly<{ serverId?: string | null; sessionId: string }>) => (
        target.serverId ?? launchabilityState.sessionServerId
    ),
}));

vi.mock('@/components/sessions/model/resolveSessionTargetServerId', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/sessions/model/resolveSessionTargetServerId')>();
    return {
        ...actual,
        resolveSessionTargetServerId: (...args: unknown[]) => resolveSessionTargetServerIdSpy(
            args[0] as string,
            args[1] as string | null | undefined,
        ),
    };
});

vi.mock('@/hooks/server/useMachineCapabilitiesCache', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/server/useMachineCapabilitiesCache')>();
    return {
        ...actual,
        useMachineCapabilitiesCache: (...args: unknown[]) => useMachineCapabilitiesCacheSpy(...args),
    };
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: (sessionId: string) => useHydrateSessionForRouteSpy(sessionId),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => featureState.credentialResources,
}));

vi.mock('@/hooks/session/useSessionExecutionRunLaunchability', () => ({
    useSessionExecutionRunLaunchability: (...args: unknown[]) => {
        useSessionExecutionRunLaunchabilitySpy(...args);
        const [sessionServerId, setSessionServerId] = React.useState(launchabilityState.sessionServerId);
        React.useEffect(() => launchabilityState.subscribe(setSessionServerId), []);
        return {
            canLaunchExecutionRuns: true,
            canShowExecutionRunLauncher: true,
            executionRunsBackends: emptyExecutionRunBackends,
            executionRunsSupported: true,
            sessionServerId,
        };
    },
}));

const storageMock = createStorageModuleStub({
    storage: createStorageStoreMock({
        sessions: {
            'session-launcher': {
                id: 'session-launcher',
                serverId: 'server-launcher',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: false,
                activeAt: 1,
                metadata: {
                        path: '/workspace',
                        host: 'launcher-host',
                    machineId: 'machine-launcher',
                },
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 1,
                thinking: false,
                thinkingAt: 1,
            },
        },
        machines: {
            'machine-launcher': {
                id: 'machine-launcher',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: {
                    host: 'launcher-host',
                    platform: 'linux',
                    happyCliVersion: 'test',
                    happyHomeDir: '/home/test',
                    homeDir: '/home/test',
                },
                metadataVersion: 1,
                daemonState: null,
                daemonStateVersion: 1,
            },
        },
    }),
    useSession: () => mockSession,
    useSettings: () => accountSettingsTestState.activeSettings,
});

vi.mock('@/sync/domains/state/storage', () => storageMock);

vi.mock('@/sync/store/settingsWriters', () => ({
    useAccountSettingsScope: () => accountSettingsTestState.activeScope,
}));

vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeBindings: (serverIds: readonly (string | null | undefined)[]) => {
        const key = JSON.stringify(serverIds);
        const existing = credentialScopeBindingsTestState.byKey.get(key);
        if (existing) return existing;
        const bindings = new Map(serverIds.flatMap((serverId) => serverId ? [[serverId, {
            serverId,
            accountId: 'account-1',
            scope: { serverId, accountId: 'account-1' },
            isCurrent: () => true,
        }] as const] : []));
        credentialScopeBindingsTestState.byKey.set(key, bindings);
        return bindings;
    },
}));

vi.mock('@/sync/domains/state/accountSettingsPersistence', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/state/accountSettingsPersistence')>(),
    loadAccountSettings: () => ({ settings: accountSettingsTestState.persistedSettings, version: 1 }),
}));

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: () => mockSession,
}));

vi.mock('@/sync/ops/actions/defaultActionExecutor', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/ops/actions/defaultActionExecutor')>();
    return {
        ...actual,
        createDefaultActionExecutor: (...args: unknown[]) => createDefaultActionExecutorSpy(...args),
    };
});

vi.mock('@/sync/domains/reviews/reviewEngineCatalog', () => ({
    buildAvailableReviewEngineOptions: () => [],
}));

vi.mock('@/sync/domains/permissions/permissionModeOptions', () => ({
    getPermissionModeOptionsForAgentType: () => [{ value: 'read-only', label: 'read-only' }],
}));

vi.mock('@/sync/domains/actions/resolveActionInputValidationError', () => ({
    resolveActionInputValidationError: () => null,
}));

vi.mock('@/sync/domains/actions/buildExecutionRunActionDraftInputForUi', () => ({
    buildExecutionRunActionDraftInputForUi: () => ({}),
}));

vi.mock('@/sync/domains/actions/resolveExecutionRunActionDefaultPermissionMode', () => ({
    resolveExecutionRunActionDefaultPermissionMode: () => 'read-only',
}));

vi.mock('@/sync/domains/actions/resolveExecutionRunActionAllowedPermissionModes', () => ({
    resolveExecutionRunActionAllowedPermissionModes: () => [],
}));

vi.mock('@/sync/domains/session/external/resolveSessionMachineId', () => ({
    resolveSessionMachineId: () => 'machine-launcher',
}));

vi.mock('@/sync/ops/actions/resolveActionExecutionFailureMessage', () => ({
    resolveActionExecutionFailureMessage: () => null,
}));

vi.mock('@/sync/ops/sessions', () => ({
    resumeSession: (...args: unknown[]) => {
        launchOrder.push('resume');
        return resumeSessionSpy(...args);
    },
}));

vi.mock('@/sync/ops/actions/executionRunActionDeps', () => ({
    createUiExecutionRunActionDeps: () => ({
        executionRunCheckProtocolV2: (...args: unknown[]) => {
            launchOrder.push('preflight');
            return executionRunProtocolCheckSpy(...args);
        },
    }),
}));

vi.mock('@/hooks/teams/useHomeTeamCredentialModelCatalog', () => ({
    useHomeTeamCredentialModelCatalog: (...args: unknown[]) => {
        teamCredentialCatalogArgsSpy(...args);
        return launcherCatalogTestState.catalog;
    },
}));

vi.mock('./ExecutionRunSecretReferenceOverlayField', () => ({
    ExecutionRunSecretReferenceOverlayField: (props: Record<string, unknown>) => {
        secretOverlayFieldPropsSpy(props);
        return React.createElement('ExecutionRunSecretReferenceOverlayField', props);
    },
    resolveExecutionRunSessionLaunchProfile: () => null,
}));

vi.mock('@/components/sessions/modelPicker/SessionModelPicker', () => ({
    SessionModelPicker: (props: Record<string, unknown>) => {
        modelPickerPropsSpy(props);
        return React.createElement('SessionModelPicker', props);
    },
}));

vi.mock('./resolveExecutionRunLauncherBackendChoices', async (importOriginal) => ({
    ...await importOriginal<typeof import('./resolveExecutionRunLauncherBackendChoices')>(),
    resolveExecutionRunLauncherBackendChoices: () => launcherCatalogTestState.backendChoices,
}));

vi.mock('./resolveExecutionRunLauncherContainerStyle', () => ({
    resolveExecutionRunLauncherContainerStyle: () => ({}),
}));

vi.mock('@happier-dev/protocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
    return {
        ...actual,
        getActionSpec: () => ({ id: 'review.start' }),
        resolveEffectiveActionInputFields: () => [],
    };
});

/**
 * The press area a control really guarantees, read through its owner's mechanism rather than one
 * style key: the pressable's own minimum box, or — for a segment whose drawn surface sits inside a
 * padded press frame — the surface's minimum plus that frame padding, then the hit slop on each side.
 */
function measurePressHitArea(node: { props: Record<string, any>; findAll: (predicate: (candidate: any) => boolean) => any[] }): { width: number; height: number } {
    const style = flattenTestStyle(node.props.style);
    const slop = typeof node.props.hitSlop === 'number' ? node.props.hitSlop : 0;
    const surfaceMinHeight = node.findAll((candidate) => candidate !== node
        && typeof candidate.type === 'string'
        && typeof flattenTestStyle(candidate.props?.style).minHeight === 'number')
        .map((candidate) => Number(flattenTestStyle(candidate.props.style).minHeight))[0] ?? 0;
    const framedHeight = surfaceMinHeight + Number(style.paddingVertical ?? 0) * 2;
    return {
        width: Number(style.minWidth ?? 0) + slop * 2,
        height: Math.max(Number(style.minHeight ?? 0), framedHeight) + slop * 2,
    };
}

describe('SessionExecutionRunLauncherView', () => {
    beforeEach(() => {
        createDefaultActionExecutorSpy.mockClear();
        actionExecuteSpy.mockClear();
        executionRunProtocolCheckSpy.mockReset();
        executionRunProtocolCheckSpy.mockResolvedValue({ ok: true, exactMachineId: 'machine-launcher' });
        resumeSessionSpy.mockReset();
        resumeSessionSpy.mockResolvedValue({ type: 'success' });
        launchOrder.length = 0;
        useResumeCapabilityOptionsSpy.mockClear();
        useMachineCapabilitiesCacheSpy.mockClear();
        useHydrateSessionForRouteSpy.mockClear();
        useSessionExecutionRunLaunchabilitySpy.mockClear();
        resolveSessionTargetServerIdSpy.mockClear();
        modelPickerPropsSpy.mockClear();
        modalConfirmSpy.mockClear();
        teamCredentialCatalogArgsSpy.mockClear();
        secretOverlayFieldPropsSpy.mockClear();
        featureState.credentialResources = true;
        modalConfirmSpy.mockResolvedValue(true);
        launcherCatalogTestState.backendChoices = [];
        launcherCatalogTestState.catalog = {
            resources: [],
            teamNameById: {},
            homeNameByTeamId: {},
            currentResourceKeys: new Set(),
            current: true,
        };
        mockSession = {
            id: 'session-launcher',
            active: false,
            metadata: {
                flavor: 'claude',
                machineId: 'machine-launcher',
            },
        };
        launchabilityState.sessionServerId = 'server-launcher';
        accountSettingsTestState.activeScope = { serverId: 'server-launcher', accountId: 'account-1' };
    });

    it('preflights an overlay before readiness-bound inactive resume, then invokes the Action', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            serverId: 'server-launcher',
            presentation: 'panel',
        }));
        const overlay = {
            v: 1 as const,
            bindings: {
                OPENAI_API_KEY: { ref: 'happier:shared-secret:v1:shared-1', revision: 7 },
            },
        };
        act(() => secretOverlayFieldPropsSpy.mock.calls.at(-1)?.[0].onChange({
            readiness: { ok: true, secretReferenceOverlay: overlay },
            overlay,
        }));
        act(() => pressTestInstance(
            screen.findByTestId('execution-run-new-start-button'),
            'executionRuns.newRun.a11y.startRun',
        ));
        await flushHookEffects({ cycles: 4 });

        expect(launchOrder).toEqual(['preflight', 'resume', 'action']);
        expect(resumeSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
            spawnNonce: expect.stringMatching(/^execution-run-host-/),
            waitForReady: true,
        }));
        expect(actionExecuteSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            secretReferenceOverlay: overlay,
        }), expect.anything());
    });

    it('performs no resume or Action when the exact target rejects overlay support', async () => {
        executionRunProtocolCheckSpy.mockResolvedValue({
            ok: false,
            errorCode: 'execution_run_protocol_unsupported',
            error: 'execution_run_protocol_unsupported',
        });
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            serverId: 'server-launcher',
            presentation: 'panel',
        }));
        const overlay = {
            v: 1 as const,
            bindings: {
                OPENAI_API_KEY: { ref: 'happier:shared-secret:v1:shared-1', revision: 7 },
            },
        };
        act(() => secretOverlayFieldPropsSpy.mock.calls.at(-1)?.[0].onChange({
            readiness: { ok: true, secretReferenceOverlay: overlay },
            overlay,
        }));
        act(() => pressTestInstance(
            screen.findByTestId('execution-run-new-start-button'),
            'executionRuns.newRun.a11y.startRun',
        ));
        await flushHookEffects({ cycles: 4 });

        expect(launchOrder).toEqual(['preflight']);
        expect(resumeSessionSpy).not.toHaveBeenCalled();
        expect(actionExecuteSpy).not.toHaveBeenCalled();
    });

    it('performs no resume or Action when overlay preflight returns a different exact target', async () => {
        executionRunProtocolCheckSpy.mockResolvedValue({ ok: true, exactMachineId: 'machine-replaced' });
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            serverId: 'server-launcher',
            presentation: 'panel',
        }));
        const overlay = {
            v: 1 as const,
            bindings: {
                OPENAI_API_KEY: { ref: 'happier:shared-secret:v1:shared-1', revision: 7 },
            },
        };
        act(() => secretOverlayFieldPropsSpy.mock.calls.at(-1)?.[0].onChange({
            readiness: { ok: true, secretReferenceOverlay: overlay },
            overlay,
        }));
        act(() => pressTestInstance(
            screen.findByTestId('execution-run-new-start-button'),
            'executionRuns.newRun.a11y.startRun',
        ));
        await flushHookEffects({ cycles: 4 });

        expect(launchOrder).toEqual(['preflight']);
        expect(resumeSessionSpy).not.toHaveBeenCalled();
        expect(actionExecuteSpy).not.toHaveBeenCalled();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('threads the session server id into the machine capabilities cache request', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
        }));

        const cacheRequest = (useMachineCapabilitiesCacheSpy.mock.calls as Array<[{
            serverId?: string;
        }]>).at(-1)?.[0];
        expect(cacheRequest).toMatchObject({
            serverId: 'server-launcher',
            request: { requests: [{ id: 'tool.executionRuns', params: { sessionId: 'session-launcher' } }] },
        });
        expect(resolveSessionTargetServerIdSpy).not.toHaveBeenCalled();
        const executorConfig = createDefaultActionExecutorSpy.mock.calls.at(-1)?.[0] as {
            resolveServerIdForSessionId: (sessionId: string) => string | null;
        };
        expect(executorConfig.resolveServerIdForSessionId('session-launcher')).toBe('server-launcher');
    });

    it('fails the exact Home credential feature closed before observing either shared Run catalog', async () => {
        featureState.credentialResources = false;
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            serverId: 'server-launcher',
            presentation: 'panel',
        }));

        expect(teamCredentialCatalogArgsSpy).toHaveBeenLastCalledWith({
            serverId: 'server-launcher',
            enabled: false,
        });
        expect(secretOverlayFieldPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            serverId: 'server-launcher',
            sharedEnabled: false,
        }));
    });

    it('keeps an explicit route Home through launchability, capability lookup and post-start navigation', async () => {
        launchabilityState.sessionServerId = 'home-b';
        mockSession = {
            id: 'same-session',
            active: true,
            metadata: {
                flavor: 'claude',
                machineId: 'machine-b',
            },
        };
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'same-session',
            serverId: 'home-b',
            presentation: 'screen',
            routeHydrationState: { kind: 'available', sessionId: 'same-session', serverId: 'home-b' },
        }));

        expect(useSessionExecutionRunLaunchabilitySpy).toHaveBeenCalledWith(
            'same-session',
            expect.anything(),
            'home-b',
        );
        expect(useMachineCapabilitiesCacheSpy).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'home-b',
        }));

        act(() => {
            pressTestInstance(
                screen.findByTestId('execution-run-new-start-button'),
                'executionRuns.newRun.a11y.startRun',
            );
        });
        await flushHookEffects({ cycles: 3 });
        expect(actionExecuteSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
                defaultSessionId: 'same-session',
                serverId: 'home-b',
            }),
        );
        expect(routerPushSpy).toHaveBeenCalledWith('/session/same-session/runs?serverId=home-b');
    });

    it('uses the exact inactive Home settings instead of the active Home settings', async () => {
        accountSettingsTestState.activeScope = { serverId: 'home-a', accountId: 'account-1' };
        launchabilityState.sessionServerId = 'home-b';
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'same-session',
            serverId: 'home-b',
            presentation: 'panel',
            routeHydrationState: { kind: 'available', sessionId: 'same-session', serverId: 'home-b' },
        }));

        const hookArgs = useResumeCapabilityOptionsSpy.mock.calls.at(-1)?.[0] as { settings: { analyticsOptOut: boolean } };
        expect(hookArgs.settings.analyticsOptOut).toBe(true);
    });

    it('uses caller-provided route hydration state without issuing a second hydration request', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            routeHydrationState: { kind: 'loading', sessionId: 'session-launcher', reason: 'store-miss' },
        }));

        expect(useHydrateSessionForRouteSpy).not.toHaveBeenCalled();
        expect(screen.findAllByType('ActivitySpinner')).toHaveLength(1);
    });

    it('re-resolves the launcher session server when the launchability hook changes', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
        }));

        await act(async () => {
            launchabilityState.sessionServerId = 'server-reactive';
            screen.tree.update(React.createElement(SessionExecutionRunLauncherView, {
                sessionId: 'session-launcher',
                presentation: 'panel',
            }));
        });

        const cacheRequest = (useMachineCapabilitiesCacheSpy.mock.calls as Array<[{
            serverId?: string;
        }]>).at(-1)?.[0];
        expect(cacheRequest).toMatchObject({
            serverId: 'server-reactive',
        });
        const executorConfig = createDefaultActionExecutorSpy.mock.calls.at(-1)?.[0] as {
            resolveServerIdForSessionId: (sessionId: string) => string | null;
        };
        expect(executorConfig.resolveServerIdForSessionId('session-launcher')).toBe('server-reactive');
        await screen.unmount();
    });

    it('does not synthesize a built-in default backend target when the session helper yields no backend default', async () => {
        mockSession = {
            id: 'session-launcher',
            active: false,
            metadata: {
                flavor: 'not-a-real-agent',
                machineId: 'machine-launcher',
            },
        };
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'delegate',
        }));

        expect(useResumeCapabilityOptionsSpy).toHaveBeenCalled();
        const hookArgs = useResumeCapabilityOptionsSpy.mock.calls.at(-1)?.[0] as {
            agentId?: unknown;
        };
        expect(hookArgs).toMatchObject({
            agentId: null,
        });
    });

    it('preserves an external Agent identity from legacy session metadata for resume support', async () => {
        mockSession = {
            id: 'session-launcher',
            active: false,
            metadata: {
                agent: 'acme.agent',
                machineId: 'machine-launcher',
            },
        };
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'delegate',
        }));

        const hookArgs = useResumeCapabilityOptionsSpy.mock.calls.at(-1)?.[0] as {
            agentId?: unknown;
        };
        expect(hookArgs).toMatchObject({
            agentId: 'acme.agent',
        });
    });

    it('reuses the accepted choice key for an exact external Agent target', async () => {
        const { resolveInitialExecutionRunBackendTargetKey } = await import('./SessionExecutionRunLauncherView');
        const target = {
            kind: 'agent' as const,
            identity: { pluginId: 'acme.agent', localId: 'runner' },
        };

        expect(resolveInitialExecutionRunBackendTargetKey(target, [{
            backendTarget: target,
            targetKey: 'agent:acme.agent/runner',
            backendId: 'acme.agent/runner',
            agentId: 'acme.agent/runner',
            title: 'Acme Runner',
            disabled: false,
        }])).toBe('agent:acme.agent/runner');
    });

    it('launches with the exact Team credential model selected through the canonical picker', async () => {
        launcherCatalogTestState.backendChoices = [{
            backendTarget: { kind: 'backend', backendId: 'codex' },
            targetKey: 'agent:codex',
            backendId: 'codex',
            agentId: 'codex',
            title: 'Codex',
            disabled: false,
        }];
        const selectedAgentTargetKey = buildBackendTargetKeyV2({ kind: 'backend', backendId: 'codex' });
        const selection = {
            kind: 'team_credential_provider_model' as const,
            resourceId: 'resource-team',
            teamId: 'team-1',
            expectedResourceRevision: 7,
            deliveryMode: 'brokered' as const,
            agentTargetKey: selectedAgentTargetKey,
            modelId: 'team-model',
        };
        launcherCatalogTestState.catalog = {
            resources: [{
                id: selection.resourceId,
                teamId: selection.teamId,
                displayName: 'Shared provider',
                deliveryMode: 'brokered',
                resourceRevision: selection.expectedResourceRevision,
                sessionUsePolicy: 'team_visibility_required',
                readiness: { kind: 'available' },
                recoveryAction: null,
                providerModels: [{ selection, descriptor: { id: selection.modelId, name: 'Team Model' }, availability: 'available' }],
            }],
            teamNameById: { 'team-1': 'Design' },
            homeNameByTeamId: { 'team-1': 'Work' },
            currentResourceKeys: new Set(['team-1:resource-team']),
            current: true,
        };

        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'delegate',
        }));
        await flushHookEffects({ cycles: 3 });

        const picker = screen.findAllByType('SessionModelPicker').at(-1);
        expect(picker).toBeTruthy();
        expect(picker?.props.agentTargetKey).toBe(selectedAgentTargetKey);
        await act(async () => {
            await picker?.props.onSelectTeamCredentialModel(selection);
        });
        act(() => {
            pressTestInstance(
                screen.findByTestId('execution-run-new-start-button'),
                'executionRuns.newRun.a11y.startRun',
            );
        });
        await flushHookEffects({ cycles: 3 });

        expect(actionExecuteSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                teamCredentialModel: selection,
                modelId: selection.modelId,
                teamCredentialSessionBindingConsent: {
                    v: 1,
                    sessionId: 'session-launcher',
                    teamId: selection.teamId,
                    resourceId: selection.resourceId,
                    expectedResourceRevision: selection.expectedResourceRevision,
                },
            }),
            expect.anything(),
        );

        actionExecuteSpy.mockClear();
        act(() => picker?.props.onSelect(null));
        act(() => {
            pressTestInstance(
                screen.findByTestId('execution-run-new-start-button'),
                'executionRuns.newRun.a11y.startRun',
            );
        });
        await flushHookEffects({ cycles: 3 });
        const clearedInput = actionExecuteSpy.mock.calls.at(-1)?.[1];
        if (!clearedInput || typeof clearedInput !== 'object' || Array.isArray(clearedInput)) {
            throw new Error('Expected the Run action input');
        }
        const clearedInputRecord = clearedInput as Record<string, unknown>;
        expect(clearedInputRecord.teamCredentialModel).toBeUndefined();
        expect(clearedInputRecord.teamCredentialSessionBindingConsent).toBeUndefined();
        expect(clearedInputRecord.modelId).toBeUndefined();
    });

    it('does not mutate the draft or start when Team visibility consent is cancelled or the catalog becomes stale', async () => {
        launcherCatalogTestState.backendChoices = [{
            backendTarget: { kind: 'backend', backendId: 'codex' },
            targetKey: 'agent:codex',
            backendId: 'codex',
            agentId: 'codex',
            title: 'Codex',
            disabled: false,
        }];
        const selection = {
            kind: 'team_credential_provider_model' as const,
            resourceId: 'resource-team',
            teamId: 'team-1',
            expectedResourceRevision: 7,
            deliveryMode: 'brokered' as const,
            agentTargetKey: buildBackendTargetKeyV2({ kind: 'backend', backendId: 'codex' }),
            modelId: 'team-model',
        };
        launcherCatalogTestState.catalog = {
            resources: [{
                id: selection.resourceId,
                teamId: selection.teamId,
                displayName: 'Shared provider',
                deliveryMode: 'brokered',
                resourceRevision: selection.expectedResourceRevision,
                sessionUsePolicy: 'team_visibility_required',
                readiness: { kind: 'available' },
                recoveryAction: null,
                providerModels: [{ selection, descriptor: { id: selection.modelId, name: 'Team Model' }, availability: 'available' }],
            }],
            teamNameById: { 'team-1': 'Design' },
            homeNameByTeamId: { 'team-1': 'Work' },
            currentResourceKeys: new Set(['team-1:resource-team']),
            current: true,
        };
        modalConfirmSpy.mockResolvedValue(false);

        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'delegate',
        }));
        await flushHookEffects({ cycles: 3 });

        const picker = screen.findAllByType('SessionModelPicker').at(-1);
        await act(async () => {
            await picker?.props.onSelectTeamCredentialModel(selection);
        });
        await flushHookEffects({ cycles: 3 });

        expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
        expect(actionExecuteSpy).not.toHaveBeenCalled();
        expect(screen.findAllByType('SessionModelPicker').at(-1)?.props.selectedTeamCredentialModel).toBeNull();

        modalConfirmSpy.mockImplementationOnce(async () => {
            launcherCatalogTestState.catalog.current = false;
            return true;
        });
        await act(async () => {
            await picker?.props.onSelectTeamCredentialModel(selection);
        });
        await flushHookEffects({ cycles: 3 });

        expect(modalConfirmSpy).toHaveBeenCalledTimes(2);
        expect(actionExecuteSpy).not.toHaveBeenCalled();
        expect(screen.findAllByType('SessionModelPicker').at(-1)?.props.selectedTeamCredentialModel).toBeNull();

        launcherCatalogTestState.catalog.current = true;
        modalConfirmSpy.mockImplementationOnce(async () => {
            launcherCatalogTestState.catalog.resources[0]!.providerModels = [{
                selection: { ...selection, deliveryMode: 'direct' },
                descriptor: { id: selection.modelId, name: 'Team Model' },
                availability: 'available',
            }];
            return true;
        });
        await act(async () => {
            await picker?.props.onSelectTeamCredentialModel(selection);
        });
        await flushHookEffects({ cycles: 3 });

        expect(modalConfirmSpy).toHaveBeenCalledTimes(3);
        expect(actionExecuteSpy).not.toHaveBeenCalled();
        expect(screen.findAllByType('SessionModelPicker').at(-1)?.props.selectedTeamCredentialModel).toBeNull();
    });


    it('keeps the cockpit panel look and gives only the screen page the segmented intents', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const panel = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'review',
        }));
        // The panel is a non-page surface (I1): its intents stay buttons, not a tab list.
        expect(panel.findByTestId('execution-run-launcher-intent:review')?.props.accessibilityRole).toBe('button');
        expect(panel.findAll((node) => node.props?.accessibilityRole === 'tablist')).toHaveLength(0);
        await panel.unmount();

        const page = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'screen',
            initialIntent: 'review',
        }));
        expect(page.findByTestId('execution-run-launcher-intent:review')?.props.accessibilityRole).toBe('tab');
        expect(page.findAll((node) => node.props?.accessibilityRole === 'tablist').length).toBeGreaterThan(0);
        await page.unmount();
    });

    it('marks the selected intent choice through accessibility state rather than colour alone', async () => {
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'review',
        }));

        expect(screen.findByTestId('execution-run-launcher-intent:review')?.props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(screen.findByTestId('execution-run-launcher-intent:plan')?.props.accessibilityState)
            .toMatchObject({ selected: false });

        act(() => {
            pressTestInstance(
                screen.findByTestId('execution-run-launcher-intent:plan'),
                'execution-run-launcher-intent:plan',
            );
        });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('execution-run-launcher-intent:review')?.props.accessibilityState)
            .toMatchObject({ selected: false });
        expect(screen.findByTestId('execution-run-launcher-intent:plan')?.props.accessibilityState)
            .toMatchObject({ selected: true });
        await screen.unmount();
    });

    it('announces submission state on the controls it disables while keeping Cancel available', async () => {
        mockSession = {
            ...mockSession,
            active: true,
        };
        let resolveStart!: (value: { ok: true }) => void;
        actionExecuteSpy.mockImplementationOnce(() => new Promise((resolve) => {
            resolveStart = resolve;
        }));
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        const screen = await renderScreen(React.createElement(SessionExecutionRunLauncherView, {
            sessionId: 'session-launcher',
            presentation: 'panel',
            initialIntent: 'review',
        }));

        act(() => {
            pressTestInstance(
                screen.findByTestId('execution-run-new-start-button'),
                'executionRuns.newRun.a11y.startRun',
            );
        });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('execution-run-new-start-button')?.props.accessibilityState)
            .toMatchObject({ disabled: true, busy: true });
        expect(screen.findByTestId('execution-run-launcher-intent:review')?.props.accessibilityState)
            .toMatchObject({ selected: true, disabled: true });
        expect(screen.findByTestId('execution-run-launcher-intent:plan')?.props.accessibilityState)
            .toMatchObject({ selected: false, disabled: true });
        expect(screen.findByTestId('execution-run-new-cancel-button')?.props.accessibilityState)
            .toMatchObject({ disabled: false, busy: false });

        await act(async () => {
            resolveStart({ ok: true });
            await flushHookEffects({ cycles: 2 });
        });
        await screen.unmount();
    });

    it('gives every actionable launcher control the shared platform interactive target', async () => {
        launcherCatalogTestState.backendChoices = [{
            backendTarget: { kind: 'backend', backendId: 'codex' },
            targetKey: 'agent:codex',
            backendId: 'codex',
            agentId: 'codex',
            title: 'Codex',
            disabled: false,
        }];
        const { SessionExecutionRunLauncherView } = await import('./SessionExecutionRunLauncherView');
        // `react-native` is mocked by a shared helper at runtime, so this file's
        // static import would bind the unmocked stub. Read the mocked module.
        const { Platform } = await import('react-native');
        const originalPlatform = Platform.OS;

        const { HappierUiPlatformProvider, useHappierNativeMinimumInteractiveTargetSize } = await import('@happier-dev/plugin-ui/environment');
        // The expected floor is read from the shared platform-policy owner under the same provider the
        // app mounts (`app/_layout.tsx`): 44/48 on native touch platforms, none on web/desktop.
        let policyFloor: number | undefined;
        function PlatformPolicyProbe() {
            policyFloor = useHappierNativeMinimumInteractiveTargetSize();
            return null;
        }

        try {
            for (const [platform, presentation] of [
                ['android', 'panel'], ['ios', 'panel'], ['web', 'panel'],
                ['android', 'screen'], ['ios', 'screen'], ['web', 'screen'],
            ] as const) {
                Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
                policyFloor = undefined;
                const screen = await renderScreen(React.createElement(
                    HappierUiPlatformProvider,
                    { platform: { platform, colorScheme: 'light' } },
                    React.createElement(PlatformPolicyProbe),
                    React.createElement(SessionExecutionRunLauncherView, {
                        sessionId: 'session-launcher',
                        presentation,
                    }),
                ));
                // Native platforms must report a floor, or the check below would pass vacuously.
                if (platform !== 'web') expect(policyFloor, `${platform} policy floor`).toBeGreaterThan(0);
                const targetSize = policyFloor ?? 0;

                for (const testID of [
                    'execution-run-launcher-intent:review',
                    'execution-run-launcher-intent:plan',
                    'execution-run-launcher-intent:delegate',
                    'execution-run-launcher-target:agent:codex',
                    'execution-run-new-start-button',
                    'execution-run-new-cancel-button',
                ]) {
                    const target = screen.findByTestId(testID);
                    expect(target, testID).not.toBeNull();
                    const hitArea = measurePressHitArea(target!);
                    expect(hitArea.width, `${presentation} ${platform} ${testID} width`).toBeGreaterThanOrEqual(targetSize);
                    expect(hitArea.height, `${presentation} ${platform} ${testID} height`).toBeGreaterThanOrEqual(targetSize);
                }

                await screen.unmount();
            }
        } finally {
            Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
        }
    });

});
