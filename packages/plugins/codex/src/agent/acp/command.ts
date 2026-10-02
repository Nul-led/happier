import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveManagedDependencyCommand } from '@happier-dev/plugin-sdk/managed-services/native';
import { CODEX_ACP_MANAGED_DEPENDENCY } from '../installables/definition.js';

export type CodexAcpSpawnSpec = { command: string; args: string[] };

export type ResolveCodexAcpSpawnOptions = Readonly<{
  permissionMode?: string;
  disableUserMcpServers?: boolean;
  env?: NodeJS.ProcessEnv;
  currentWorkingDirectory?: string;
}>;

export type ResolveCodexAcpSpawnDeps = Readonly<{
  resolveExistingManagedBinPath?: (env: NodeJS.ProcessEnv) => string | null;
}>;

function resolveCodexConfigTomlPath(env: NodeJS.ProcessEnv): string {
  const codexHome = typeof env.CODEX_HOME === 'string' ? env.CODEX_HOME.trim() : '';
  if (codexHome) return join(codexHome, 'config.toml');
  return join(homedir(), '.codex', 'config.toml');
}

function normalizeCodexMcpServerKeyFromConfigSection(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const firstChar = trimmed[0];
  if (firstChar === '"' || firstChar === "'") {
    const end = trimmed.indexOf(firstChar, 1);
    if (end === -1) return null;
    return trimmed.slice(0, end + 1);
  }

  const firstSegment = trimmed.split('.')[0]?.trim() ?? '';
  return firstSegment ? firstSegment : null;
}

function readCodexMcpServerKeysFromConfigToml(env: NodeJS.ProcessEnv): string[] {
  const configPath = resolveCodexConfigTomlPath(env);
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return [];
  }

  const keys = new Set<string>();
  const re = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/gm;
  for (;;) {
    const match = re.exec(text);
    if (!match) break;
    const key = normalizeCodexMcpServerKeyFromConfigSection(match[1] ?? '');
    if (!key) continue;
    keys.add(key);
  }

  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function appendConfigOverridesArgs(
  spec: CodexAcpSpawnSpec,
  opts: ResolveCodexAcpSpawnOptions,
): CodexAcpSpawnSpec {
  const env = opts.env ?? process.env;
  const baseOverrides: string[] = opts.disableUserMcpServers === true
    ? readCodexMcpServerKeysFromConfigToml(env).map((key) => `mcp_servers.${key}.enabled=false`)
    : [];

  const args = [...baseOverrides.flatMap((override) => ['-c', override]), ...spec.args];
  return { command: spec.command, args };
}

function appendPermissionModeDerivedOverrides(
  spec: CodexAcpSpawnSpec,
  opts: ResolveCodexAcpSpawnOptions,
): CodexAcpSpawnSpec {
  const mode = opts.permissionMode;
  if (!mode) return spec;

  const derivedByMode: Readonly<Partial<Record<string, readonly string[]>>> = {
    yolo: ['approval_policy="never"', 'sandbox_mode="danger-full-access"'],
    bypassPermissions: ['approval_policy="never"', 'sandbox_mode="danger-full-access"'],
    'safe-yolo': ['approval_policy="on-request"', 'sandbox_mode="workspace-write"'],
    'read-only': ['approval_policy="on-request"', 'sandbox_mode="read-only"'],
    default: ['approval_policy="on-request"', 'sandbox_mode="read-only"'],
    plan: ['approval_policy="on-request"', 'sandbox_mode="read-only"'],
  };
  const derived = derivedByMode[mode] ?? null;

  if (!derived) return spec;
  return { command: spec.command, args: [...spec.args, ...derived.flatMap((entry) => ['-c', entry])] };
}

export function resolveCodexAcpSpawnWithOptions(
  opts: ResolveCodexAcpSpawnOptions = {},
  deps: ResolveCodexAcpSpawnDeps = {},
): CodexAcpSpawnSpec {
  const env = opts.env ?? process.env;
  const spec = resolveManagedDependencyCommand({
    binaryName: CODEX_ACP_MANAGED_DEPENDENCY.executable,
    displayName: CODEX_ACP_MANAGED_DEPENDENCY.title,
    declaration: CODEX_ACP_MANAGED_DEPENDENCY.sources[0].launch,
    env,
    currentWorkingDirectory: opts.currentWorkingDirectory,
    resolveExistingManagedBinPath: deps.resolveExistingManagedBinPath,
  });
  return appendPermissionModeDerivedOverrides(appendConfigOverridesArgs({ command: spec.command, args: [...spec.args] }, opts), opts);
}
