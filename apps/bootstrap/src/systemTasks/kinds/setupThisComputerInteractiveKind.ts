import {
  applyBackgroundServiceSetupGuidance,
  type BackgroundServiceSetupGuidanceCancellationReason,
  createLocalHappierJsonExecutor,
  ensureLocalFirstPartyComponentCommand,
  formatBackgroundServiceManualRelayTakeoverPrompt,
  formatBackgroundServiceReleaseChannelSwitchPrompt,
  formatBackgroundServiceReplacementPrompt,
  resolveBackgroundServiceSetupServicesRequiringReplacement,
  readBackgroundServiceSetupGuidance,
  runSetupMachineRecipe,
  SystemTaskExecutionError,
  type BackgroundServiceSetupGuidance,
  type InteractiveSystemTaskKind,
  type SetupMachineRecipeExecutor,
} from '@happier-dev/cli-common/systemTasks';
import { readMachineDaemonOwnershipMetadataFromSocketAuth, type MachineDaemonOwnershipMetadata } from '@happier-dev/protocol';
import {
  ensureHappierCliPathExposure,
  syncInstalledFirstPartyShims,
  writeDefaultManagedReleaseChannel,
  type HappierCliPathExposureResult,
} from '@happier-dev/cli-common/firstPartyRuntime';
import {
  resolveCliInvokerNameForPublicRing,
  type PublicReleaseRingId,
} from '@happier-dev/release-runtime/releaseRings';

import { normalizeBootstrapChannel } from '../taskRuntime.js';

import {
  createLocalSetupRecipeExecutor,
  readLocalActiveRelayProfile,
  readLocalSetupCliAcquisition,
  type LocalSetupCliAcquisition,
  type LocalSetupRelayProfile,
} from './localSetupExecutor.js';
import { resolveManagedCliBinDir } from './cliPathExposure.js';
import { requestTokenOnlyPairingApproval } from './tokenOnlyPairingApproval.js';

type SetupThisComputerRelayProfile = LocalSetupRelayProfile;

type CommandDiagnostics = Readonly<{
  command: string;
  args: readonly string[];
  details?: string;
}>;

function createBackgroundServiceSetupCancellationError(
  cancellationReason: BackgroundServiceSetupGuidanceCancellationReason | null,
): SystemTaskExecutionError {
  if (cancellationReason === 'declined_release_channel_switch') {
    return new SystemTaskExecutionError(
      'background_service_release_channel_switch_declined',
      'Setup was cancelled because the default release channel was kept unchanged.',
    );
  }
  if (cancellationReason === 'declined_manual_relay_takeover') {
    return new SystemTaskExecutionError(
      'background_service_manual_relay_takeover_declined',
      'Setup was cancelled because the current manual relay runtime was kept.',
    );
  }
  return new SystemTaskExecutionError(
    'background_service_conflict_declined',
    'Setup was cancelled because existing background services were kept.',
  );
}

function emitCommandDiagnostics(
  ctx: Readonly<{
    emit: (event: Readonly<{
      type: string;
      stepId?: string;
      message?: string;
      data?: unknown;
    }>) => void;
  }>,
  params: Readonly<{
    stepId: string;
    message: string;
    diagnostics: CommandDiagnostics;
  }>,
): void {
  ctx.emit({
    type: 'progress',
    stepId: params.stepId,
    message: params.message,
    data: {
      command: params.diagnostics.command,
      args: params.diagnostics.args,
      ...(params.diagnostics.details ? { details: params.diagnostics.details } : {}),
    },
  });
}

