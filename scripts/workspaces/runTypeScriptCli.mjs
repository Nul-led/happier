import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitWithCommandResult, runCommand } from '../../apps/stack/scripts/utils/proc/proc.mjs';

import { prepareTypeScriptProjectBuildFromArgs } from './prepareTypeScriptProjectBuild.mjs';
import {
  resolveTypeScriptCliInvocation,
  shouldRouteTypeScriptCliThroughHstack,
} from './resolveTypeScriptCliInvocation.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const args = process.argv.slice(2);
// Automatic command placement is POSIX-only; Windows compilation stays local.
if (process.platform !== 'win32' && shouldRouteTypeScriptCliThroughHstack({ args, env: process.env })) {
  const launcher = resolve(repoRoot, 'apps', 'stack', 'bin', 'hstack-exec');
  const scriptFromWorkspace = relative(process.cwd(), fileURLToPath(import.meta.url));
  const routedResult = await runCommand(launcher, ['--', 'node', scriptFromWorkspace, ...args], {
    ownedProcessGroup: true,
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  exitWithCommandResult(routedResult);
} else {
  const invocation = resolveTypeScriptCliInvocation({
    repoRoot,
    workspaceDir: process.cwd(),
    processExecPath: process.execPath,
  });
  prepareTypeScriptProjectBuildFromArgs(args, { cwd: process.cwd() });

  const result = await runCommand(invocation.command, [...invocation.argsPrefix, ...args], {
    ownedProcessGroup: true,
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  exitWithCommandResult(result);
}
