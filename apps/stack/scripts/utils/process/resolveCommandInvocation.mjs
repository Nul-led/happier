import { resolveWindowsCommandInvocation } from '@happier-dev/cli-common/windowsCommandInvocation';

export function resolveCommandInvocation(params) {
  const command = String(params?.command ?? '').trim();
  const args = Array.isArray(params?.args) ? params.args.map((a) => String(a)) : [];
  // The running JS executable is already resolved and cannot be a command shim.
  // In particular, compiling cli-common itself must not require its dist first.
  if (process.platform !== 'win32' || command === process.execPath) return { command, args };
  const env = params?.env && typeof params.env === 'object' ? params.env : process.env;
  return resolveWindowsCommandInvocation({
    command,
    args,
    env,
    resolveCommandOnPath: true,
  });
}
