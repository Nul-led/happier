import {
  runSetupMachineRecipe,
  SystemTaskExecutionError,
  type InteractiveSystemTaskKind,
  type SetupMachineRecipeExecutor,
} from '@happier-dev/cli-common/systemTasks';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { normalizeBootstrapChannel } from '../taskRuntime.js';

import {
  createLocalSetupRecipeExecutor,
  readLocalActiveRelayProfile,
  readLocalSetupCliAcquisition,
  type LocalSetupCliAcquisition,
  type LocalSetupRelayProfile,
} from './localSetupExecutor.js';
import { requestTokenOnlyPairingApproval } from './tokenOnlyPairingApproval.js';

export type SetupRepairThisComputerParams = Readonly<{
  /** Relay/server URL the background service must connect to. Absent: the CLI's current relay profile. */
  activeRelayUrl?: string;
  /** Webapp URL for the active relay. Defaults to `activeRelayUrl`. */
  activeWebappUrl?: string;
  activeLocalRelayUrl?: string | null;
  channel?: 'stable' | 'preview' | 'dev' | 'publicdev';
  surface?: string;
}>;

export type SetupRepairThisComputerInteractiveDeps = Readonly<{
  readActiveRelayProfile: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => Promise<LocalSetupRelayProfile>;
  createRecipeExecutor: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => SetupMachineRecipeExecutor;
  /**
   * Which `happier` CLI will perform the repair and how it was acquired. Only `managed` is
   * approved for pairing without asking; any other provenance is confirmed by a human who is
   * shown the resolved command (R8/R13).
   */
  readCliAcquisition: (params: Readonly<{ releaseRing?: PublicReleaseRingId }>) => LocalSetupCliAcquisition;
}>;

const REPAIR_PARAM_KEYS = ['activeRelayUrl', 'activeWebappUrl', 'activeLocalRelayUrl', 'channel', 'surface'] as const;

function parseSetupRepairThisComputerParams(params: unknown): SetupRepairThisComputerParams {
  if (params == null) {
    return {};
  }
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new SystemTaskExecutionError('invalid_params', 'Invalid setup repair params.');
  }
  const record = params as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(REPAIR_PARAM_KEYS as readonly string[]).includes(key))) {
    throw new SystemTaskExecutionError('invalid_params', 'Unsupported setup repair params.');
  }
  const readOptionalString = (key: typeof REPAIR_PARAM_KEYS[number]): string | undefined => {
    const value = record[key];
    if (value == null) return undefined;
    if (typeof value !== 'string') {
      throw new SystemTaskExecutionError('invalid_params', 'Invalid setup repair params.');
    }
    return value.trim() || undefined;
  };
  const activeRelayUrl = readOptionalString('activeRelayUrl');
  const activeWebappUrl = readOptionalString('activeWebappUrl');
  const activeLocalRelayUrl = readOptionalString('activeLocalRelayUrl');
  const channel = readOptionalString('channel');
  const surface = readOptionalString('surface');
  if (channel !== undefined && channel !== 'stable' && channel !== 'preview' && channel !== 'dev' && channel !== 'publicdev') {
    throw new SystemTaskExecutionError('invalid_params', `Unsupported channel: ${channel}`);
  }
  // R3, same rule and same reason as `setup.thisComputer.v1`: a desktop surface must name the Home
  // it selected. Falling back to the CLI's own currently selected relay would repoint this
  // machine's daemon at whatever the terminal happened to be configured for. Every TS producer
  // already sends it; a terminal repair run has no app selection and keeps the ambient fallback.
  if (surface === 'desktop.ui' && !activeRelayUrl) {
    throw new SystemTaskExecutionError(
      'invalid_params',
      'activeRelayUrl is required for surface desktop.ui.',
    );
  }
  return {
    ...(activeRelayUrl ? { activeRelayUrl } : {}),
    ...(activeWebappUrl ? { activeWebappUrl } : {}),
    ...(activeLocalRelayUrl ? { activeLocalRelayUrl } : {}),
    ...(channel ? { channel } : {}),
    ...(surface ? { surface } : {}),
  };
}

/**
 * Local drift/needs-auth repair: the same canonical local-machine recipe as `setup.thisComputer.v1`
 * (configure the explicit relay → pair → install → start → prove readiness) without the guided
 * service-conflict preflight, on the repair step ids. Pairing is approved through the same blocking
 * token-only prompt the desktop approval owner already answers for local setup; a missing token-only
 * material or a declined answer fails with a named error instead of waiting on nothing.
 */
