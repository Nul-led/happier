import type { BackendTargetRefV2 } from '@happier-dev/protocol';
import type { TerminalHostHandle } from '@happier-dev/agents';

import { createDefaultTerminalHostAdapterInventory } from '@/integrations/terminal/host/defaultAdapters';
import { buildHappyCliSubprocessLaunchSpec, type HappyCliSubprocessLaunchOptions } from '@/utils/spawnHappyCLI';
import { SPAWN_SESSION_ERROR_CODES, type SpawnSessionOptions, type SpawnSessionResult } from '@/session/shared/spawnSessionContract';
import { buildTerminalMetadataFromHostHandle } from '@/terminal/runtime/terminalMetadata';
import type { ResolvedTerminalRequest } from '@/terminal/runtime/terminalConfig';
import {
  createTerminalAttachmentId,
  writeTerminalHostAttachmentInfo,
} from '@/terminal/attachment/terminalAttachmentInfo';

import { resolveDaemonCliSubcommandFromBackendTarget } from '../backendTargetRouting';
import type { RunnerAgentSessionBootstrapAuthorization } from '../agentRuntime/sessionBridgeAuthorization';
import type { ChildExit } from '../sessions/onChildExited';
import type { RunnerAgentInvocationContext, TrackedSession } from '../types';
import { buildSpawnChildProcessEnv } from './buildSpawnChildProcessEnv';
import { stripUnsetEnvironmentVariables } from '@/utils/processEnv/buildScopedProcessEnv';
import type { SpawnLifecycleCallbacks } from './createSpawnLifecycleCallbacks';
import type { PersistedTakeoverAdmissionWaitRegistration } from './persistedTakeoverAdmission';
import type { SpawnCommitRevalidation } from './spawnCommitRevalidation';
import { waitForTerminalHostedSessionWebhook } from './waitForTerminalHostedSessionWebhook';