function createInstrumentedRecipeExecutor(
  ctx: Readonly<{
    emit: (event: Readonly<{
      type: string;
      stepId?: string;
      message?: string;
      data?: unknown;
    }>) => void;
  }>,
  params: Readonly<{
    takeOverManualRelayRuntime?: boolean;
    releaseRing?: PublicReleaseRingId;
  }>,
  recipeExecutor: SetupMachineRecipeExecutor,
): SetupMachineRecipeExecutor {
  const takeoverArgs = params.takeOverManualRelayRuntime === true ? ['--takeover'] : [];
  const commandInvoker = resolveCliInvokerNameForPublicRing(params.releaseRing ?? 'stable');
  const requestAuthPairing = recipeExecutor.requestAuthPairing;
  const waitForAuthPairing = recipeExecutor.waitForAuthPairing;
  if (!requestAuthPairing || !waitForAuthPairing) {
    throw new SystemTaskExecutionError(
      'invalid_setup_executor',
      'Local setup requires the canonical pairing request and wait operations.',
    );
  }
  return {
    ...recipeExecutor,
    async configureRelay(profile) {
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.configureRelay',
        message: `Running ${commandInvoker} server set --json`,
        diagnostics: {
          command: commandInvoker,
          args: [
            'server',
            'set',
            '--server-url',
            profile.serverUrl,
            ...(profile.localServerUrl ? ['--local-server-url', profile.localServerUrl] : []),
            '--webapp-url',
            profile.webappUrl,
            '--json',
          ],
        },
      });
      await recipeExecutor.configureRelay(profile);
    },
    async readAuthStatus() {
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.checkAuth',
        message: `Running ${commandInvoker} auth status --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['auth', 'status', '--json'],
        },
      });
      return await recipeExecutor.readAuthStatus();
    },
    async requestAuthPairing() {
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.auth.request',
        message: `Running ${commandInvoker} auth request --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['auth', 'request', '--json'],
        },
      });
      return await requestAuthPairing();
    },
    async waitForAuthPairing(publicKey) {
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.auth.wait',
        message: `Running ${commandInvoker} auth wait --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['auth', 'wait', '--public-key', '[redacted]', '--json'],
          details: publicKey ? 'Waiting for the local pairing request to be approved.' : undefined,
        },
      });
      return await waitForAuthPairing(publicKey);
    },
    async approveAuthPairing(publicKey) {
      if (!recipeExecutor.approveAuthPairing) {
        return;
      }
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.auth.request',
        message: `Running ${commandInvoker} auth approve --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['auth', 'approve', '--public-key', '[redacted]', '--json'],
          details: publicKey ? 'Approving the local pairing request for this computer.' : undefined,
        },
      });
      await recipeExecutor.approveAuthPairing(publicKey);
    },
    async installDaemonService() {
      if (!recipeExecutor.installDaemonService) {
        return;
      }
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.installService',
        message: `Running ${commandInvoker} service install${takeoverArgs.length > 0 ? ' --takeover' : ''} --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['service', 'install', ...takeoverArgs, '--json'],
        },
      });
      await recipeExecutor.installDaemonService();
    },
    async startDaemonService() {
      if (!recipeExecutor.startDaemonService) {
        return;
      }
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.startService',
        message: `Running ${commandInvoker} service start${takeoverArgs.length > 0 ? ' --takeover' : ''} --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['service', 'start', ...takeoverArgs, '--json'],
        },
      });
      await recipeExecutor.startDaemonService();
    },
    async waitForReadyDaemon(params) {
      if (!recipeExecutor.waitForReadyDaemon) {
        return {
          serviceInstalled: false,
          daemonRunning: false,
          needsAuth: true,
          machineId: null,
        };
      }
      emitCommandDiagnostics(ctx, {
        stepId: 'setup.thisComputer.verifyService',
        message: `Polling ${commandInvoker} daemon status --json`,
        diagnostics: {
          command: commandInvoker,
          args: ['daemon', 'status', '--json'],
          details: 'Checking whether the background service is installed, running, and authenticated for the selected Relay.',
        },
      });
      return await recipeExecutor.waitForReadyDaemon(params);
    },
  };
}

export type SetupThisComputerInteractiveParams = Readonly<{
  surface?: string;
  target?: string;
  channel?: 'stable' | 'preview' | 'dev' | 'publicdev';
  activeRelayUrl?: string;
  activeWebappUrl?: string;
  activeLocalRelayUrl?: string | null;
  installService?: boolean;
  startService?: boolean;
  verifyService?: boolean;
}>;

