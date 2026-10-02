import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type ManagedDependencyLaunchDeclaration = Readonly<{
  overrideEnvironmentKey: string;
  configOverridesEnvironmentKey: string;
  configOverrideArgument: string;
}>;

export type ManagedDependencyCommand = Readonly<{ command: string; args: readonly string[] }>;

export function validateManagedDependencyCommand(
  spec: ManagedDependencyCommand,
  binaryName: string,
  opts: Readonly<{
    env?: Readonly<Record<string, string | undefined>>;
    existsSyncFn?: typeof existsSync;
    accessSyncFn?: typeof accessSync;
  }> = {},
): Readonly<{ ok: true }> | Readonly<{ ok: false; errorMessage: string }> {
  const env = opts.env ?? process.env;
  const exists = opts.existsSyncFn ?? existsSync;
  const access = opts.accessSyncFn ?? accessSync;
  const runnable = (path: string) => {
    try {
      if (!exists(path)) return false;
      access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (spec.command === binaryName) {
    const names = process.platform === 'win32' ? [`${binaryName}.cmd`, `${binaryName}.exe`, binaryName] : [binaryName];
    return (env.PATH ?? '').split(delimiter).some((entry) => entry.trim() && names.some((name) => runnable(join(entry.trim(), name))))
      ? { ok: true }
      : { ok: false, errorMessage: `${binaryName} is not available on PATH` };
  }
  if (!exists(spec.command)) return { ok: false, errorMessage: `Resolved command does not exist: ${spec.command}` };
  return runnable(spec.command)
    ? { ok: true }
    : { ok: false, errorMessage: `Resolved command is not executable: ${spec.command}` };
}

export function resolveManagedDependencyCommand(input: Readonly<{
  binaryName: string;
  displayName: string;
  declaration: ManagedDependencyLaunchDeclaration;
  env?: Readonly<Record<string, string | undefined>>;
  currentWorkingDirectory?: string;
  resolveExistingManagedBinPath?: (env: Readonly<Record<string, string | undefined>>) => string | null;
}>): ManagedDependencyCommand {
  const env = input.env ?? process.env;
  const override = env[input.declaration.overrideEnvironmentKey]?.trim();
  const command = override
    ? isAbsolute(override) ? override : resolve(input.currentWorkingDirectory ?? process.cwd(), override)
    : input.resolveExistingManagedBinPath?.(env) ?? input.binaryName;
  if (override) {
    const availability = validateManagedDependencyCommand({ command, args: [] }, input.binaryName, { env });
    if (!availability.ok) {
      const reason = existsSync(command) ? 'is not executable' : 'does not exist';
      throw new Error(`${input.displayName} is enabled but ${input.declaration.overrideEnvironmentKey} ${reason}: ${command}`);
    }
  }
  const args = (env[input.declaration.configOverridesEnvironmentKey] ?? '')
    .split('\n').map((line) => line.trim()).filter(Boolean)
    .flatMap((value) => [input.declaration.configOverrideArgument, value]);
  return { command, args };
}