export async function spawnAdapterHostedSessionAndWaitForWebhook(params: Readonly<{
  terminalRequest: ResolvedTerminalRequest;
  directory: string;
  trackedSpawnOptions: SpawnSessionOptions;
  normalizedExistingSessionId: string;
  sessionCreationOutcome?: TrackedSession['sessionCreationOutcome'];
  effectiveResume: string;
  effectiveBackendTargetV2: BackendTargetRefV2;
  sessionControlArgs: readonly string[];
  directoryCreated: boolean;
  extraEnvForChildWithMessage: Record<string, string>;
  unsetEnvKeys?: readonly string[];
  runnerAgentSessionBootstrapAuthorization?: RunnerAgentSessionBootstrapAuthorization | null;
  runnerAgentInvocationContext?: RunnerAgentInvocationContext | null;
  processEnv: NodeJS.ProcessEnv;
  happyHomeDir: string;
  pidToTrackedSession: Map<number, TrackedSession>;
  pidToAwaiter: Map<number, (session: TrackedSession) => void>;
  pidToSpawnResultResolver: Map<number, (result: SpawnSessionResult) => void>;
  pidToSpawnWebhookTimeout: Map<number, NodeJS.Timeout>;
  takeoverAdmission?: PersistedTakeoverAdmissionWaitRegistration;
  onChildExited: (pid: number, exit: ChildExit) => void | Promise<void>;
  spawnLifecycleCallbacks: SpawnLifecycleCallbacks;
  cleanupSpawnResources: () => void | Promise<void>;
  logDebug: (message: string, payload?: unknown) => void;
  warn: (message: string) => void;
  sanitizeDiagnosticText?: (value: string) => string;
  revalidateBeforeCommit?: SpawnCommitRevalidation;
  runnerLaunchOptions?: HappyCliSubprocessLaunchOptions;
}>): Promise<SpawnSessionResult | null> {
  if (params.terminalRequest.requested !== 'zellij' && params.terminalRequest.requested !== 'herdr') return null;
  const hostKind = params.terminalRequest.requested;
  const displayName = hostKind === 'zellij' ? 'Zellij' : 'Herdr';
  const sanitizeDiagnosticText = params.sanitizeDiagnosticText ?? ((value: string) => value);
  const agentCommand = resolveDaemonCliSubcommandFromBackendTarget(params.effectiveBackendTargetV2);
  if (!agentCommand) {
    return { type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST, errorMessage: 'Unknown backend target' };
  }

  const inventory = await createDefaultTerminalHostAdapterInventory({
    happyHomeDir: params.happyHomeDir,
    preference: hostKind,
  });
  const adapter = inventory.adapters[hostKind];
  if (!adapter) {
    await params.cleanupSpawnResources();
    await params.spawnLifecycleCallbacks.cleanupPendingSessionAttach();
    return {
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
      errorMessage: `${displayName} hosting requires a supported ${displayName} installation on this machine.`,
    };
  }

  const attachmentId = createTerminalAttachmentId();
  const terminalRuntimeArgs = [
    '--happy-terminal-mode', hostKind,
    '--happy-terminal-requested', hostKind,
    '--happy-terminal-attachment-id', attachmentId,
    ...(hostKind === 'herdr'
      ? ['--happy-herdr-session-name', params.terminalRequest.herdr.sessionName]
      : []),
  ];
  const args = [
    agentCommand,
    '--happy-starting-mode', 'local',
    '--started-by', 'daemon',
    ...terminalRuntimeArgs,
    ...params.sessionControlArgs,
  ];
  const launchSpec = buildHappyCliSubprocessLaunchSpec(args, params.runnerLaunchOptions ?? { preferWindowsPackagedBinary: true });
  const spawnEnv = stripUnsetEnvironmentVariables(buildSpawnChildProcessEnv({
    processEnv: params.processEnv,
    extraEnv: {
      ...params.extraEnvForChildWithMessage,
      ...(launchSpec.env ?? {}),
      HAPPIER_TERMINAL_ATTACHMENT_ID: attachmentId,
    },
    unsetEnvKeys: params.unsetEnvKeys,
  }), params.unsetEnvKeys);
  const commitRefusal = await params.revalidateBeforeCommit?.() ?? null;
  if (commitRefusal) return commitRefusal;

  const sessionName = hostKind === 'herdr'
    ? params.terminalRequest.herdr.sessionName
    : `happier-${agentCommand}-${Date.now()}`;
  let handle: TerminalHostHandle | null = null;
  try {
    handle = await adapter.createOrAttachHost({
      sessionName,
      workingDirectory: params.directory,
      spawnArgv: [launchSpec.filePath, ...launchSpec.args],
      spawnEnv,
      unsetEnvKeys: params.unsetEnvKeys,
      isolatedEnv: true,
    });
    const createdHandle = handle;
    const liveness = await adapter.evaluateLiveness(createdHandle);
    if (!liveness.panePid) throw new Error(`${displayName} did not report the launched runner PID`);
    const terminal = buildTerminalMetadataFromHostHandle(createdHandle);
    const spawnResult = await waitForTerminalHostedSessionWebhook({
      pid: liveness.panePid,
      label: hostKind,
      normalizedExistingSessionId: params.normalizedExistingSessionId,
      trackedSpawnOptions: params.trackedSpawnOptions,
      ...(params.sessionCreationOutcome ? { sessionCreationOutcome: params.sessionCreationOutcome } : {}),
      effectiveResume: params.effectiveResume,
      directoryCreated: params.directoryCreated,
      message: params.directoryCreated
        ? `The path '${params.directory}' did not exist. We created a new folder and spawned a new session in ${displayName}.`
        : `Spawned new session in ${displayName}.`,
      trackedSessionFields: { hostedTerminal: terminal },
      runnerAgentSessionBootstrapAuthorization: params.runnerAgentSessionBootstrapAuthorization,
      runnerAgentInvocationContext: params.runnerAgentInvocationContext,
      pidToTrackedSession: params.pidToTrackedSession,
      pidToAwaiter: params.pidToAwaiter,
      pidToSpawnResultResolver: params.pidToSpawnResultResolver,
      pidToSpawnWebhookTimeout: params.pidToSpawnWebhookTimeout,
      takeoverAdmission: params.takeoverAdmission,
      onChildExited: params.onChildExited,
      spawnLifecycleCallbacks: params.spawnLifecycleCallbacks,
      cleanupSpawnResources: params.cleanupSpawnResources,
      cancelOwnedHost: async () => {
        try {
          await adapter.dispose(createdHandle);
          return true;
        } catch {
          return false;
        }
      },
      bindCanonicalSession: async (canonicalSessionId) => {
        await writeTerminalHostAttachmentInfo({
          happyHomeDir: params.happyHomeDir,
          sessionId: canonicalSessionId,
          handle: { ...createdHandle, attachmentId },
        });
      },
      logDebug: params.logDebug,
      warn: params.warn,
      sanitizeDiagnosticText,
    });
    return spawnResult;
  } catch (error) {
    if (handle) await adapter.dispose(handle).catch(() => {});
    await params.cleanupSpawnResources();
    await params.spawnLifecycleCallbacks.cleanupPendingSessionAttach();
    return {
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
      errorMessage: `${displayName} runner launch failed: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
    };
  }
}