export type SetupThisComputerInteractiveDeps = Readonly<{
  /**
   * Acquires the managed `happier` CLI and reports which command was resolved and how. Only a
   * `managed` acquisition is approved for pairing without asking (R13); any other provenance is
   * confirmed by a human who is shown the resolved command (R8).
   */
  ensureLocalHappierTools: (params: Readonly<{ releaseChannel?: PublicReleaseRingId }>) => Promise<LocalSetupCliAcquisition>;
  readActiveRelayProfile: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => Promise<SetupThisComputerRelayProfile>;
  createRecipeExecutor: (params: Readonly<{
    releaseRing?: PublicReleaseRingId;
    takeOverManualRelayRuntime?: boolean;
  }>) => SetupMachineRecipeExecutor;
  readBackgroundServiceSetupGuidance: (params: Readonly<{
    targetReleaseChannel: PublicReleaseRingId;
    targetServerUrl: string;
    currentRelayOwner?: Pick<MachineDaemonOwnershipMetadata, 'serviceManaged' | 'publicReleaseChannel' | 'cliVersion'> | null;
  }>) => Promise<BackgroundServiceSetupGuidance>;
  readCurrentRelayOwner: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => Promise<Pick<
    MachineDaemonOwnershipMetadata,
    'serviceManaged' | 'publicReleaseChannel' | 'cliVersion'
  > | null>;
  switchDefaultReleaseChannel: (releaseChannel: PublicReleaseRingId) => Promise<void>;
  uninstallExistingDaemonServices: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => Promise<void>;
  /** Makes `happier` resolve in a new terminal. Ancillary: never gates readiness (see `run`). */
  exposeHappierCliOnPath: () => Promise<HappierCliPathExposureResult>;
}>;

/**
 * The deps whose real implementation mutates this machine: it installs the managed CLI, spawns the
 * CLI operations that rewrite the relay profile, credentials and OS service, rewrites the default
 * release channel, uninstalls existing services, or edits the user's shell startup files. They have
 * **no default**, so a construction that forgets one is a compile error rather than a silent run
 * against the developer's real machine. Read-only deps keep their defaults.
 */
type MutatingSetupThisComputerDepName =
  | 'ensureLocalHappierTools'
  | 'createRecipeExecutor'
  | 'switchDefaultReleaseChannel'
  | 'uninstallExistingDaemonServices'
  | 'exposeHappierCliOnPath';

export type SetupThisComputerInteractiveDepsInput =
  Pick<SetupThisComputerInteractiveDeps, MutatingSetupThisComputerDepName>
  & Partial<Omit<SetupThisComputerInteractiveDeps, MutatingSetupThisComputerDepName>>;

