import { chmod, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { resolveWindowsCommandInvocation } from '@happier-dev/cli-common/process';

import { resolveCliRuntimeAssetPath } from '@/runtime/assets/resolveCliRuntimeAssetPath';
import { ensureJavaScriptRuntimeExecutable } from '@/runtime/js/ensureJavaScriptRuntimeExecutable';
import { buildMissingJavaScriptRuntimeMessage } from '@/runtime/js/buildMissingJavaScriptRuntimeMessage';
import { isBun } from '@/utils/runtime';

export type TerminalSpawn = Readonly<{
  spawnArgv: readonly string[];
  spawnEnv: Readonly<Record<string, string>>;
  launchSpecPath?: string;
  cleanupUnreadArtifacts?: () => Promise<void>;
}>;

export type TerminalLaunchSpec = Readonly<{
  command: string;
  args: readonly string[];
  windowsVerbatimArguments?: boolean;
  inheritStderr?: boolean;
  cwd: string;
  env: Readonly<Record<string, string>>;
  envPassthroughKeys?: readonly string[];
  cleanupPaths?: readonly string[];
  diagnostics?: Readonly<{ sessionId: string; logsDir: string; sessionExitDir: string }>;
}>;

export async function writeTerminalLaunchSpec(spec: TerminalLaunchSpec): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'happier-terminal-launch-'));
  const path = join(dir, 'launch.json');
  try {
    await writeFile(path, JSON.stringify(spec), { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    return path;
  } catch (error) {
    await unlink(path).catch(() => undefined);
    await rmdir(dir).catch(() => undefined);
    throw error;
  }
}

export function createUnreadTerminalArtifactsCleanup(params: Readonly<{
  launchSpecPath: string;
  cleanup?: () => Promise<void>;
}>): () => Promise<void> {
  let cleanup: Promise<void> | null = null;
  return () => {
    cleanup ??= (async () => {
      await unlink(params.launchSpecPath).catch(() => undefined);
      const dir = dirname(params.launchSpecPath);
      if (basename(dir).startsWith('happier-terminal-launch-')) await rmdir(dir).catch(() => undefined);
      await params.cleanup?.();
    })();
    return cleanup;
  };
}

/** Keep the exact child environment in the process boundary, never in the one-shot file. */
export async function prepareOwnedTerminalSpawn(params: Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}>): Promise<TerminalSpawn> {
  const runtime = await ensureJavaScriptRuntimeExecutable({ isBunRuntime: isBun(), processEnv: params.env });
  if (!runtime) throw new ReferenceError(buildMissingJavaScriptRuntimeMessage('Owned terminal launcher'));
  const env = Object.fromEntries(Object.entries(params.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const invocation = resolveWindowsCommandInvocation({ command: params.command, args: [...params.args], env, resolveCommandOnPath: false });
  const launchSpecPath = await writeTerminalLaunchSpec({
    command: invocation.command,
    args: invocation.args,
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    cwd: params.cwd,
    env: {},
    inheritStderr: true,
    envPassthroughKeys: Object.keys(env),
  });
  return {
    spawnArgv: [runtime, resolveCliRuntimeAssetPath('scripts', 'terminal_launch_spec_runner.cjs'), launchSpecPath],
    spawnEnv: env,
    launchSpecPath,
    cleanupUnreadArtifacts: createUnreadTerminalArtifactsCleanup({ launchSpecPath }),
  };
}
