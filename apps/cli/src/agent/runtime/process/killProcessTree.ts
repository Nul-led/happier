import { createRequire } from 'node:module';
import psList from 'ps-list';

import { resolveCliRuntimeAssetPath } from '@/runtime/assets/resolveCliRuntimeAssetPath';
import { logger } from '@/ui/logger';

type ProcessTreeRoot = Readonly<{ pid?: number }>;
type ProcessTreeOptions = Readonly<{ graceMs?: number }>;

// The launcher cannot import CLI TypeScript. This shipped sidecar keeps both callers
// on one cleanup algorithm, with ps-list as the same injectable OS boundary.
const owner = createRequire(import.meta.url)(resolveCliRuntimeAssetPath('scripts', 'process_tree.cjs')) as {
  killProcessTree: (proc: ProcessTreeRoot, opts: ProcessTreeOptions | undefined, enumerate: typeof psList) => Promise<void>;
};

export async function killProcessTree(proc: ProcessTreeRoot, opts?: ProcessTreeOptions): Promise<void> {
  try {
    await owner.killProcessTree(proc, opts, psList);
  } catch (error) {
    // Existing best-effort callers may catch cleanup rejection. Keep this outcome
    // observable at its canonical owner without exposing OS errors or terminal noise.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'process_tree_termination_incomplete') {
      logger.infoFile('[process-tree] Owned process cleanup could not be verified', {
        code: 'process_tree_termination_incomplete',
      });
    }
    throw error;
  }
}
