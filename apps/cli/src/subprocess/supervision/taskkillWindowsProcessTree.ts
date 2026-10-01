import { createRequire } from 'node:module';

import { windowsSystemToolCommand } from '@happier-dev/cli-common/process';
import { resolveCliRuntimeAssetPath } from '@/packagedRuntime/assets/resolveCliRuntimeAssetPath';

/** Process-spawn boundary; injected in tests so no real `taskkill` is ever invoked. */
export type TaskkillExecFile = (command: string, args: readonly string[]) => Promise<unknown>;

type TaskkillInput = Readonly<{ pid: number; force: boolean; execFile?: TaskkillExecFile }>;
const owner = createRequire(import.meta.url)(resolveCliRuntimeAssetPath('scripts', 'process_tree.cjs')) as {
  taskkillWindowsProcessTree(input: TaskkillInput, resolveCommand: typeof windowsSystemToolCommand): Promise<void>;
};

export async function taskkillWindowsProcessTree(input: TaskkillInput): Promise<void> {
  await owner.taskkillWindowsProcessTree(input, windowsSystemToolCommand);
}
