import { asRecord, normalizeString, readStringRecord } from './openCodeParsing.js';
import type { OpenCodeServerClient } from './openCodeServerClient.js';
import { isOpenCodeServerUnsupportedOperation } from './openCodeServerClient.js';
import type { OpenCodeRuntimeContext } from './runtimeContext.js';

type OpenCodeMcpRegistration = Readonly<{
  name: string;
  config: Readonly<Record<string, unknown>>;
}>;

/**
 * `unsupported` is deliberately not a kind of `failed`.
 *
 * `failed` means the reachable server has a dynamic MCP registration route and
 * would not complete this registration: Happier's own tools would be silently
 * missing, so prompt admission fails closed. `unsupported` means the server
 * declares no such route at all — the standalone OpenCode V2 protocol has no
 * MCP group. Failing every ordinary prompt closed over a route that never
 * existed would remove core agent use to protect an integration that cannot
 * exist there, so the session continues without Happier's MCP-backed tools and
 * reports the exact limitation on a default-on signal.
 */
export type OpenCodeMcpRegistrationResult = Readonly<{
  requiredHappier: Readonly<
    | { status: 'ready' }
    | { status: 'failed'; error: unknown }
    | { status: 'unsupported'; reason: string }
  >;
}>;

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .map((entry) => normalizeString(entry))
      .filter((entry) => entry.length > 0),
  );
}

function readEnvironment(value: unknown): Readonly<Record<string, string>> | null {
  const record = readStringRecord(value);
  const entries = Object.entries(record)
    .filter(([key, entry]) => key.length > 0 && typeof entry === 'string');
  if (entries.length === 0) return null;
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

export function readOpenCodeMcpRegistrations(raw: unknown): readonly OpenCodeMcpRegistration[] {
  const servers = asRecord(raw);
  if (!servers) return Object.freeze([]);

  const registrations: OpenCodeMcpRegistration[] = [];
  for (const [rawName, rawConfig] of Object.entries(servers)) {
    const name = normalizeString(rawName);
    const config = asRecord(rawConfig);
    const command = normalizeString(config?.command);
    if (!name || !command) continue;

    const args = readStringArray(config?.args);
    const environment = readEnvironment(config?.env);
    registrations.push(Object.freeze({
      name,
      config: Object.freeze({
        type: 'local',
        enabled: true,
        command: Object.freeze([command, ...args]),
        ...(environment ? { environment } : {}),
      }),
    }));
  }

  return Object.freeze(registrations);
}

export async function registerOpenCodeMcpServers(params: Readonly<{
  ctx: OpenCodeRuntimeContext;
  client: OpenCodeServerClient;
  directory: string;
  mcpServers: unknown;
}>): Promise<OpenCodeMcpRegistrationResult> {
  const rawServers = asRecord(params.mcpServers);
  const registrations = readOpenCodeMcpRegistrations(params.mcpServers);
  let requiredHappier: OpenCodeMcpRegistrationResult['requiredHappier'] = {
    status: 'failed',
    error: new Error(
      rawServers !== null && Object.prototype.hasOwnProperty.call(rawServers, 'happier')
        ? 'required Happier MCP server command is missing'
        : 'required Happier MCP server configuration is missing',
    ),
  };
  for (const registration of registrations) {
    try {
      const registrationStatus = await params.client.mcpAdd({
        directory: params.directory,
        name: registration.name,
        config: registration.config,
      });
      if (registrationStatus.status !== 'connected') {
        const detail = 'error' in registrationStatus ? `: ${registrationStatus.error}` : '';
        throw new Error(
          `OpenCode MCP server "${registration.name}" returned status "${registrationStatus.status}"${detail}`,
        );
      }
      if (registration.name === 'happier') {
        requiredHappier = { status: 'ready' };
      }
    } catch (error) {
      if (isOpenCodeServerUnsupportedOperation(error, 'mcp_registration')) {
        const reason = error instanceof Error
          ? error.message
          : 'the reachable OpenCode server has no dynamic MCP registration route';
        if (registration.name === 'happier') {
          requiredHappier = { status: 'unsupported', reason };
        }
        // Default-on, because this silently removes every Happier MCP-backed
        // tool (including title updates) from an otherwise working session.
        params.ctx.logger.warn(
          '[OpenCodeServer] this server supports no dynamic MCP registration; continuing without Happier MCP tools',
          {
            serverName: registration.name,
            dialect: error.dialect,
            reason,
          },
        );
        continue;
      }
      if (registration.name === 'happier') {
        requiredHappier = { status: 'failed', error };
      }
      params.ctx.logger.debug(
        registration.name === 'happier'
          ? '[OpenCodeServer] Required Happier MCP server registration failed; prompt admission will fail closed'
          : '[OpenCodeServer] Failed to register MCP server (non-fatal)',
        {
          serverName: registration.name,
          error,
        },
      );
    }
  }
  return Object.freeze({ requiredHappier: Object.freeze(requiredHappier) });
}

export function scheduleOpenCodeMcpServerRegistration(params: Readonly<{
  ctx: OpenCodeRuntimeContext;
  client: OpenCodeServerClient;
  directory: string;
  mcpServers: unknown;
}>): Promise<OpenCodeMcpRegistrationResult> {
  return (async () => {
    return await registerOpenCodeMcpServers({
      ctx: params.ctx,
      client: params.client,
      directory: params.directory,
      mcpServers: params.mcpServers,
    });
  })().catch((error: unknown) => {
    params.ctx.logger.debug(
      '[OpenCodeServer] MCP server registration setup failed; prompt admission will fail closed',
      { error },
    );
    return {
      requiredHappier: { status: 'failed', error },
    } satisfies OpenCodeMcpRegistrationResult;
  });
}
