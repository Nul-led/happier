import 'fake-indexeddb/auto';
import React from 'react';
import { createNewSessionPromptStore } from '@/components/sessions/new/hooks/screenModel/newSessionPromptStore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import type { PermissionMode, ModelMode } from '@/sync/domains/permissions/permissionTypes';
import type { Settings } from '@/sync/domains/settings/settings';
import type { UseMachineEnvPresenceResult } from '@/hooks/machine/useMachineEnvPresence';
import { SessionSpawnNewInputV2Schema, type SessionSpawnNewInputV2, type SessionSpawnNewResultV1 } from '@happier-dev/protocol';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';

import { installNewSessionScreenModelCommonModuleMocks, selectNewSessionTestHome } from './newSessionScreenModelTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const syncSingletonBridge = vi.hoisted(() => ({
  current: null as typeof import('@/sync/sync').sync | null,
}));
vi.mock('@/sync/runtime/getSyncSingleton', () => ({
  getSyncSingleton: () => {
    if (!syncSingletonBridge.current) throw new Error('Test Sync singleton is not loaded');
    return syncSingletonBridge.current;
  },
}));

type NewSessionHarnessStorageState = ReturnType<(typeof import('@/sync/domains/state/storageStore'))['storage']['getState']>;

function spawnSuccess(sessionId: string): SessionSpawnNewResultV1 {
  return {
    type: 'success',
    disposition: 'created',
    sessionId,
    executionTarget: { serverId: 'server-a', machineId: 'm1' },
    organizationPlacement: { folderId: null, tagIds: [] },
    initialInput: { status: 'accepted', localId: `input-${sessionId}` },
  };
}

async function createHarness() {
  const modalAlertSpy = vi.fn((..._args: unknown[]) => {});
  const sessionSpawnNewActionBoundarySpy = vi.fn(async (_input: SessionSpawnNewInputV2): Promise<SessionSpawnNewResultV1> => ({
    type: 'error',
      code: 'machine_offline',
      retryable: true,
  }));
  let storageState: NewSessionHarnessStorageState;
  installNewSessionScreenModelCommonModuleMocks({
    text: () =>
      createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => {
          if (key === 'status.lastSeen') return `status.lastSeen:${String(params?.time ?? '')}`;
          if (key === 'time.minutesAgo') return `time.minutesAgo:${String(params?.count ?? '')}`;
          if (key === 'time.hoursAgo') return `time.hoursAgo:${String(params?.count ?? '')}`;
          return key;
        },
      }),
    modal: async () => ({
      Modal: { alert: modalAlertSpy, confirm: vi.fn(async () => false) },
    }),
  });
  vi.doUnmock('@/sync/domains/state/storage');
  vi.doUnmock('@/sync/domains/state/persistence');
  await selectNewSessionTestHome();
  const { storage } = await import('@/sync/domains/state/storageStore');
  storage.getState().activateProfileScope({ serverId: 'server-a', accountId: 'account-a' });
  storage.getState().activateSettingsScope({ serverId: 'server-a', accountId: 'account-a' });
  storage.getState().applySettings(storage.getState().settings, 1);
  storage.getState().applyMachines([createMachineFixture({ id: 'm1' })], true, { sourceServerId: 'server-a' });
  storageState = storage.getState();
  vi.spyOn(storageState, 'upsertPendingMessage');
  vi.spyOn(storageState, 'markSessionOptimisticThinking');




  // Keep Action dispatch and local launch custody real; replace only daemon transport.
  const { apiSocket } = await import('@/sync/api/session/apiSocket');
  vi.spyOn(apiSocket, 'machineRPC').mockImplementation(async (_machineId, _method, input) =>
    await sessionSpawnNewActionBoundarySpy(SessionSpawnNewInputV2Schema.parse(input)));
  const { sync } = await import('@/sync/sync');
  syncSingletonBridge.current = sync;
  vi.spyOn(sync, 'sendMessage');
  // Session-by-id hydration is a server/network boundary. Keep the post-spawn
  // visibility loop real while making its boundary reflect the harness store:
  // absent sessions remain retryable until the test projects them locally.
  vi.spyOn(sync, 'ensureSessionVisibleForMessageRoute').mockImplementation(async (sessionId, options) => (
    storage.getState().sessions[sessionId]
      ? {
          kind: 'available',
          sessionId,
          ...(options?.serverId ? { serverId: options.serverId } : {}),
        }
      : {
          kind: 'retryable_failure',
          sessionId,
          ...(options?.serverId ? { serverId: options.serverId } : {}),
          cause: 'network',
        }
  ));
  await import('@/sync/ops/actions/defaultActionExecutor');

  const { useCreateNewSession: useCreateNewSessionOwner } = await import('./useCreateNewSession');
  const useCreateNewSession: typeof useCreateNewSessionOwner = (params) => useCreateNewSessionOwner({
    ...params,
    draftScope: params.draftScope ?? { serverId: 'server-a', accountId: 'account-a' },
  });
  const initialStore = storage.getState();
  return {
    async reset() {
      modalAlertSpy.mockReset();
      sessionSpawnNewActionBoundarySpy.mockReset().mockResolvedValue({ type: 'error', code: 'machine_offline', retryable: true });
      storage.setState({ ...initialStore, sessions: {}, sessionPending: {} });
      storageState = storage.getState();
      const { actionOperationStore } = await import('@/sync/domains/actionOperations/actionOperationStore');
      actionOperationStore.reset();
      await selectNewSessionTestHome();
    },
    useCreateNewSession,
    modalAlertSpy,
    sessionSpawnNewActionBoundarySpy,
    get storageState() { return storageState; },
  };
}

