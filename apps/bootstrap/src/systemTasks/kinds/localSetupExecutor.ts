import {
  createLocalHappierJsonExecutor,
  createSetupMachineRecipeExecutorFromHappierJsonExecutor,
  DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
  resolveExplicitOrInstalledLocalFirstPartyCommand,
  SystemTaskExecutionError,
  type LocalFirstPartyCommandProvenance,
  type SetupMachineRecipeExecutor,
} from '@happier-dev/cli-common/systemTasks';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

export type LocalSetupRelayProfile = Readonly<{
  serverUrl: string;
  webappUrl: string;
  localServerUrl: string | null;
}>;

/**
 * The one local-machine recipe executor behind `setup.thisComputer.v1` and
 * `setup.repairThisComputer.v1`: every setup/repair step runs the managed `happier` CLI for the
 * selected release ring through the canonical JSON executor and its canonical status readers.
 */
export function createLocalSetupRecipeExecutor(params: Readonly<{
  releaseRing?: PublicReleaseRingId;
  takeOverManualRelayRuntime?: boolean;
}>): SetupMachineRecipeExecutor {
  return createSetupMachineRecipeExecutorFromHappierJsonExecutor({
    executor: createLocalHappierJsonExecutor({ releaseRing: params.releaseRing }),
    options: {
      takeOverManualRelayRuntime: params.takeOverManualRelayRuntime,
    },
  });
}

/** Reads the CLI's currently selected relay profile; used only when a task supplies no explicit target. */
export async function readLocalActiveRelayProfile(params: Readonly<{
  releaseRing?: PublicReleaseRingId;
}>): Promise<LocalSetupRelayProfile> {
  const executor = createLocalHappierJsonExecutor({ releaseRing: params.releaseRing });
  const parsed = await executor.runHappierJson(['server', 'current', '--json']);
  const active = parsed && typeof parsed === 'object'
    ? (parsed as { data?: { active?: Record<string, unknown> } }).data?.active
    : null;

  const serverUrl = typeof active?.serverUrl === 'string' ? active.serverUrl.trim() : '';
  const webappUrl = typeof active?.webappUrl === 'string' && active.webappUrl.trim()
    ? active.webappUrl.trim()
    : serverUrl;
  const localServerUrl = typeof active?.localServerUrl === 'string' && active.localServerUrl.trim()
    ? active.localServerUrl.trim()
    : null;

  if (!serverUrl || !webappUrl) {
    throw new SystemTaskExecutionError(
      'relay_configuration_unavailable',
      'Could not resolve the currently selected Relay configuration.',
    );
  }

  return { serverUrl, webappUrl, localServerUrl };
}

/**
 * Which `happier` CLI this local run will drive, and how it was acquired.
 *
 * Only a CLI the managed release path actually installed here may be approved for pairing
 * unattended (R13); an env or repo-local override is a development convenience that has been
 * through no release verification, and an unresolvable command is treated the same way. The
 * resolved command travels with the provenance because the person asked to vouch for a
 * non-managed CLI decides about a specific program on disk, not about the word "override" — one
 * read of one canonical resolver answers both, so the path shown can never describe a different
 * binary than the one that was classified.
 */
export type LocalSetupCliAcquisition = Readonly<{
  provenance: LocalFirstPartyCommandProvenance;
  /** The resolved command, or `null` when no CLI could be resolved at all. */
  command: string | null;
}>;

export function readLocalSetupCliAcquisition(params: Readonly<{
  releaseRing?: PublicReleaseRingId;
  processEnv?: NodeJS.ProcessEnv;
}>): LocalSetupCliAcquisition {
  const resolved = resolveExplicitOrInstalledLocalFirstPartyCommand({
    componentId: 'happier-cli',
    processEnv: params.processEnv ?? process.env,
    envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
    ...(params.releaseRing ? { releaseRing: params.releaseRing } : {}),
  });
  return {
    provenance: resolved?.provenance ?? 'override',
    command: resolved?.command ?? null,
  };
}
