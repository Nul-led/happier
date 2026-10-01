import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveCliRuntimeAssetPath } from '@/packagedRuntime/assets/resolveCliRuntimeAssetPath';
import { requireJavaScriptRuntimeExecutable } from '@/packagedRuntime/js/requireJavaScriptRuntimeExecutable';
import { isBun } from '@/utils/runtime';

function ignoreMissingFile(error: unknown): void {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
}

export type TerminalLaunchSpec = Readonly<{
  argv: readonly string[];
  specPath: string;
  discard(): Promise<void>;
}>;

export async function discardFailedTerminalLaunch(
  launch: Pick<TerminalLaunchSpec, 'discard'>,
  error: unknown,
): Promise<never> {
  try { await launch.discard(); }
  catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Terminal launch and private handoff cleanup failed');
  }
  throw error;
}

/** A one-shot private handoff to the binary-safe terminal launcher. Passthrough policy
 * belongs to the caller: a native Agent must not inherit Herdr's Happier-runner hooks. */
export async function createTerminalLaunchSpec(input: Readonly<{
  workingDirectory: string;
  spawnArgv: readonly string[];
  spawnEnv: Readonly<Record<string, string>>;
  envPassthroughKeys: readonly string[];
  windowsVerbatimArguments?: boolean;
}>): Promise<TerminalLaunchSpec> {
  const [command, ...args] = input.spawnArgv;
  if (!command) throw new Error('Terminal launch requires a command');
  const runtimeExecutable = await requireJavaScriptRuntimeExecutable({
    isBunRuntime: isBun(), targetLabel: 'Terminal launch',
  });
  const dir = await mkdtemp(join(tmpdir(), 'happier-terminal-launch-'));
  const specPath = join(dir, 'launch.json');
  const discard = async () => {
    await unlink(specPath).catch(ignoreMissingFile);
    await rmdir(dir).catch(ignoreMissingFile);
  };
  try {
    await writeFile(specPath, JSON.stringify({
      command, args, cwd: input.workingDirectory, env: input.spawnEnv,
      envPassthroughKeys: input.envPassthroughKeys,
      ...(input.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
    }), { mode: 0o600 });
  } catch (error) {
    return discardFailedTerminalLaunch({ discard }, error);
  }
  return {
    argv: [runtimeExecutable, resolveCliRuntimeAssetPath('scripts', 'terminal_launch_spec_runner.cjs'), specPath],
    specPath, discard,
  };
}
