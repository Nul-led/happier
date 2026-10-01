import {
  isAgentCliPathRunnable,
  resolveAgentCliJavaScriptRuntimeCommand,
} from '@happier-dev/cli-common/agents';

export type {
  AgentCliCommandResolution,
  AgentCliResolutionSource,
  AgentCliSourcePolicy,
} from '@happier-dev/cli-common/agents';
export {
  readBackendCliSourcePreference,
  readAgentCliOverride,
  readAgentCliOverrideForRuntime,
  resolveAgentCliCommand,
  resolveAgentCliCommandForRuntime,
  resolveAgentCliManagedCommandPath,
} from '@happier-dev/cli-common/agents';

export async function isAgentCliPathRunnableOnDaemonPath(path: string): Promise<boolean> {
  return isAgentCliPathRunnable(path, process.env, {
    isBunRuntime: typeof process.versions.bun === 'string', currentExecPath: process.execPath,
  });
}

export async function resolveAgentCliJavaScriptRuntimeOnDaemonPath(path: string): Promise<string | null> {
  return resolveAgentCliJavaScriptRuntimeCommand(path, process.env, {
    isBunRuntime: typeof process.versions.bun === 'string', currentExecPath: process.execPath,
  });
}
