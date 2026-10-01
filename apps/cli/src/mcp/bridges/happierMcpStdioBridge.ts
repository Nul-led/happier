/**
 * Happier MCP STDIO Bridge
 *
 * STDIO MCP server that forwards tools to an existing Happier HTTP MCP server
 * using the StreamableHTTPClientTransport.
 *
 * Configure the target HTTP MCP URL via env var `HAPPIER_HTTP_MCP_URL` or
 * via CLI flag `--url <http://127.0.0.1:PORT>`.
 *
 * Note: This process must not print to stdout as it would break MCP STDIO.
 *
 * This is host MCP bridge infrastructure, not provider runtime behavior.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { forwardHappierBridgeTool } from './registerHappierBridgeTools';
import { registerHappierMcpResources } from '@/mcp/resources/registerHappierMcpResources';
import { callMcpToolWithResolvedTimeout } from '@/mcp/mcpToolCallRequestOptions';
import { isActionEnabledByEnv } from '@/settings/actionsSettings';
import { runMcpStdioBridgeLifecycle } from '@/mcp/runtime/runMcpStdioBridgeLifecycle';

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && i + 1 < argv.length) {
      url = argv[i + 1];
      i++;
    }
  }
  return { url };
}

async function main() {
  // Resolve target HTTP MCP URL
  const { url: urlFromArgs } = parseArgs(process.argv.slice(2));
  const baseUrl = urlFromArgs || process.env.HAPPIER_HTTP_MCP_URL || '';

  if (!baseUrl) {
    // Write to stderr; never stdout.
    process.stderr.write(
      '[happier-mcp] Missing target URL. Set HAPPIER_HTTP_MCP_URL or pass --url <http://127.0.0.1:PORT>\n'
    );
    process.exit(2);
  }

  let httpClient: Client | null = null;
  let httpClientPromise: Promise<Client> | null = null;

  async function ensureHttpClient(): Promise<Client> {
    if (httpClient) return httpClient;
    if (httpClientPromise) return await httpClientPromise;
    const pending = (async () => {
      const client = new Client(
        { name: 'happier-stdio-bridge', version: '1.0.0' },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
      try {
        await client.connect(transport);
        httpClient = client;
        return client;
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    httpClientPromise = pending;
    try {
      return await pending;
    } catch (error) {
      httpClientPromise = null;
      throw error;
    }
  }

  // Create STDIO MCP server
  const server = new McpServer({
    name: 'Happier MCP Bridge',
    version: '1.0.0',
  });
  // Initialize the stdio transport without waiting for two serial loopback
  // requests. Discovery and execution still go to the exact upstream runtime.
  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return await (await ensureHttpClient()).listTools();
  });
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    return await forwardHappierBridgeTool(
      request.params.name,
      request.params.arguments,
      extra,
      async (name, args, options) => {
        const client = await ensureHttpClient();
        return await callMcpToolWithResolvedTimeout({
          client,
          toolName: name,
          args,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          ...(options?.requestMetadata === undefined ? {} : { requestMetadata: options.requestMetadata }),
          ...(options?.onprogress === undefined ? {} : { onprogress: options.onprogress }),
        });
      },
    );
  });
  registerHappierMcpResources(server as any, {
    isActionEnabled: (id) => isActionEnabledByEnv(id, { surface: 'agent' }),
  });

  const requestedSignal = await runMcpStdioBridgeLifecycle({
    stdin: process.stdin,
    start: async () => {
      const stdio = new StdioServerTransport();
      await server.connect(stdio);
      return { transport: stdio };
    },
    closeServer: async () => await server.close(),
    closeUpstream: async () => await httpClient?.close(),
  });
  if (requestedSignal === 'SIGINT') process.exitCode = 130;
  if (requestedSignal === 'SIGTERM') process.exitCode = 143;
}

// Start and surface fatal errors to stderr only
main().catch((err) => {
  try {
    process.stderr.write(`[happier-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    process.exit(1);
  }
});