export function createSetupThisComputerInteractiveTaskKind(
  overrides: SetupThisComputerInteractiveDepsInput,
): InteractiveSystemTaskKind<Readonly<{ machineId: string }>> {
  const deps = createSetupThisComputerInteractiveDeps(overrides);

  return {
    async run(ctx) {
      const parsed = parseSetupThisComputerInteractiveParams(ctx.params);
      const releaseRing = parsed.channel ? normalizeBootstrapChannel(parsed.channel).releaseChannel : undefined;
      ctx.emit({
        type: 'progress',
        stepId: 'setup.thisComputer.ensureCli',
        message: 'Installing Happier tools',
      });
      const cli = await deps.ensureLocalHappierTools({ releaseChannel: releaseRing });
      ctx.emit({
        type: 'progress',
        stepId: 'setup.thisComputer.resolveRelay',
        message: 'Resolving server configuration',
      });
      const relayProfile = resolveExplicitRelayProfile(parsed) ?? await deps.readActiveRelayProfile({ releaseRing });
      let shouldTakeOverManualRelayRuntime = false;
      if (parsed.installService !== false) {
        const targetReleaseChannel = releaseRing ?? 'stable';
        const currentRelayOwner = await deps.readCurrentRelayOwner({ releaseRing });
        const guidance = await deps.readBackgroundServiceSetupGuidance({
          targetReleaseChannel,
          targetServerUrl: relayProfile.serverUrl,
          currentRelayOwner,
        });

        const guidanceResult = await applyBackgroundServiceSetupGuidance({
          guidance,
          promptSwitchDefaultReleaseChannel: async () => {
            const answer = await ctx.prompt({
              kind: 'releaseChannel.switchDefaultForSetup',
              stepId: 'setup.thisComputer.preflight.releaseChannel',
              message: formatBackgroundServiceReleaseChannelSwitchPrompt(guidance),
              data: {
                targetReleaseChannel: guidance.targetReleaseChannel,
                currentDefaultReleaseChannel: guidance.currentDefaultReleaseChannel,
                targetServerUrl: guidance.targetServerUrl,
                managedReleaseChannels: guidance.managedReleaseChannels,
              },
            }) as { switchDefaultReleaseChannel?: boolean };
            return answer.switchDefaultReleaseChannel === true;
          },
          promptTakeOverManualRelayRuntime: async () => {
            const answer = await ctx.prompt({
              kind: 'daemon.takeOverManualRelayRuntimeForSetup',
              stepId: 'setup.thisComputer.preflight.manualRelayTakeover',
              message: formatBackgroundServiceManualRelayTakeoverPrompt(guidance),
              data: {
                targetServerUrl: guidance.targetServerUrl,
                targetReleaseChannel: guidance.targetReleaseChannel,
                currentReleaseChannel: guidance.manualRelayOwner?.currentReleaseChannel ?? null,
                currentCliVersion: guidance.manualRelayOwner?.currentCliVersion ?? null,
              },
            }) as { takeOverManualRelayRuntime?: boolean };
            return answer.takeOverManualRelayRuntime === true;
          },
          promptReplaceExistingServices: async () => {
            const answer = await ctx.prompt({
              kind: 'daemon.replaceLocalBackgroundServices',
              stepId: 'setup.thisComputer.preflight.serviceConflict',
              message: formatBackgroundServiceReplacementPrompt(guidance),
              data: {
                targetServerUrl: guidance.targetServerUrl,
                targetReleaseChannel: guidance.targetReleaseChannel,
                services: resolveBackgroundServiceSetupServicesRequiringReplacement(guidance),
              },
            }) as { replaceExistingServices?: boolean };
            return answer.replaceExistingServices === true;
          },
          switchDefaultReleaseChannel: async () => {
            ctx.emit({
              type: 'progress',
              stepId: 'setup.thisComputer.preflight.releaseChannel',
              message: 'Updating the default managed release channel',
              data: {
                details: `Switching the default managed release channel to ${targetReleaseChannel} and syncing the matching Happier terminal command.`,
              },
            });
            await deps.switchDefaultReleaseChannel(targetReleaseChannel);
          },
          takeOverManualRelayRuntime: async () => {
            shouldTakeOverManualRelayRuntime = true;
          },
          replaceExistingServices: async () => {
            emitCommandDiagnostics(ctx, {
              stepId: 'setup.thisComputer.preflight.serviceConflict',
              message: `Running ${resolveCliInvokerNameForPublicRing(releaseRing ?? 'stable')} service uninstall --all --yes --json`,
              diagnostics: {
                command: resolveCliInvokerNameForPublicRing(releaseRing ?? 'stable'),
                args: ['service', 'uninstall', '--all', '--yes', '--json'],
              },
            });
            await deps.uninstallExistingDaemonServices({ releaseRing });
          },
        });

        if (guidanceResult.cancelled) {
          throw createBackgroundServiceSetupCancellationError(guidanceResult.cancellationReason);
        }

        shouldTakeOverManualRelayRuntime = guidanceResult.tookOverManualRelayRuntime;
      }

      // Terminal exposure edits the user's shell startup files — the one write this task makes
      // outside Happier's own directories — so it starts only once consent has settled (D4/R12):
      // a declined conflict prompt must not leave a Desktop PATH line behind.
      //
      // From here it runs beside the remaining service work and nothing waits for it (R6/L6): the
      // app starts its readiness proof from this task's result, so awaiting a shell-profile write
      // would hold the reveal — and a wedged `powershell.exe` or a hung append on a network home
      // would hold it forever. The failure is reported on this run's own event stream just before
      // the result when it has settled by then (the common case, against seconds of pairing and
      // service work); machine settings › Terminal owns reading and repairing PATH either way,
      // through the `cli.pathExposure.*` kinds.
      const pathExposure = observePathExposure(deps.exposeHappierCliOnPath());

      const recipeExecutor = createInstrumentedRecipeExecutor(
        ctx,
        { releaseRing, takeOverManualRelayRuntime: shouldTakeOverManualRelayRuntime },
        deps.createRecipeExecutor({
          releaseRing,
          takeOverManualRelayRuntime: shouldTakeOverManualRelayRuntime,
        }),
      );

      // The recipe configures the explicit relay before it reads auth status and pairs, so the
      // terminal always targets the Home that is being approved.
      const recipeResult = await runSetupMachineRecipe({
        relayProfile,
        executor: recipeExecutor,
        steps: {
          installService: parsed.installService,
          startService: parsed.startService,
          verifyService: parsed.verifyService,
        },
        stepIds: {
          configureRelay: 'setup.thisComputer.configureRelay',
          authWait: 'setup.thisComputer.auth.wait',
          installService: 'setup.thisComputer.installService',
          startService: 'setup.thisComputer.startService',
          verifyService: 'setup.thisComputer.verifyService',
        },
        signal: ctx.signal,
        emit(event) {
          ctx.emit({
            type: 'progress',
            stepId: event.stepId,
            ...(event.message ? { message: event.message } : {}),
          });
        },
        approvePairingRequest: async (inner) => {
          // One blocking approval: the answering UI posts the opaque token-only response to the
          // explicit Home endpoint with its own Home-scoped bearer and answers without any
          // credential material. The terminal claim independently mints its own token.
          const decision = await requestTokenOnlyPairingApproval({
            ctx,
            stepId: 'setup.thisComputer.auth.request',
            message: 'Approve this computer in Happier to continue',
            publicKey: inner.publicKey,
            requestPayload: inner.requestPayload,
            target: relayProfile,
            cli,
          });
          // Both outcomes fail by name, exactly as local repair does. There is no second,
          // non-blocking approval surface to fall back to: nothing reads such a prompt, so
          // emitting one only replaced a named failure with a silent wait for the executor
          // timeout, and a declined approval must stop the run rather than proceed unpaired.
          if (decision === null) {
            throw new SystemTaskExecutionError(
              'pairing_approval_unavailable',
              'The Happier CLI did not provide token-only pairing material, so this computer cannot be approved automatically.',
            );
          }
          if (!decision.approved) {
            throw new SystemTaskExecutionError('approval_declined', describePairingRefusal(decision.reason));
          }
        },
        daemonReadinessErrorMessage: 'Background service did not reach a ready state for the selected Relay.',
      });

      const machineId = recipeResult.machineId;
      if (!machineId) {
        throw new SystemTaskExecutionError(
          'machine_id_unavailable',
          'Authenticated server session did not expose a machineId for this computer.',
        );
      }

      const pathExposureFailure = pathExposure.readFailure();
      if (pathExposureFailure) {
        // No stepId: this is not a step of the setup sequence, and the PATH surface that owns the
        // outcome is `cli.pathExposure.*`. The message still reaches the run's latest message.
        ctx.emit({
          type: 'progress',
          message: `Could not add happier to your PATH: ${pathExposureFailure}`,
        });
      }

      return { machineId };
    },
  };
}

