import { validateManagedDependencyCommand } from '@happier-dev/plugin-sdk/managed-services/native';
import { CODEX_ACP_MANAGED_DEPENDENCY } from '../installables/definition.js';

export type CodexAcpSpawnSpec = Readonly<{ command: string; args: readonly string[] }>;
export type CodexAcpAvailabilityResult = Readonly<{ ok: true }> | Readonly<{ ok: false; errorMessage: string }>;

export function validateCodexAcpSpawnAvailability(
  spec: CodexAcpSpawnSpec,
  opts: Parameters<typeof validateManagedDependencyCommand>[2] = {},
): CodexAcpAvailabilityResult {
  return validateManagedDependencyCommand(spec, CODEX_ACP_MANAGED_DEPENDENCY.executable, opts);
}
