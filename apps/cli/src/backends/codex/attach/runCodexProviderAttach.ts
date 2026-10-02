import { spawn } from 'node:child_process';

import {
  resolvePersistedCodexRuntimeIdentity,
  resolvePersistedCodexVendorSessionId,
} from '@happier-dev/agents';
import { prepareOwnedTerminalSpawn } from '@/terminal/runtime/terminalLaunchSpec';
import { launchOwnedTerminalProcess } from '@/terminal/runtime/ownedTerminalProcess';
import { logger } from '@/ui/logger';

import { configuration } from '@/configuration';
import type { CodexSharedControlEndpoint } from '../localControl/codexSharedControlEndpoint';
import { readCodexSharedControlEndpoint } from '../localControl/codexSharedControlEndpoint';
import { createCodexSharedAttachArgs } from '../localControl/createCodexSharedAttachArgs';
import { resolveCodexCliInvocation } from '../utils/resolveCodexCliInvocation';

export async function runCodexProviderAttach(params: Readonly<{
  sessionId: string;
  metadata: Record<string, unknown>;
  happyHomeDir?: string;
  env?: NodeJS.ProcessEnv;
  command?: string;
  commandArgs?: readonly string[];
  spawnProcess?: typeof spawn;
  readEndpointFn?: (params: { happyHomeDir: string; sessionId: string }) => Promise<CodexSharedControlEndpoint | null>;
}>): Promise<number> {
  if (resolvePersistedCodexRuntimeIdentity(params.metadata)?.backendMode !== 'appServer') return 1;
  const directory = typeof params.metadata.path === 'string' ? params.metadata.path.trim() : '';
  const vendorSessionId = resolvePersistedCodexVendorSessionId(params.metadata);
  if (!directory || !vendorSessionId) return 1;

  const endpoint = await (params.readEndpointFn ?? readCodexSharedControlEndpoint)({
    happyHomeDir: params.happyHomeDir ?? configuration.happyHomeDir,
    sessionId: params.sessionId,
  });
  if (!endpoint) return 1;

  const env = params.env ?? process.env;
  const resolved = params.command
    ? { command: params.command, args: [...(params.commandArgs ?? [])] }
    : await resolveCodexCliInvocation({
        args: [],
        cwd: directory,
        processEnv: env,
        overrideEnvVarKeys: ['HAPPIER_CODEX_TUI_BIN', 'HAPPY_CODEX_TUI_BIN'],
        targetLabel: 'Codex CLI',
      });
  const prepared = await prepareOwnedTerminalSpawn({
    command: resolved.command,
    args: [
      ...resolved.args,
      ...createCodexSharedAttachArgs({ endpoint: endpoint.endpoint, directory, sessionId: vendorSessionId }),
    ],
    env,
    cwd: process.cwd(),
  });
  try {
    const child = await launchOwnedTerminalProcess({ spawn: prepared, cwd: process.cwd(), spawnProcess: params.spawnProcess });
    return (await child.whenExited).code ?? 1;
  } catch {
    logger.infoFile('[terminal] Native terminal attach failed (terminal_native_attach_failed)');
    return 1;
  }
}