/**
 * The user-facing half of a refused approval. The approval owner names *why* it refused; only one
 * of those reasons is an actual human decline, so the message says which it was.
 */
function describePairingRefusal(reason: string | null): string {
  return reason
    ? `This computer was not approved for pairing (${reason}).`
    : 'This computer was not approved for pairing.';
}

/**
 * Watches an ancillary promise without ever awaiting it, so its outcome can be reported if it has
 * settled by the time the task finishes and simply dropped if it has not. Rejections are read as
 * failures here because a shell-profile write must never fail this task.
 */
function observePathExposure(
  exposure: Promise<HappierCliPathExposureResult>,
): Readonly<{ readFailure: () => string | null }> {
  let failure: string | null = null;
  void exposure.then(
    (outcome) => {
      failure = outcome.failure;
    },
    (error: unknown) => {
      failure = error instanceof Error && error.message.trim() ? error.message.trim() : 'PATH exposure failed.';
    },
  );
  return { readFailure: () => failure };
}

function parseSetupThisComputerInteractiveParams(params: unknown): SetupThisComputerInteractiveParams {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new SystemTaskExecutionError('invalid_params', 'Expected setup params to be an object.');
  }
  const record = params as Record<string, unknown>;
  const parsed: {
    surface?: string;
    target?: string;
    channel?: SetupThisComputerInteractiveParams['channel'];
    activeRelayUrl?: string;
    activeWebappUrl?: string;
    activeLocalRelayUrl?: string | null;
    installService?: boolean;
    startService?: boolean;
    verifyService?: boolean;
  } = {
    surface: typeof record.surface === 'string' ? record.surface : undefined,
    target: typeof record.target === 'string' ? record.target : undefined,
  };
  if ('channel' in record) {
    if (typeof record.channel !== 'string') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected channel to be a string.');
    }
    const channel = record.channel.trim().toLowerCase();
    if (channel !== 'stable' && channel !== 'preview' && channel !== 'dev' && channel !== 'publicdev') {
      throw new SystemTaskExecutionError('invalid_params', `Unsupported channel: ${record.channel}`);
    }
    parsed.channel = channel as SetupThisComputerInteractiveParams['channel'];
  }
  if ('activeRelayUrl' in record) {
    if (typeof record.activeRelayUrl !== 'string') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected activeRelayUrl to be a string.');
    }
    const activeRelayUrl = record.activeRelayUrl.trim();
    if (!activeRelayUrl) {
      throw new SystemTaskExecutionError('invalid_params', 'activeRelayUrl cannot be empty.');
    }
    parsed.activeRelayUrl = activeRelayUrl;
  }
  if ('activeWebappUrl' in record) {
    if (typeof record.activeWebappUrl !== 'string') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected activeWebappUrl to be a string.');
    }
    const activeWebappUrl = record.activeWebappUrl.trim();
    if (!activeWebappUrl) {
      throw new SystemTaskExecutionError('invalid_params', 'activeWebappUrl cannot be empty.');
    }
    parsed.activeWebappUrl = activeWebappUrl;
  }
  if ('activeLocalRelayUrl' in record) {
    parsed.activeLocalRelayUrl = record.activeLocalRelayUrl == null
      ? null
      : String(record.activeLocalRelayUrl).trim() || null;
  }
  if (parsed.activeRelayUrl && !parsed.activeWebappUrl) {
    throw new SystemTaskExecutionError('invalid_params', 'activeWebappUrl is required when activeRelayUrl is provided.');
  }
  if (parsed.activeWebappUrl && !parsed.activeRelayUrl) {
    throw new SystemTaskExecutionError('invalid_params', 'activeRelayUrl is required when activeWebappUrl is provided.');
  }
  // R3: a desktop surface must name the Home it selected. The ambient fallback below reads the
  // CLI's own currently selected relay, which for `desktop.ui` would silently repoint this
  // machine's daemon at whatever the terminal happened to be configured for instead of the Home
  // the app is setting up. The app always sends it, so a spec that omits it is malformed rather
  // than a case to guess at. A terminal `hsetup` run has no app selection and keeps the fallback.
  if (parsed.surface === 'desktop.ui' && !parsed.activeRelayUrl) {
    throw new SystemTaskExecutionError(
      'invalid_params',
      'activeRelayUrl is required for surface desktop.ui.',
    );
  }
  if ('installService' in record) {
    if (typeof record.installService !== 'boolean') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected installService to be a boolean.');
    }
    parsed.installService = record.installService;
  }
  if ('startService' in record) {
    if (typeof record.startService !== 'boolean') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected startService to be a boolean.');
    }
    parsed.startService = record.startService;
  }
  if ('verifyService' in record) {
    if (typeof record.verifyService !== 'boolean') {
      throw new SystemTaskExecutionError('invalid_params', 'Expected verifyService to be a boolean.');
    }
    parsed.verifyService = record.verifyService;
  }
  return parsed;
}

