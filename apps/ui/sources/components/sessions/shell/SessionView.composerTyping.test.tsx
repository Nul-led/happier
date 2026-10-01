import * as React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { createReactNavigationNativeMock } from '@/dev/testkit/mocks/reactNavigation';

/**
 * Typing in an existing Session's composer: the text is high-frequency state, so the loaded
 * shell must not re-render per keystroke, while the draft still persists, restores and submits.
 * Runs through the real draft owner (`useDraft`), composer persistence and draft repository.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__DEV__ = false;
let authCredentials: any = { token: 't', secret: 's' };
const sessionState = vi.hoisted(() => ({
  session: {
    id: 's1',
    serverId: 'server-1',
    metadata: null,
    accessLevel: 'edit',
    access: { capabilities: { submitAgentInput: true } },
    canApprovePermissions: true,
    agentState: { controlledByUser: true },
  } as any,
}));
const shellRenders = vi.hoisted(() => ({ count: 0 }));
const pendingWork = vi.hoisted(() => [] as Promise<unknown>[]);
const attachmentsTransferAvailableState = vi.hoisted(() => ({ value: false }));
const attachmentsFeatureScopeState = vi.hoisted(() => ({ enabledForServerId: null as string | null }));
const executeSessionComposerResolutionMock = vi.hoisted(() => vi.fn());
const resolveSessionComposerSendMock = vi.hoisted(() => vi.fn((_input: unknown) => ({ kind: 'noop' })));
const supportsEditableSessionGoalsMock = vi.hoisted(() => vi.fn(() => false));
const sessionAbortMock = vi.hoisted(() => vi.fn());
// The device holds credentials for the session's Home: the route binds its exact Account scope.
const accountBinding = vi.hoisted(() => {
  const scope = Object.freeze({ serverId: 'server-1', accountId: 'account-1' });
  return Object.freeze({
    serverId: scope.serverId,
    accountId: scope.accountId,
    revision: 1,
    scope,
    isCurrent: () => true,
    onRetire: () => Object.freeze({ dispose(): void {} }),
  });
});

vi.mock('react-native', async () => {
  const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
  return createReactNativeWebMock({
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator',
    Easing: { bezier: vi.fn(() => ({})) },
    Animated: {
      View: 'Animated.View',
      Value: class {
        interpolate() {
          return this;
        }
      },
      timing: () => ({ start: (cb?: any) => cb?.({ finished: true }) }),
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: vi.fn(async () => false),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    Dimensions: { get: () => ({ width: 800, height: 600, scale: 2, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 1200, height: 800 }),
    Platform: {
      OS: 'ios',
      select: (spec: Record<string, unknown>) =>
        spec && Object.prototype.hasOwnProperty.call(spec, 'ios') ? (spec as any).ios : (spec as any).default,
    },
  });
});
vi.mock('react-native-unistyles', async () => {
  const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
  return createUnistylesMock();
});
vi.mock('@/text', async () => {
  const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
  return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/modal', async () => {
  const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
  return createModalModuleMock().module;
});
vi.mock('expo-router', async () => {
  const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
  return createExpoRouterMock({ router: { push: vi.fn(), back: vi.fn() }, pathname: '/' }).module;
});
vi.mock('@/agents/registry/registryUiBehavior', async () => {
  const { createRegistryUiBehaviorModuleMock } = await import('@/dev/testkit/mocks/registryUiBehavior');
  return createRegistryUiBehaviorModuleMock({ supportsEditableSessionGoals: supportsEditableSessionGoalsMock });
});
vi.mock('@/sync/domains/state/storage', async () => {
  const { createLiveStorageStoreMock, createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
  const { settingsDefaults } = await import('@/sync/domains/settings/settings');
  return createStorageModuleStub({
  storage: createLiveStorageStoreMock(() => ({
    sessions: { s1: sessionState.session },
    settings: settingsDefaults,
    sessionListIndexByServerId: {},
  })),
  useSession: () => sessionState.session,
  useSessionMachineId: () => sessionState.session.metadata?.machineId ?? null,
  useIsDataReady: () => true,
  useRealtimeStatus: () => ({ status: 'connected' }),
  useSessionMessages: () => ({ messages: [], isLoaded: true }),
  useSessionSubagentSourceMessages: () => [],
  useSessionTranscriptIds: () => ({ ids: [], isLoaded: true }),
  useOpenApprovalArtifactsForSession: () => [],
  useEnabledAutomationsCountForSession: () => 0,
  useLocalSetting: (key: string) => {
    if (key === 'uiMultiPanePanelsEnabled') return false;
    if (key === 'acknowledgedCliVersions') return [];
    return null;
  },
  useSessionPendingMessages: () => ({ messages: [] }),
  useSessionReviewCommentsDrafts: () => [],
  useSessionUsage: () => null,
  useWorkflowRunRows: () => [],
  useWorkspaceReviewCommentsDrafts: () => [],
  useSessionVisibleReadSeq: () => 0,
  useSetting: (key: string) => (settingsDefaults as Record<string, unknown>)[key] ?? null,
  useSettings: () => ({ experiments: true, featureToggles: {} }),
  useAutomations: () => [],
  useMachine: () => null,
  useLocalSettingMutable: () => [false, vi.fn()],
  useSettingMutable: () => [null, vi.fn()],
  });
});
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/domains/scope/useServerCredentialAccountScopes')>()),
  useServerCredentialAccountScopeResolution: (serverId: string | null | undefined) => (
    serverId === accountBinding.serverId ? { kind: 'bound', scope: accountBinding.scope } : { kind: 'resolving' }
  ),
  useServerCredentialAccountScopeResolutions: (serverIds: readonly string[]) => new Map(serverIds.map((serverId) => [
    serverId,
    serverId === accountBinding.serverId ? { kind: 'bound', scope: accountBinding.scope } : { kind: 'resolving' },
  ] as const)),
  useServerCredentialAccountScopeBindings: (serverIds: readonly string[]) => new Map(
    serverIds.filter((serverId) => serverId === accountBinding.serverId).map((serverId) => [serverId, accountBinding] as const),
  ),
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));
vi.mock('react-native-safe-area-context', () => ({
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 0, height: 0 },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@react-navigation/native', () => ({
  ...createReactNavigationNativeMock(),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({ credentials: authCredentials }),
}));

vi.mock('@/components/sessions/transcript/AgentContentView', () => ({
  AgentContentView: (props: any) => React.createElement('AgentContentView', props, props.input ?? null),
}));
vi.mock('@/components/sessions/transcript/ChatHeaderView', () => ({
  ChatHeaderView: () => null,
}));
vi.mock('@/components/sessions/transcript/ChatList', () => ({
  ChatList: () => null,
}));
vi.mock('@/components/ui/empty/EmptyMessages', () => ({
  EmptyMessages: () => null,
}));
vi.mock('@/components/ui/forms/Deferred', () => ({
  Deferred: (props: any) => React.createElement(React.Fragment, null, props.children),
}));
vi.mock('@/components/sessions/actions/SessionHeaderActionMenu', () => ({
  SessionHeaderActionMenu: () => null,
}));
vi.mock('@/components/voice/surface/VoiceSurface', () => ({
  VoiceSurface: () => null,
}));
vi.mock('@/components/sessions/attachments/AttachmentFilePicker', () => ({
  AttachmentFilePicker: () => null,
}));

vi.mock('@/components/sessions/files/useSessionFileUploadAvailability', () => ({
  useSessionFileUploadAvailability: () => attachmentsTransferAvailableState.value,
}));

const featureEnabledState: Record<string, boolean> = {
  voice: false,
  'files.reviewComments': false,
  'execution.runs': false,
  'attachments.uploads': false,
};
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
  useFeatureEnabled: (featureId: string, scope?: { scopeKind?: string; serverId?: string | null }) => {
    if (featureId === 'attachments.uploads' && attachmentsFeatureScopeState.enabledForServerId != null) {
      return scope?.scopeKind === 'spawn' && scope.serverId === attachmentsFeatureScopeState.enabledForServerId;
    }
    return featureEnabledState[featureId] === true;
  },
}));

vi.mock('@/utils/platform/responsive', () => ({
  getDeviceType: () => 'phone',
  useDeviceType: () => 'phone',
  useHeaderHeight: () => 0,
  useIsLandscape: () => false,
  useIsTablet: () => false,
}));
vi.mock('@/components/sessions/model/inactiveSessionUi', () => ({
  getInactiveSessionUiState: () => ({ noticeKind: 'none', inactiveStatusTextKey: null, shouldShowInput: true }),
}));
vi.mock('@/components/sessions/model/resolveSessionMachineReachability', () => ({
  resolveSessionMachineReachability: () => true,
}));
vi.mock(
  '@/components/sessions/model/useSessionMachineReachability',
  async (importOriginal) => {
    const {
      createReachableSessionMachineReachability,
      createSessionMachineReachabilityModuleMock,
    } = await import('@/dev/testkit/mocks/sessionMachineReachability');
    return createSessionMachineReachabilityModuleMock({
      importOriginal,
      overrides: {
        useSessionMachineReachability: createReachableSessionMachineReachability,
        useSessionReachableMachineTarget: () => ({ machineId: 'm1', basePath: '/tmp' }),
      },
    });
  },
);

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'server-1' }),
  subscribeActiveServer: () => () => {},
}));
vi.mock('@/voice/session/voiceSession', () => ({
  useVoiceSessionSnapshot: () => ({ status: 'disconnected' }),
  voiceSessionManager: {},
}));

vi.mock('@/sync/sync', async () => {
  const { createAcceptedExternalSessionTailCursorSyncBoundary } = await import('@/dev/testkit/mocks/sync');
  return {
    sync: {
      ...createAcceptedExternalSessionTailCursorSyncBoundary(),
      markSessionViewed: async () => {},
      materializeExistingSessionDraft: async () => {},
      patchSessionMetadataWithRetry: async () => {},
      fetchPendingMessages: async () => {},
      publishSessionPermissionModeToMetadata: async () => {},
      publishSessionAcpSessionModeOverrideToMetadata: async () => {},
      publishSessionAcpConfigOptionOverrideToMetadata: async () => {},
      publishSessionModelOverrideToMetadata: async () => {},
      refreshSessions: async () => {},
      onSessionVisible: () => {},
      sendMessage: async () => {},
      enqueuePendingMessage: async () => {},
      submitMessage: async () => {},
      encryption: {
        getMachineEncryption: () => null,
      },
    },
  };
});

vi.mock('@/sync/ops', async (importOriginal) => {
  const { createSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
  return createSyncOpsModuleMock({
    importOriginal,
    overrides: {
      sessionAbort: (...args: unknown[]) => sessionAbortMock(...args),
      resumeSession: vi.fn(),
      sessionSwitch: vi.fn(),
      sessionAttachmentsUploadFile: vi.fn(),
    },
  });
});

vi.mock('@/sync/ops/actions/defaultActionExecutor', () => ({
  createDefaultActionExecutor: () => ({ execute: vi.fn() }),
}));

vi.mock('@/components/sessions/agentInput', () => ({
  AgentInput: (props: any) => React.createElement('AgentInput', props),
}));

vi.mock('@/hooks/server/useAutomationsSupport', () => ({
  useAutomationsSupport: () => ({ enabled: false }),
}));

vi.mock('@/utils/system/versionUtils', () => ({
  isVersionSupported: () => true,
  MINIMUM_CLI_VERSION: '0.0.0',
}));

vi.mock('@/agents/catalog/catalog', () => ({
  AGENT_IDS: ['codex'],
  DEFAULT_AGENT_ID: 'codex',
  buildResumeSessionExtrasFromUiState: () => null,
  getAgentCore: () => ({
    cli: { detectKey: 'codex' },
    uiConnectedService: { serviceId: null, labelKey: 'agentInput.agent.codex', connectRoute: null },
    model: { defaultMode: 'default' },
    resume: { vendorResumeIdField: null },
    sessionModes: { kind: 'none' },
  }),
  getAgentResumeExperimentsFromSettings: () => null,
  getNewSessionRelevantInstallableDepKeys: () => [],
  isBundledAgentId: (value: unknown) => value === 'codex',
  resolveAgentIdFromFlavor: () => 'codex',
}));

vi.mock('@/agents/hooks/useResumeCapabilityOptions', () => ({
  useResumeCapabilityOptions: () => ({}),
}));
vi.mock('@/agents/runtime/resumeCapabilities', () => ({
  canResumeSessionWithOptions: () => true,
  getAgentVendorResumeId: () => '',
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useMachineCapabilitiesCache: () => ({ state: { status: 'loaded', snapshot: { response: { results: [] } } } }),
    prefetchMachineCapabilities: vi.fn(),
    getMachineCapabilitiesSnapshot: vi.fn(),
  };
});
vi.mock('@/utils/sessions/sessionUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    // The loaded shell reads the session status once per render: this counts its renders.
    useSessionStatus: () => {
      shellRenders.count += 1;
      return { statusText: '', statusColor: '#000', statusDotColor: '#000' };
    },
    shouldShowAbortButtonForSessionState: () => false,
    getSessionAvatarId: () => '1',
    getSessionName: () => 'Session',
    listPendingPermissionRequests: () => [],
    listPendingUserActionRequests: () => [],
    formatPathRelativeToHome: () => '',
    getSessionSubtitle: () => '',
  };
});
vi.mock('@/utils/platform/platform', () => ({
  isRunningOnMac: () => false,
}));
vi.mock('@/utils/system/fireAndForget', () => ({
  fireAndForget: (p: any) => {
    pendingWork.push(Promise.resolve(p));
  },
}));
vi.mock('@/sync/domains/input/slashCommands/resolveSessionComposerSend', () => ({
  resolveSessionComposerSend: resolveSessionComposerSendMock,
}));
vi.mock('@/sync/domains/input/slashCommands/executeSessionComposerResolution', () => ({
  executeSessionComposerResolution: executeSessionComposerResolutionMock,
}));
vi.mock('@/sync/domains/session/control/submitMode', () => ({
  chooseSubmitMode: () => 'direct',
}));
vi.mock('@/sync/domains/session/control/localControlSwitch', () => ({
  shouldRenderChatTimelineForSession: () => true,
  shouldRequestRemoteControl: () => false,
  shouldRequestRemoteControlAfterPendingEnqueue: () => false,
}));
vi.mock('@/sync/domains/sessionControl/sessionModeControl', () => ({
  supportsSessionModeOverrides: () => false,
}));
vi.mock('@/sync/domains/automations/automationSessionLink', () => ({
  countEnabledAutomationDefinitionsLinkedToSession: () => 0,
}));
vi.mock('@/agents/backendCatalog/getResolvedBackendCatalogEntries', () => ({
  getResolvedBackendCatalogEntries: () => [],
  resolveCatalogAgentIdForBackendTarget: () => null,
  resolveBackendTargetOperationalAgentId: () => null,
}));

const { SessionView } = await import('./SessionView');
const { getSessionDraftSnapshot, resetSessionDraftRepositoryForTests } = await import('@/sync/ops/sessionDrafts/sessionDraftRepository');

function surfaceElement() {
  return (
    <AppPaneProvider>
      <SessionView id="s1" routeServerId="server-1" surfaceFocusedOverride surfaceVisibleOverride />
    </AppPaneProvider>
  );
}

function findAgentInput(screen: Awaited<ReturnType<typeof renderScreen>>) {
  const inputs = screen.tree.findAllByType('AgentInput' as any);
  return inputs[inputs.length - 1]!;
}

async function typeCharacters(screen: Awaited<ReturnType<typeof renderScreen>>, from: string, text: string) {
  let typed = from;
  for (const character of text) {
    typed += character;
    const next = typed;
    await renderer.act(async () => {
      findAgentInput(screen).props.onChangeText(next);
    });
  }
  return typed;
}

function storedDraftText(): unknown {
  return getSessionDraftSnapshot(accountBinding.scope, { kind: 'session', sessionId: 's1' })
    ?.document.composer.text.value;
}

afterEach(() => {
  resetSessionDraftRepositoryForTests();
  shellRenders.count = 0;
  pendingWork.length = 0;
  resolveSessionComposerSendMock.mockClear();
});

describe('SessionView composer typing', () => {
  it('keeps typing out of the loaded shell while the draft persists, restores and submits', async () => {
    const screen = await renderScreen(surfaceElement());
    expect(screen.tree.findAllByType('AgentInput' as any)).toHaveLength(1);

    // The first characters may change what the shell shows (the draft becomes dirty).
    const first = await typeCharacters(screen, '', 'hello');
    const rendersAfterFirstBurst = shellRenders.count;

    // Steady typing is the input's business alone.
    const typed = await typeCharacters(screen, first, ' world, typed');
    expect(shellRenders.count - rendersAfterFirstBurst).toBe(0);
    expect(findAgentInput(screen).props.value).toBe('hello world, typed');
    expect(storedDraftText()).toBe(typed);

    // Submit reads the text on screen now, not a render-time snapshot.
    await renderer.act(async () => {
      findAgentInput(screen).props.onSend();
    });
    await renderer.act(async () => {
      while (pendingWork.length > 0) await pendingWork.shift();
    });
    expect(resolveSessionComposerSendMock).toHaveBeenCalledWith(expect.objectContaining({ input: typed }));

    // Reopening the Session restores the draft into the input.
    await screen.unmount();
    const reopened = await renderScreen(surfaceElement());
    expect(findAgentInput(reopened).props.value).toBe(typed);
    await reopened.unmount();
  });
});
