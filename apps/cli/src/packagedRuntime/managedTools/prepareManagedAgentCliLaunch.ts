import type { AgentCliInstallPlatform } from '@happier-dev/agents';
import {
  prepareAgentCliForRuntime,
  type AgentCliRuntimeDescriptor,
  type ManagedAgentCliPreparation,
  type ManagedAgentCliPreparationErrorCode,
  type ManagedAgentCliResolution,
} from '@happier-dev/cli-common/agents';

import { isBun } from '../../utils/runtime';
import {
  buildAgentCliLaunchSpecFromResolution,
  type AgentCliLaunchSpec,
} from './agentCliLaunchSpec';

export type ManagedAgentCliLaunchPreparationErrorCode =
  | ManagedAgentCliPreparationErrorCode
  | 'managed-launch-unavailable';

export type ManagedAgentCliLaunchPreparation =
  | Readonly<{
      ok: true;
      /** The exact executable this preparation installed or validated. */
      resolution: ManagedAgentCliResolution;
      /** That same resolution as the launch the runtime consumes unchanged. */
      launch: AgentCliLaunchSpec;
      alreadyInstalled: boolean;
      logPath: string | null;
    }>
  | Readonly<{
      ok: false;
      errorCode: ManagedAgentCliLaunchPreparationErrorCode;
      errorMessage: string;
      logPath: string | null;
    }>;

/**
 * Prepares one Agent CLI under the strict request-scoped `managed_only` source
 * policy and returns the launch built from that exact resolution.
 *
 * The temporary-computer Runner installs into its activation-local
 * `HAPPIER_HOME_DIR` after endpoint consent, then launches the returned spec
 * through the canonical retained-launch path
 * (`bindAgentCliLaunchSpec` → the retained Agent CLI system tool). Nothing here
 * resolves the executable a second time, so an endpoint override, system or
 * global install cannot substitute itself between readiness and launch.
 */
export async function prepareManagedAgentCliLaunch(params: Readonly<{
  runtimeSpec: AgentCliRuntimeDescriptor;
  platform: AgentCliInstallPlatform;
  processEnv: NodeJS.ProcessEnv;
  logDir?: string | null;
  signal?: AbortSignal;
  deps?: Parameters<typeof prepareAgentCliForRuntime>[0]['deps'];
}>): Promise<ManagedAgentCliLaunchPreparation> {
  const prepared: ManagedAgentCliPreparation = await prepareAgentCliForRuntime({
    runtimeSpec: params.runtimeSpec,
    platform: params.platform,
    sourcePolicy: 'managed_only',
    env: params.processEnv,
    logDir: params.logDir,
    signal: params.signal,
    isBunRuntime: isBun(),
    currentExecPath: process.execPath,
    ...(params.deps ? { deps: params.deps } : {}),
  });
  if (!prepared.ok) {
    return {
      ok: false,
      errorCode: prepared.errorCode,
      errorMessage: prepared.errorMessage,
      logPath: prepared.logPath,
    };
  }

  const launch = buildAgentCliLaunchSpecFromResolution(prepared.resolution, {
    processEnv: params.processEnv,
  });
  if (!launch) {
    return {
      ok: false,
      errorCode: 'managed-launch-unavailable',
      errorMessage:
        `${params.runtimeSpec.id} resolved a managed executable that cannot be launched in this runtime; its required JavaScript runtime is unavailable.`,
      logPath: prepared.logPath,
    };
  }

  return {
    ok: true,
    resolution: prepared.resolution,
    launch,
    alreadyInstalled: prepared.alreadyInstalled,
    logPath: prepared.logPath,
  };
}