function resolveExplicitRelayProfile(params: SetupThisComputerInteractiveParams): SetupThisComputerRelayProfile | null {
  if (!params.activeRelayUrl || !params.activeWebappUrl) {
    return null;
  }
  return {
    serverUrl: params.activeRelayUrl,
    webappUrl: params.activeWebappUrl,
    localServerUrl: params.activeLocalRelayUrl ?? null,
  };
}

function createSetupThisComputerInteractiveDeps(
  overrides: SetupThisComputerInteractiveDepsInput,
): SetupThisComputerInteractiveDeps {
  return {
    readActiveRelayProfile: readLocalActiveRelayProfile,
    readBackgroundServiceSetupGuidance: async ({ targetReleaseChannel, targetServerUrl, currentRelayOwner }) => readBackgroundServiceSetupGuidance({
      targetReleaseChannel,
      targetServerUrl,
      currentRelayOwner,
      mode: 'user',
    }),
    readCurrentRelayOwner: async ({ releaseRing }) => {
      const executor = createLocalHappierJsonExecutor({ releaseRing });
      const parsed = await executor.runHappierJson(['service', 'status', '--json'], {
        allowJsonFailure: true,
      });
      const owner = parsed && typeof parsed === 'object'
        ? (parsed as { owner?: unknown }).owner
        : null;
      const normalized = readMachineDaemonOwnershipMetadataFromSocketAuth(owner);
      return normalized.serviceManaged === undefined
        && normalized.publicReleaseChannel === undefined
        && normalized.cliVersion === undefined
        ? null
        : normalized;
    },
    ...overrides,
  };
}

