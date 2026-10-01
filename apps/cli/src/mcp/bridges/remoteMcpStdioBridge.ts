/**
 * Remote MCP STDIO Bridge
 *
 * STDIO MCP server that proxies tools to a remote MCP server over:
 * - Streamable HTTP (`transport: http`)
 * - SSE (`transport: sse`)
 *
 * Bridge config is provided via env var `HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE`.
 *
 * SECURITY: never print secrets to stdout (stdout is reserved for MCP stdio).
 */

import { readFile } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';

import { callMcpToolWithResolvedTimeout } from '@/mcp/mcpToolCallRequestOptions';
import { withMcpTimeout } from '@/mcp/runtime/withMcpTimeout';
import { runMcpStdioBridgeLifecycle } from '@/mcp/runtime/runMcpStdioBridgeLifecycle';
import { registerHappierBridgeTools } from './registerHappierBridgeTools';

const MCP_BRIDGE_STARTUP_STEP_TIMEOUT_MS = 60_000;

const RemoteBridgeConfigSchema = z.object({
  transport: z.enum(['http', 'sse']),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional().default({}),
});

type RemoteBridgeConfig = z.infer<typeof RemoteBridgeConfigSchema>;

function writeStderr(line: string): void {
  try {
    process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
  } catch {
    // ignore
  }
}

async function connectRemoteClient(config: RemoteBridgeConfig): Promise<Client> {
  const client = new Client({ name: 'happier-remote-bridge', version: '1.0.0' }, { capabilities: {} });

  const url = new URL(config.url);
  const headers = { ...config.headers };

  const transport =
    config.transport === 'http'
      ? new StreamableHTTPClientTransport(url, { requestInit: { headers } })
      : new SSEClientTransport(url, {
        requestInit: { headers },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventSourceInit: { headers } as any,
      });

  try {
    await withMcpTimeout(client.connect(transport), {
      timeoutMs: MCP_BRIDGE_STARTUP_STEP_TIMEOUT_MS,
      label: 'happier_mcp_bridge_connect_timeout',
    });
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function main(): Promise<void> {
  const configPath = typeof process.env.HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE === 'string'
    ? process.env.HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE
    : '';
  if (!configPath) {
    writeStderr('[happier-mcp-remote-bridge] Missing HAPPIER_MCP_REMOTE_BRIDGE_CONFIG_FILE');
    process.exit(2);
  }

  let config: RemoteBridgeConfig;
  try {
    const raw = await readFile(configPath, 'utf8');
    config = RemoteBridgeConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    writeStderr(`[happier-mcp-remote-bridge] Failed to read config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const remoteClient = await connectRemoteClient(config);
  const server = new McpServer({ name: 'Happier MCP Remote Bridge', version: '1.0.0' });
  const requestedSignal = await runMcpStdioBridgeLifecycle({
    stdin: process.stdin,
    start: async () => {
      const toolList = await withMcpTimeout(remoteClient.listTools(), {
        timeoutMs: MCP_BRIDGE_STARTUP_STEP_TIMEOUT_MS,
        label: 'happier_mcp_bridge_list_tools_timeout',
      });
      registerHappierBridgeTools(server, {
        tools: toolList.tools,
        callHttpTool: async (name, args, options) =>
          await callMcpToolWithResolvedTimeout({
            client: remoteClient,
            toolName: name,
            args,
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
            ...(options?.requestMetadata === undefined ? {} : { requestMetadata: options.requestMetadata }),
            ...(options?.onprogress === undefined ? {} : { onprogress: options.onprogress }),
          }),
      });

      const stdio = new StdioServerTransport();
      await server.connect(stdio);
      return { transport: stdio, upstream: remoteClient };
    },
    closeServer: async () => await server.close(),
    closeUpstream: async () => await remoteClient.close(),
  });
  if (requestedSignal === 'SIGINT') process.exitCode = 130;
  if (requestedSignal === 'SIGTERM') process.exitCode = 143;
}

main().catch((err) => {
  writeStderr(`[happier-mcp-remote-bridge] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