/**
 * `createRecipeExecutor` is the gateway to every mutating CLI operation this kind performs
 * (relay repoint, pairing, credential write, service install/start). It has **no default**, so a
 * construction that forgets it is a compile error rather than a silent run against the developer's
 * real machine. The two read-only deps keep their defaults.
 */
export type SetupRepairThisComputerInteractiveDepsInput =
  Pick<SetupRepairThisComputerInteractiveDeps, 'createRecipeExecutor'>
  & Partial<Omit<SetupRepairThisComputerInteractiveDeps, 'createRecipeExecutor'>>;

/** The one production composition of the mutating dep; `hsetup` passes it explicitly. */
export function createProductionSetupRepairThisComputerInteractiveDeps(): Pick<
  SetupRepairThisComputerInteractiveDeps,
  'createRecipeExecutor'
> {
  return { createRecipeExecutor: createLocalSetupRecipeExecutor };
}

export function createSetupRepairThisComputerInteractiveTaskKind(
  overrides: SetupRepairThisComputerInteractiveDepsInput,
): InteractiveSystemTaskKind<Readonly<{ machineId: string }>> {
  const deps: SetupRepairThisComputerInteractiveDeps = {
    readActiveRelayProfile: readLocalActiveRelayProfile,
    readCliAcquisition: readLocalSetupCliAcquisition,
    ...overrides,
  };

  return {
    async run(ctx) {
      const parsed = parseSetupRepairThisComputerParams(ctx.params);
      const releaseRing = parsed.channel ? normalizeBootstrapChannel(parsed.channel).releaseChannel : undefined;
      const relayProfile: LocalSetupRelayProfile = parsed.activeRelayUrl
        ? {
          serverUrl: parsed.activeRelayUrl,
          webappUrl: parsed.activeWebappUrl ?? parsed.activeRelayUrl,
          localServerUrl: parsed.activeLocalRelayUrl ?? null,
        }
        : await deps.readActiveRelayProfile({ releaseRing });

      ctx.emit({
        type: 'step',
        stepId: 'setup.repairThisComputer.prepare',
        message: 'Repairing this computer',
        data: {
          relayUrl: relayProfile.serverUrl,
          webappUrl: relayProfile.webappUrl,
          ...(relayProfile.localServerUrl ? { activeLocalRelayUrl: relayProfile.localServerUrl } : {}),
          ...(parsed.surface ? { surface: parsed.surface } : {}),
        },
      });

      const recipeResult = await runSetupMachineRecipe({
        relayProfile,
        executor: deps.createRecipeExecutor({ releaseRing }),
        stepIds: {
          configureRelay: 'setup.repairThisComputer.configureRelay',
          authRequest: 'setup.repairThisComputer.authRequest',
          authWait: 'setup.repairThisComputer.authenticate',
          installService: 'setup.repairThisComputer.installService',
          startService: 'setup.repairThisComputer.startService',
          verifyService: 'setup.repairThisComputer.waitForReady',
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
          const decision = await requestTokenOnlyPairingApproval({
            ctx,
            stepId: 'setup.repairThisComputer.authRequest',
            message: 'Approve pairing request',
            publicKey: inner.publicKey,
            requestPayload: inner.requestPayload,
            target: relayProfile,
            cli: deps.readCliAcquisition({ ...(releaseRing ? { releaseRing } : {}) }),
          });
          if (decision === null) {
            throw new SystemTaskExecutionError(
              'pairing_approval_unavailable',
              'The Happier CLI did not provide token-only pairing material, so this computer cannot be approved automatically.',
            );
          }
          if (!decision.approved) {
            // The approval owner's own reason, so a relay mismatch or an unreadable credential is
            // not reported as a human decline.
            throw new SystemTaskExecutionError(
              'approval_declined',
              decision.reason
                ? `Pairing request was not approved (${decision.reason}).`
                : 'Pairing request was not approved.',
            );
          }
        },
        daemonReadinessErrorMessage: 'Background service did not reach a ready state for the selected Relay.',
      });

      const daemonMachineId = recipeResult.daemonStatus?.machineId?.trim() || null;
      if (!daemonMachineId) {
        throw new SystemTaskExecutionError(
          'daemon_service_not_ready',
          'Background service did not reach a ready state for the selected Relay.',
        );
      }

      ctx.emit({ type: 'progress', stepId: 'setup.repairThisComputer.finish', message: 'Repair complete' });
      return { machineId: daemonMachineId };
    },
  };
}
