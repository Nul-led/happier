import { systemTasks } from '@happier-dev/cli-common';
import {
  ensureHappierCliPathExposure,
  removeHappierCliPathExposure,
  resolveFirstPartyInstallLayout,
} from '@happier-dev/cli-common/firstPartyRuntime';

type CliPathExposureDeps = Readonly<{
  processEnv: NodeJS.ProcessEnv;
}>;

export function resolveManagedCliBinDir(processEnv: NodeJS.ProcessEnv): string {
  return resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv }).shimDir;
}

/**
 * Settings actions: "Add happier to PATH" / "Remove". Local setup calls the same cli-common owner
 * while it works, where a failure stays quiet and never gates readiness; here the user asked for
 * this specific change, so a failure IS the result and is reported as a task error.
 */
export function createCliPathExposureEnsureHandler(overrides: Partial<CliPathExposureDeps> = {}) {
  const processEnv = overrides.processEnv ?? process.env;
  return systemTasks.createExecutionRunnerFromKind({
    async run(ctx) {
      systemTasks.parseDaemonServiceTaskParams(ctx.params);
      const result = await ensureHappierCliPathExposure({
        binDir: resolveManagedCliBinDir(processEnv),
        processEnv,
      });
      if (result.failure) {
        throw new systemTasks.SystemTaskExecutionError('cli_path_exposure_failed', result.failure);
      }
      return result;
    },
  });
}

export function createCliPathExposureRemoveHandler(overrides: Partial<CliPathExposureDeps> = {}) {
  const processEnv = overrides.processEnv ?? process.env;
  return systemTasks.createExecutionRunnerFromKind({
    async run(ctx) {
      systemTasks.parseDaemonServiceTaskParams(ctx.params);
      const result = await removeHappierCliPathExposure({ processEnv });
      if (result.failure) {
        throw new systemTasks.SystemTaskExecutionError('cli_path_exposure_failed', result.failure);
      }
      return result;
    },
  });
}
