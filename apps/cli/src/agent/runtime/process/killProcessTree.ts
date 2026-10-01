import { createRequire } from 'node:module';
import {
  execFileWithDeadline,
  isPidPresent,
  probeProcessGroupLiveness,
} from '@happier-dev/cli-common/process';
import psList from 'ps-list';

import { resolveCliRuntimeAssetPath } from '@/packagedRuntime/assets/resolveCliRuntimeAssetPath';
import { taskkillWindowsProcessTree } from '@/subprocess/supervision/taskkillWindowsProcessTree';
import { logger } from '@/ui/logger';

type ProcessTreeRoot = Readonly<{
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
}>;
type ProcessTreeOptions = Readonly<{
  graceMs?: number;
  terminateWindowsTree?: typeof taskkillWindowsProcessTree;
  /** The caller created and still owns a dedicated POSIX process group whose id is pid.
   * Completion proves owned-group containment, not absence of descendants which left it. */
  ownedProcessGroup?: boolean;
}>;
type ProcessTreeAdapters = Readonly<{
  psList: typeof psList;
  execFileWithDeadline: typeof execFileWithDeadline;
  isPidPresent: typeof isPidPresent;
  probeProcessGroupLiveness: typeof probeProcessGroupLiveness;
  taskkillWindowsProcessTree: typeof taskkillWindowsProcessTree;
}>;

// One shipped CJS owner is consumed by both the CLI and its surviving terminal launcher.
const moduleOwner = createRequire(import.meta.url)(resolveCliRuntimeAssetPath('scripts', 'process_tree.cjs')) as {
  createProcessTreeOwner(adapters: ProcessTreeAdapters): {
    killProcessTree(proc: ProcessTreeRoot, opts?: ProcessTreeOptions): Promise<void>;
  };
};
const owner = moduleOwner.createProcessTreeOwner({
  psList, execFileWithDeadline, isPidPresent, probeProcessGroupLiveness, taskkillWindowsProcessTree,
});

export async function killProcessTree(proc: ProcessTreeRoot, opts?: ProcessTreeOptions): Promise<void> {
  try {
    await owner.killProcessTree(proc, opts);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'plugin_exec_termination_incomplete') {
      logger.infoFile('[process-tree] Owned process cleanup could not be verified', {
        code: 'plugin_exec_termination_incomplete',
      });
    }
    throw error;
  }
}
