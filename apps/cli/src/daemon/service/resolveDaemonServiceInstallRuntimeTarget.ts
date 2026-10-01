import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';

import {
  readDefaultManagedReleaseChannel,
  readHappierCliChoiceSync,
  resolveDesiredShimTargets,
  resolveInstalledFirstPartyComponentPaths,
} from '@happier-dev/cli-common/firstPartyRuntime';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { resolveRunningCliPackageManagerOrigin, resolveThisCliNpmPackageName } from '@/cli/runtime/update/cliUpdateFacts';
import { buildMissingJavaScriptRuntimeMessage } from '@/packagedRuntime/js/buildMissingJavaScriptRuntimeMessage';
import { ensureJavaScriptRuntimeExecutable } from '@/packagedRuntime/js/ensureJavaScriptRuntimeExecutable';

import type { DaemonServiceTargetMode } from './plan';
import { resolveDaemonServiceRuntimeTarget } from './runtimeTarget';

async function resolveManagedReleaseChannelShimPath(params: Readonly<{
  channel: PublicReleaseRingId;
  processEnv: NodeJS.ProcessEnv;
}>): Promise<string | null> {
  const defaultShimPath = (await resolveDesiredShimTargets({
    componentId: 'happier-daemon',
    channel: params.channel,
    processEnv: params.processEnv,
  }))[0]?.shimPath ?? resolveInstalledFirstPartyComponentPaths({
    componentId: 'happier-daemon',
    channel: params.channel,
    processEnv: params.processEnv,
  }).shimPaths[0];
  if (!defaultShimPath) {
    return null;
  }

  try {
    await access(defaultShimPath);
    return defaultShimPath;
  } catch {
    return null;
  }
}

async function resolveDefaultFollowingManagedShimPath(processEnv: NodeJS.ProcessEnv): Promise<string | null> {
  const defaultReleaseChannel = await readDefaultManagedReleaseChannel({ processEnv });
  return await resolveManagedReleaseChannelShimPath({
    channel: defaultReleaseChannel,
    processEnv,
  });
}

/**
 * The managed shim a service of this target runs when nothing overrides it: the default channel's
 * shim for the default-following service, the channel shim for a pinned one. `null` when that shim
 * is not installed, or when this computer chose to keep its own CLI (plan R12): the service then
 * runs the CLI that installs it, so a copy the managed layout still holds is never the expected
 * runtime and no switch to it is proposed.
 */
export async function resolveManagedDaemonServiceShimPath(params: Readonly<{
  targetMode: DaemonServiceTargetMode;
  channel?: PublicReleaseRingId | null;
  processEnv: NodeJS.ProcessEnv;
}>): Promise<string | null> {
  if (readHappierCliChoiceSync({ processEnv: params.processEnv })?.mode === 'own') {
    return null;
  }
  if (params.targetMode === 'default-following') {
    return await resolveDefaultFollowingManagedShimPath(params.processEnv);
  }
  return params.channel
    ? await resolveManagedReleaseChannelShimPath({ channel: params.channel, processEnv: params.processEnv })
    : null;
}

/**
 * The version-stable launcher of a Homebrew-installed CLI: the running executable through
 * Homebrew's opt prefix (`<prefix>/opt/<formula>/…`, a link to the active keg). The executable
 * itself resolves into `Cellar/<formula>/<version>/`, which `brew upgrade` cleans up, so a service
 * recording it would stop starting after the next upgrade. `null` for any other install.
 *
 * Both the resolution's exec path and this process's are read: the drift check resolves the
 * expected definition from the service runtime's JS runtime path (a managed node, when present),
 * while the Homebrew CLI running the check is what the service launches.
 */
function resolveHomebrewDaemonServiceLauncher(currentExecPath: string): string | null {
  const origin = resolveRunningCliPackageManagerOrigin({
    invokedPath: currentExecPath,
    execPath: process.execPath,
    npmPackageName: resolveThisCliNpmPackageName(),
  });
  const optPath = origin?.kind === 'brew' ? origin.optPath : null;
  return optPath && existsSync(optPath) ? optPath : null;
}

export async function resolveDaemonServiceInstallRuntimeTarget(options: Readonly<{
  currentExecPath?: string | null;
  explicitNodePath?: string | null;
  explicitEntryPath?: string | null;
  allowBootstrap?: boolean;
  targetMode?: DaemonServiceTargetMode;
  channel?: PublicReleaseRingId | null;
  processEnv?: NodeJS.ProcessEnv;
}> = {}): Promise<Readonly<{
  nodePath: string;
  entryPath: string;
}>> {
  const currentExecPath = options.currentExecPath ?? process.execPath;
  const explicitNodePath = String(options.explicitNodePath ?? '').trim();
  const explicitEntryPath = String(options.explicitEntryPath ?? '').trim();
  const allowBootstrap = options.allowBootstrap ?? true;
  const targetMode: DaemonServiceTargetMode = options.targetMode ?? 'pinned';
  const processEnv = options.processEnv ?? process.env;

  if (!explicitNodePath && !explicitEntryPath) {
    const managedShimPath = await resolveManagedDaemonServiceShimPath({
      targetMode,
      channel: options.channel,
      processEnv,
    });
    if (managedShimPath) {
      return resolveDaemonServiceRuntimeTarget({
        currentExecPath,
        explicitNodePath: managedShimPath,
      });
    }
    // Like the managed shim, a Homebrew CLI's service launches the CLI binary itself, through the
    // path that survives `brew upgrade`.
    const homebrewLauncher = resolveHomebrewDaemonServiceLauncher(currentExecPath);
    if (homebrewLauncher) {
      return resolveDaemonServiceRuntimeTarget({
        currentExecPath,
        explicitNodePath: homebrewLauncher,
      });
    }
  }

  if (!allowBootstrap && !explicitNodePath && !explicitEntryPath) {
    throw new ReferenceError('Daemon service runtime bootstrap is disabled for this resolution');
  }

  const runtimeExecutable = explicitNodePath
    ? null
    : await ensureJavaScriptRuntimeExecutable({
        isBunRuntime: false,
        currentExecPath,
        processEnv,
    });

  if (!explicitNodePath && !runtimeExecutable && !explicitEntryPath) {
    throw new ReferenceError(buildMissingJavaScriptRuntimeMessage('Daemon service installation'));
  }

  return resolveDaemonServiceRuntimeTarget({
    currentExecPath,
    runtimeExecutable,
    explicitNodePath,
    explicitEntryPath,
  });
}