/**
 * The one production composition of the mutating deps. `hsetup` passes this explicitly, so the real
 * installer, CLI executor, release-channel writer, service uninstaller and shell-profile writer are
 * only ever reachable through a named production wiring — never through an omitted test stub.
 */
export function createProductionSetupThisComputerInteractiveDeps(): Pick<
  SetupThisComputerInteractiveDeps,
  MutatingSetupThisComputerDepName
> {
  return {
    ensureLocalHappierTools: async ({ releaseChannel }) => {
      await ensureLocalFirstPartyComponentCommand({
        componentId: 'happier-cli',
        processEnv: process.env,
        releaseRing: releaseChannel,
      });
      await syncInstalledFirstPartyShims({
        componentId: 'happier-cli',
        channel: releaseChannel,
        processEnv: process.env,
      });
      return readLocalSetupCliAcquisition({ ...(releaseChannel ? { releaseRing: releaseChannel } : {}) });
    },
    createRecipeExecutor: createLocalSetupRecipeExecutor,
    switchDefaultReleaseChannel: async (releaseChannel) => {
      await writeDefaultManagedReleaseChannel({
        processEnv: process.env,
        releaseChannel,
      });
      await syncInstalledFirstPartyShims({
        componentId: 'happier-cli',
        channel: releaseChannel,
        processEnv: process.env,
      });
    },
    uninstallExistingDaemonServices: async ({ releaseRing }) => {
      const executor = createLocalHappierJsonExecutor({ releaseRing });
      await executor.runHappierJson(['service', 'uninstall', '--all', '--yes', '--json']);
    },
    exposeHappierCliOnPath: async () => await ensureHappierCliPathExposure({
      binDir: resolveManagedCliBinDir(process.env),
      processEnv: process.env,
    }),
  };
}