let harness: Awaited<ReturnType<typeof createHarness>>;
async function setupHarness() {
  await harness.reset();
  return harness;
}

type CreateSessionParams = Parameters<(typeof import('./useCreateNewSession'))['useCreateNewSession']>[0];

function createRetryParams(settings: Settings, overrides: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    launchIntentSignature: 'test-launch-intent',
    router: { push: vi.fn(), replace: vi.fn() },
    selectedMachineId: 'm1',
    selectedMachine: createMachineFixture({ id: 'm1' }),
    selectedPath: '/tmp',
    draftScope: { serverId: 'server-a', accountId: 'account-a' },
    targetServerId: 'server-a',
    allowedTargetServerIds: ['server-a'],
    setIsCreating: vi.fn(),
    setIsResumeSupportChecking: vi.fn(),
    settings,
    useProfiles: false,
    selectedProfileId: null,
    profileMap: new Map(),
    recentMachinePaths: [],
    agentType: 'codex',
    permissionMode: 'default',
    modelMode: 'default',
    promptStore: createNewSessionPromptStore(''),
    resumeSessionId: '',
    agentNewSessionOptions: null,
    machineEnvPresence: { isPreviewEnvSupported: false, isLoading: false, meta: {}, refreshedAt: null, refresh: () => {} },
    secrets: [],
    secretBindingsByProfileId: {},
    selectedSecretIdByProfileIdByEnvVarName: {},
    sessionOnlySecretValueByProfileIdByEnvVarName: {},
    selectedMachineCapabilities: {},
    ...overrides,
  };
}

function alertRetry(modalAlertSpy: Awaited<ReturnType<typeof setupHarness>>['modalAlertSpy']): () => void {
  const buttons = modalAlertSpy.mock.calls.at(-1)?.[2] as ReadonlyArray<{ text: string; onPress?: () => void }> | undefined;
  const retry = buttons?.find((button) => button.text === 'common.retry')?.onPress;
  expect(retry).toBeTypeOf('function');
  return retry!;
}

