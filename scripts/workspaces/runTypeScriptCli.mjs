import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareTypeScriptProjectBuildFromArgs } from './prepareTypeScriptProjectBuild.mjs';
import {
  resolveTypeScriptCliInvocation,
  shouldRouteTypeScriptCliThroughHstack,
} from './resolveTypeScriptCliInvocation.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const args = process.argv.slice(2);
if (shouldRouteTypeScriptCliThroughHstack({ args, env: process.env })) {
  const launcher = resolve(repoRoot, 'apps', 'stack', 'bin', 'hstack-exec');
  const scriptFromWorkspace = relative(process.cwd(), fileURLToPath(import.meta.url));
  const routedResult = spawnSync(launcher, ['--', 'node', scriptFromWorkspace, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (routedResult.error) throw routedResult.error;
  process.exit(routedResult.status ?? 1);
}

const invocation = resolveTypeScriptCliInvocation({
  repoRoot,
  workspaceDir: process.cwd(),
  processExecPath: process.execPath,
});
prepareTypeScriptProjectBuildFromArgs(args, { cwd: process.cwd() });

const result = spawnSync(invocation.command, [...invocation.argsPrefix, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