describe('useCreateNewSession (daemon unavailable UX)', () => {
  beforeAll(async () => {
    harness = await createHarness();
    const { prepareSessionDraftPersistenceStorage } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
    await prepareSessionDraftPersistenceStorage();
  });
  afterAll(() => {
    syncSingletonBridge.current = null;
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('retries the same creation identity from the daemon-unavailable Retry action', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, modalAlertSpy, storageState } = await setupHarness();
    const params = createRetryParams(storageState.settings);
    const hook = await renderHook(() => useCreateNewSession(params));
    await act(async () => { await hook.getCurrent().handleCreateSession(); });
    const retry = alertRetry(modalAlertSpy);
    await act(async () => { retry(); });
    await flushHookEffects({ cycles: 8, turns: 4 });
    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(2);
    expect(sessionSpawnNewActionBoundarySpy.mock.calls[1]?.[0].creationKey)
      .toBe(sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0].creationKey);
    await hook.unmount();
  });

  it('invalidates daemon-unavailable Retry after Home, Account, Machine, path, or launch intent changes', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, modalAlertSpy, storageState } = await setupHarness();
    const changes = [
      ['Home', { targetServerId: 'server-b', draftScope: { serverId: 'server-b', accountId: 'account-a' } }],
      ['Account', { draftScope: { serverId: 'server-a', accountId: 'account-b' } }],
      ['Machine', { selectedMachineId: 'm2', selectedMachine: createMachineFixture({ id: 'm2' }) }],
      ['path', { selectedPath: '/other' }],
      ['launch intent', { launchIntentSignature: 'changed-intent' }],
    ] satisfies ReadonlyArray<readonly [string, Partial<CreateSessionParams>]>;
    for (const [name, overrides] of changes) {
      sessionSpawnNewActionBoundarySpy.mockClear();
      modalAlertSpy.mockClear();
      const initial = createRetryParams(storageState.settings);
      const hook = await renderHook((params: CreateSessionParams) => useCreateNewSession(params), { initialProps: initial });
      await act(async () => { await hook.getCurrent().handleCreateSession(); });
      const retry = alertRetry(modalAlertSpy);
      await hook.rerender({ ...initial, ...overrides });
      await act(async () => { retry(); });
      await flushHookEffects({ cycles: 8, turns: 4 });
      expect(sessionSpawnNewActionBoundarySpy, name).toHaveBeenCalledTimes(1);
      await hook.unmount();
    }
  });

  it('shows a daemon-unavailable alert with a Retry action', async () => {
    const { useCreateNewSession, modalAlertSpy } = await setupHarness();

    const setIsCreating = vi.fn();
    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: false, activeAt: Date.now() - 5 * 60_000, metadata: { host: 'devbox' } },
        setIsCreating,
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await createPromise;

    expect(modalAlertSpy).toHaveBeenCalled();
    const args = modalAlertSpy.mock.calls[0] ?? [];
    expect(args[0]).toBe('newSession.daemonRpcUnavailableTitle');
    expect(String(args[1] ?? '')).toContain('newSession.daemonRpcUnavailableBody');
    expect(String(args[1] ?? '')).toContain('status.lastSeen:time.minutesAgo:5');
    expect(Array.isArray(args[2])).toBe(true);
    const buttons = args[2] as any[];
    expect(buttons.some((b) => b?.text === 'common.retry' && typeof b?.onPress === 'function')).toBe(true);
    await hook.unmount();
  });

  it('does not keep the single-flight guard latched after a local validation failure', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy } = await setupHarness();

    const setIsCreating = vi.fn();
    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(
      ({ selectedMachineId }: { selectedMachineId: string | null }) =>
        useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
          router: { push: vi.fn(), replace: vi.fn() },
          selectedMachineId,
          selectedPath: '/tmp',
          selectedMachine: selectedMachineId
            ? { id: selectedMachineId, active: true, activeAt: Date.now(), metadata: { host: 'devbox' } }
            : null,
          setIsCreating,
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles: false,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore(''),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId: undefined,
          allowedTargetServerIds: undefined,
        }),
      { initialProps: { selectedMachineId: null as string | null } },
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    expect(sessionSpawnNewActionBoundarySpy).not.toHaveBeenCalled();

    await hook.rerender({ selectedMachineId: 'm1' });
    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('uses the latest selectedPath immediately after a rerender (no stale ref window)', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy } = await setupHarness();

    let createPromise: Promise<void> | void | null = null;

    const setIsCreating = vi.fn();
    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(
      ({ selectedPath, triggerCreate }: { selectedPath: string; triggerCreate: boolean }) => {
        const createHook = useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
          router: { push: vi.fn(), replace: vi.fn() },
          selectedMachineId: 'm1',
          selectedPath,
          selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
          setIsCreating,
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles: false,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore(''),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId: undefined,
          allowedTargetServerIds: undefined,
        });

        // Simulate the user clicking "Start New Session" immediately after the path
        // rerender commits, before passive effects flush.
        React.useLayoutEffect(() => {
          if (!triggerCreate) return;
          createPromise = createHook.handleCreateSession();
        }, [triggerCreate, createHook.handleCreateSession]);

        return createHook;
      },
      { initialProps: { selectedPath: '', triggerCreate: false } },
    );

    await hook.rerender({ selectedPath: '/tmp', triggerCreate: true });

    if (!createPromise) throw new Error('expected createPromise to be assigned');
    await flushHookEffects({ runAllTimers: true });
    await createPromise;

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    const arg = sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as any;
    expect(arg?.directory).toBe('/tmp');

    await hook.unmount();
  });

  it('uses the latest requested path getter even before the committed selectedPath rerenders', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy } = await setupHarness();

    const requestedPathRef = { current: '/home/happier/projects/subdir' };
    const setIsCreating = vi.fn();
    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/home/happier',
        getRequestedPath: () => requestedPathRef.current,
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating,
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await createPromise!;

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    const arg = sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as any;
    expect(arg?.directory).toBe('/home/happier/projects/subdir');

    await hook.unmount();
  });

  it('does not retry after unmount when the alert Retry action is pressed', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy } = await setupHarness();

    const setIsCreating = vi.fn();
    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: false, activeAt: Date.now() - 5 * 60_000, metadata: { host: 'devbox' } },
        setIsCreating,
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(modalAlertSpy).toHaveBeenCalled();

    const buttons = (modalAlertSpy.mock.calls[0]?.[2] ?? []) as any[];
    const retry = buttons.find((b) => b?.text === 'common.retry');
    expect(typeof retry?.onPress).toBe('function');

    await hook.unmount();

    await act(async () => {
      retry.onPress();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
  });

  it('does not auto-retry in the hook before showing the daemon-unavailable alert', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy } = await setupHarness();

    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce({
      type: 'error',
      code: 'machine_offline',
      retryable: true,
    });

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(modalAlertSpy).toHaveBeenCalled();
  });

  it('admits and projects the accepted first prompt before opening the created session route', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();
    const { storage } = await import('@/sync/domains/state/storageStore');
    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    const router = {
      push: vi.fn(),
      replace: vi.fn(() => {
        expect(storage.getState().sessionPending['session-created']?.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ localId: 'input-session-created', text: 'Start here', deliveryStatus: 'accepted' }),
        ]));
      }),
    };
    const hook = await renderHook(() => useCreateNewSession(createRetryParams(storageState.settings, {
      router, promptStore: createNewSessionPromptStore('Start here'),
    })));
    await act(async () => { await hook.getCurrent().handleCreateSession(); });
    expect(sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0]).toMatchObject({
      creationKey: expect.stringMatching(/^manual:/), initialInput: { text: 'Start here' },
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    const { sync } = await import('@/sync/sync');
    expect(sync.sendMessage).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('publishes the first prompt as a launch attempt while spawn is unresolved', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();
    const spawnDeferred = createDeferred<SessionSpawnNewResultV1>();
    sessionSpawnNewActionBoundarySpy.mockImplementationOnce(async () => spawnDeferred.promise);
    const onLaunchAttemptChange = vi.fn();

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore('Start here'),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: 'server-a',
        allowedTargetServerIds: ['server-a'],
        onLaunchAttemptChange,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    try {
      await act(async () => {
        createPromise = hook.getCurrent().handleCreateSession();
        await flushHookEffects({ turns: 2 });
      });

      expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
      const publishedAttempts = onLaunchAttemptChange.mock.calls
        .map((call) => call[0])
        .filter(Boolean);
      expect(publishedAttempts[publishedAttempts.length - 1]).toEqual(expect.objectContaining({
        status: 'spawning',
        createdSessionId: null,
        prompt: expect.objectContaining({
          prompt: 'Start here',
          displayText: 'Start here',
        }),
      }));
      expect(storageState.upsertPendingMessage).not.toHaveBeenCalled();
    } finally {
      storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
      spawnDeferred.resolve(spawnSuccess('session-created'));
      await act(async () => {
        await createPromise;
      });
      await hook.unmount();
    }
  });

  it('keeps a pending Action unresolved without duplicating creation', async () => {
    const {
      useCreateNewSession,
      modalAlertSpy,
      sessionSpawnNewActionBoundarySpy,
      storageState,
    } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce({
      type: 'pending',
        retryWithSameCreationKey: true,
        outcome: 'unknown',
    });

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore('Start here'),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    const creationKey = (sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as any)?.creationKey;
    expect(creationKey).toEqual(expect.stringMatching(/^manual:new-session-attempt-/));
    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0]).not.toHaveProperty('initialPrompt');
    expect(router.replace).not.toHaveBeenCalled();
    expect(modalAlertSpy).toHaveBeenCalledWith(
      'common.error',
      expect.stringContaining('newSession.launchStillPendingBody'),
    );

    await hook.unmount();
  });

  it('preserves a first prompt not accepted by the created Session without sending it twice', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();
    const { prepareSessionDraftPersistenceStorage } = await import('@/sync/ops/sessionDrafts/sessionDraftPersistenceStorage');
    await prepareSessionDraftPersistenceStorage();
    const { getSessionDraftSnapshot } = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');
    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce({
      ...spawnSuccess('session-created'),
      type: 'success', disposition: 'created', sessionId: 'session-created',
      executionTarget: { serverId: 'server-a', machineId: 'm1' },
      organizationPlacement: { folderId: null, tagIds: [] },
      initialInput: { status: 'outcomeUnknown', localId: 'input-session-created', code: 'transport_unavailable' },
    });
    const router = { push: vi.fn(), replace: vi.fn() };
    const hook = await renderHook(() => useCreateNewSession(createRetryParams(storageState.settings, {
      promptStore: createNewSessionPromptStore('Keep this first prompt'), router,
    })));
    await act(async () => { await hook.getCurrent().handleCreateSession(); });
    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0].initialInput).toEqual({ text: 'Keep this first prompt' });
    expect(getSessionDraftSnapshot({ serverId: 'server-a', accountId: 'account-a' }, { kind: 'session', sessionId: 'session-created' })?.document.composer.text?.value).toBe('Keep this first prompt');
    const { sync } = await import('@/sync/sync');
    expect(sync.sendMessage).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('retries an outcome-unknown Action with the same creation identity', async () => {
    const {
      useCreateNewSession,
      modalAlertSpy,
      sessionSpawnNewActionBoundarySpy,
      storageState,
    } = await setupHarness();

    storageState.sessions['session-after-retry'] = createSessionFixture({ id: 'session-after-retry', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy
      .mockResolvedValueOnce({
        type: 'pending',
        retryWithSameCreationKey: true,
        outcome: 'unknown',
      })
      .mockResolvedValueOnce(spawnSuccess('session-after-retry'));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore('Retry same nonce'),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(router.replace).not.toHaveBeenCalled();
    const firstSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as {
      creationKey?: string;
    };
    expect(firstSpawnOptions).not.toHaveProperty('initialPrompt');
    await act(async () => { await hook.getCurrent().handleCreateSession(); });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(2);
    expect(sessionSpawnNewActionBoundarySpy.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      creationKey: firstSpawnOptions.creationKey,
    }));
    expect(router.replace).toHaveBeenCalledWith('/session/session-after-retry?serverId=server-a', expect.anything());

    await hook.unmount();
  });

  it('retains the real custody creation identity across remount after an unknown outcome', async () => {
    const {
      useCreateNewSession,
      sessionSpawnNewActionBoundarySpy,
      storageState,
    } = await setupHarness();

    storageState.sessions['session-from-operation-settlement'] = createSessionFixture({
      id: 'session-from-operation-settlement',
      encryptionMode: 'plain',
    });
    sessionSpawnNewActionBoundarySpy
      .mockResolvedValueOnce({
        type: 'pending',
        retryWithSameCreationKey: true,
        outcome: 'unknown',
      })
      .mockResolvedValueOnce(spawnSuccess('session-from-operation-settlement'));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    let durableUserAttemptId: string | null = null;
    const createHook = () =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore('Retry after route stall'),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
        launchUserAttemptId: durableUserAttemptId,
        onLaunchUserAttemptIdChange: (next) => {
          durableUserAttemptId = next;
        },
      });

    const firstHook = await renderHook(createHook);
    await act(async () => {
      await firstHook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await firstHook.unmount();

    const secondHook = await renderHook(createHook);
    await act(async () => {
      await secondHook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await secondHook.unmount();

    const secondSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[1]?.[0] as {
      creationKey?: string;
    };

    expect(secondSpawnOptions.creationKey).toBe(sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0].creationKey);
    expect(secondSpawnOptions.creationKey).toMatch(/^manual:.+/);
  });

  it('keeps the unresolved launch barrier after remounting with a changed prompt on the same launch scope', async () => {
    const {
      useCreateNewSession,
      sessionSpawnNewActionBoundarySpy,
    } = await setupHarness();

    sessionSpawnNewActionBoundarySpy
      .mockResolvedValue({
        type: 'pending',
        retryWithSameCreationKey: true,
        outcome: 'unknown',
      });

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const createHook = (sessionPrompt: string) =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm-remount-prompt',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm-remount-prompt', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(sessionPrompt),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      });

    const firstHook = await renderHook(() => createHook('First timed-out prompt'));
    await act(async () => {
      await firstHook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await firstHook.unmount();

    const firstSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as {
      creationKey?: string;
    };

    const secondHook = await renderHook(() => createHook('Changed prompt after timeout'));
    await act(async () => {
      await secondHook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });
    await secondHook.unmount();

    const secondSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[1]?.[0] as {
      creationKey?: string;
    };

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(2);
    expect(secondSpawnOptions.creationKey).not.toBe(firstSpawnOptions.creationKey);
  });

  it('rotates the action identity when the canonical launch intent changes on the same mounted screen', async () => {
    const {
      useCreateNewSession,
      sessionSpawnNewActionBoundarySpy,
    } = await setupHarness();

    sessionSpawnNewActionBoundarySpy
      .mockResolvedValue({
        type: 'pending',
        retryWithSameCreationKey: true,
        outcome: 'unknown',
      });

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(
      ({ launchIntentSignature }: { launchIntentSignature: string }) =>
        useCreateNewSession({
          router: { push: vi.fn(), replace: vi.fn() },
          selectedMachineId: 'm-mounted-prompt',
          selectedPath: '/tmp',
          selectedMachine: { id: 'm-mounted-prompt', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
          setIsCreating: vi.fn(),
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles: false,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore('Unchanged prompt'),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId: undefined,
          allowedTargetServerIds: undefined,
          launchUserAttemptId: 'persisted-attempt-a',
          launchIntentSignature,
        }),
      { initialProps: { launchIntentSignature: 'intent-a' } },
    );

    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    const firstSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[0]?.[0] as {
      creationKey?: string;
    };

    await hook.rerender({ launchIntentSignature: 'intent-b' });
    await act(async () => {
      await hook.getCurrent().handleCreateSession();
    });
    await flushHookEffects({ runAllTimers: true });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(2);
    const secondSpawnOptions = sessionSpawnNewActionBoundarySpy.mock.calls[1]?.[0] as {
      creationKey?: string;
    };
    expect(secondSpawnOptions.creationKey).not.toBe(firstSpawnOptions.creationKey);

    await hook.unmount();
  });

  it('offers Retry for daemon-unavailable post-create follow-up failures without creating another session', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    const retryableFollowUpError = Object.assign(new Error('Machine target not available for session'), {
      rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
    });
    const afterCreated = vi.fn()
      .mockRejectedValueOnce(retryableFollowUpError)
      .mockResolvedValueOnce(undefined);

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: false, activeAt: Date.now() - 5 * 60_000, metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ afterCreated });
    });
    await flushHookEffects({ runAllTimers: true });

    let retryAlertCall = modalAlertSpy.mock.calls.find((call) => {
      const buttons = call[2];
      return Array.isArray(buttons) && buttons.some((button) => button?.text === 'common.retry');
    });
    for (let attempts = 0; attempts < 5 && !retryAlertCall; attempts += 1) {
      await flushHookEffects({ runAllTimers: true });
      retryAlertCall = modalAlertSpy.mock.calls.find((call) => {
        const buttons = call[2];
        return Array.isArray(buttons) && buttons.some((button) => button?.text === 'common.retry');
      });
    }
    expect(retryAlertCall).toBeTruthy();
    expect(modalAlertSpy.mock.calls.some((call) => call[0] === 'common.error')).toBe(false);
    const buttons = (retryAlertCall?.[2] ?? []) as any[];
    const retry = buttons.find((button) => button?.text === 'common.retry');
    expect(typeof retry?.onPress).toBe('function');

    await act(async () => {
      retry.onPress();
    });
    await createPromise;

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(afterCreated).toHaveBeenCalledTimes(2);
    expect(afterCreated).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-created',
      effectiveSpawnServerId: 'server-a',
      launchAttempt: expect.objectContaining({
        attachmentMessageLocalId: expect.stringMatching(/^plugin-input-v1:/),
      }),
    }));
    expect(router.replace).toHaveBeenCalledTimes(1);

    await hook.unmount();
  });

  it('drops duplicate create requests while a launch is already in flight', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValue(spawnSuccess('session-created'));
    let resolveAfterCreated: () => void = () => {
      throw new Error('expected afterCreated to be waiting');
    };
    const afterCreated = vi.fn(async () => new Promise<void>((resolve) => {
      resolveAfterCreated = resolve;
    }));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let firstCreate: Promise<void> | void | null = null;
    let secondCreate: Promise<void> | void | null = null;
    await act(async () => {
      firstCreate = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ cycles: 1, turns: 1 });
      secondCreate = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ cycles: 1, turns: 1 });
    });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(afterCreated).toHaveBeenCalledTimes(1);

    resolveAfterCreated();
    await firstCreate;
    await secondCreate;

    await hook.unmount();
  });

  it('does not navigate when launch scope changes before completion', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    let resolveAfterCreated: () => void = () => {
      throw new Error('expected afterCreated to be waiting');
    };
    const afterCreated = vi.fn(async () => new Promise<void>((resolve) => {
      resolveAfterCreated = resolve;
    }));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };
    const setIsCreating = vi.fn();

    const hook = await renderHook(
      ({ targetServerId }: { targetServerId: string | null }) =>
        useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
          router,
          selectedMachineId: 'm1',
          selectedPath: '/tmp',
          selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
          setIsCreating,
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles: false,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore(''),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId,
          allowedTargetServerIds: ['server-a', 'server-b'],
        }),
      { initialProps: { targetServerId: 'server-a' as string | null } },
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
    await hook.rerender({ targetServerId: 'server-b' });

    resolveAfterCreated();
    await createPromise;
    await flushHookEffects({ cycles: 8, turns: 4 });

    expect(router.replace).not.toHaveBeenCalled();
    expect(setIsCreating).toHaveBeenLastCalledWith(false);

    await hook.unmount();
  });

  it('keeps routing when macOS resolves a /tmp launch path to its /private/tmp canonical path', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    let resolveAfterCreated: () => void = () => {
      throw new Error('expected afterCreated to be waiting');
    };
    const afterCreated = vi.fn(async () => new Promise<void>((resolve) => {
      resolveAfterCreated = resolve;
    }));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(
      ({ selectedPath }: { selectedPath: string }) =>
        useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
          router,
          selectedMachineId: 'm1',
          selectedPath,
          selectedMachine: {
            id: 'm1',
            active: true,
            activeAt: Date.now(),
            metadata: { host: 'devbox', platform: 'darwin', homeDir: '/Users/leeroy' },
          },
          setIsCreating: vi.fn(),
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles: false,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore(''),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId: undefined,
          allowedTargetServerIds: undefined,
        }),
      { initialProps: { selectedPath: '/tmp/happier-ruqa-late-opencode-hqzCRl' } },
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
    await hook.rerender({ selectedPath: '/private/tmp/happier-ruqa-late-opencode-hqzCRl' });

    resolveAfterCreated();
    await createPromise;
    await flushHookEffects({ runAllTimers: true });

    expect(router.replace).toHaveBeenCalledWith('/session/session-created?serverId=server-a', expect.anything());

    await hook.unmount();
  });

  it('keeps launch pending and routes when the created session hydrates after an initial route-readiness miss', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };
    const setIsCreating = vi.fn();

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating,
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ initialMessage: 'skip' });
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
    expect(router.replace).not.toHaveBeenCalled();
    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    await flushHookEffects({ runAllTimers: true });
    await createPromise;

    expect(router.replace).toHaveBeenCalledWith('/session/session-created?serverId=server-a', expect.anything());
    expect(modalAlertSpy).not.toHaveBeenCalled();
    expect(setIsCreating).toHaveBeenCalledWith(true);
    expect(setIsCreating).not.toHaveBeenCalledWith(false);

    await hook.unmount();
  });

  it('treats profile-mode changes as launch scope changes', async () => {
    const { useCreateNewSession, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    let resolveAfterCreated: () => void = () => {
      throw new Error('expected afterCreated to be waiting');
    };
    const afterCreated = vi.fn(async () => new Promise<void>((resolve) => {
      resolveAfterCreated = resolve;
    }));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(
      ({ useProfiles }: { useProfiles: boolean }) =>
        useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
          router,
          selectedMachineId: 'm1',
          selectedPath: '/tmp',
          selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
          setIsCreating: vi.fn(),
          setIsResumeSupportChecking: vi.fn(),
          settings,
          useProfiles,
          selectedProfileId: null,
          profileMap: new Map(),
          recentMachinePaths: [],
          agentType: 'codex' as any,
          permissionMode: 'default' as PermissionMode,
          modelMode: 'default' as ModelMode,
          promptStore: createNewSessionPromptStore(''),
          resumeSessionId: '',
          agentNewSessionOptions: null,
          machineEnvPresence,
          secrets: [],
          secretBindingsByProfileId: {},
          selectedSecretIdByProfileIdByEnvVarName: {},
          sessionOnlySecretValueByProfileIdByEnvVarName: {},
          selectedMachineCapabilities: {},
          targetServerId: undefined,
          allowedTargetServerIds: undefined,
        }),
      { initialProps: { useProfiles: false } },
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
    await hook.rerender({ useProfiles: true });

    resolveAfterCreated();
    await createPromise;
    await flushHookEffects({ runAllTimers: true });

    expect(router.replace).not.toHaveBeenCalled();

    await hook.unmount();
  });

  it('retries post-create follow-up failures against the created session without respawning', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    const afterCreated = vi.fn()
      .mockRejectedValueOnce(new Error('Created session is not available locally yet'))
      .mockResolvedValueOnce(undefined);

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };
    const router = { push: vi.fn(), replace: vi.fn() };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router,
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: true, activeAt: Date.now(), metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ initialMessage: 'skip', afterCreated });
      await flushHookEffects({ runAllTimers: true });
    });

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    const retryAlertCall = modalAlertSpy.mock.calls.find((call) => {
      const buttons = call[2];
      return Array.isArray(buttons) && buttons.some((button) => button?.text === 'common.retry');
    });
    expect(retryAlertCall).toBeTruthy();
    const retry = ((retryAlertCall?.[2] ?? []) as Array<{ text?: string; onPress?: () => void }>)
      .find((button) => button?.text === 'common.retry');
    expect(typeof retry?.onPress).toBe('function');

    await act(async () => {
      retry?.onPress?.();
      await flushHookEffects({ runAllTimers: true });
    });
    await createPromise;

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(afterCreated).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-created',
      launchAttempt: expect.objectContaining({
        createdSessionId: 'session-created',
      }),
    }));
    expect(router.replace).toHaveBeenCalledWith('/session/session-created?serverId=server-a', expect.anything());

    await hook.unmount();
  });

  it('shows the generic follow-up error when retry fails for a non-daemon reason', async () => {
    const { useCreateNewSession, modalAlertSpy, sessionSpawnNewActionBoundarySpy, storageState } = await setupHarness();

    storageState.sessions['session-created'] = createSessionFixture({ id: 'session-created', encryptionMode: 'plain' });
    sessionSpawnNewActionBoundarySpy.mockResolvedValueOnce(spawnSuccess('session-created'));
    const retryableFollowUpError = Object.assign(new Error('Machine target not available for session'), {
      rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
    });
    const afterCreated = vi.fn()
      .mockRejectedValueOnce(retryableFollowUpError)
      .mockRejectedValueOnce(new Error('Attachment validation failed'));

    const settings = { experiments: false } as unknown as Settings;
    const machineEnvPresence: UseMachineEnvPresenceResult = {
      isPreviewEnvSupported: false,
      isLoading: false,
      meta: {},
      refreshedAt: null,
      refresh: () => {},
    };

    const hook = await renderHook(() =>
      useCreateNewSession({
        launchIntentSignature: 'test-launch-intent',
        router: { push: vi.fn(), replace: vi.fn() },
        selectedMachineId: 'm1',
        selectedPath: '/tmp',
        selectedMachine: { id: 'm1', active: false, activeAt: Date.now() - 5 * 60_000, metadata: { host: 'devbox' } },
        setIsCreating: vi.fn(),
        setIsResumeSupportChecking: vi.fn(),
        settings,
        useProfiles: false,
        selectedProfileId: null,
        profileMap: new Map(),
        recentMachinePaths: [],
        agentType: 'codex' as any,
        permissionMode: 'default' as PermissionMode,
        modelMode: 'default' as ModelMode,
        promptStore: createNewSessionPromptStore(''),
        resumeSessionId: '',
        agentNewSessionOptions: null,
        machineEnvPresence,
        secrets: [],
        secretBindingsByProfileId: {},
        selectedSecretIdByProfileIdByEnvVarName: {},
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        selectedMachineCapabilities: {},
        targetServerId: undefined,
        allowedTargetServerIds: undefined,
      }),
    );

    let createPromise: Promise<void> | void | null = null;
    await act(async () => {
      createPromise = hook.getCurrent().handleCreateSession({ afterCreated });
    });
    await flushHookEffects({ runAllTimers: true });

    const retryAlertCall = modalAlertSpy.mock.calls.find((call) => {
      const buttons = call[2];
      return Array.isArray(buttons) && buttons.some((button) => button?.text === 'common.retry');
    });
    const buttons = (retryAlertCall?.[2] ?? []) as any[];
    const retry = buttons.find((button) => button?.text === 'common.retry');
    expect(typeof retry?.onPress).toBe('function');

    await act(async () => {
      retry.onPress();
    });
    await createPromise;

    expect(sessionSpawnNewActionBoundarySpy).toHaveBeenCalledTimes(1);
    expect(afterCreated).toHaveBeenCalledTimes(2);
    expect(modalAlertSpy.mock.calls).toContainEqual([
      'common.error',
      'Attachment validation failed',
    ]);

    await hook.unmount();
  });


});
