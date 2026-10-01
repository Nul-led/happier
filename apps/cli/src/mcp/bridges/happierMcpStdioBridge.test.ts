import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { resolveNodeBackedMcpServerCommand } from '@/mcp/runtime/resolveNodeBackedMcpServerCommand';

describe('Happier MCP stdio bridge', () => {
  it('forwards the upstream catalog and title tool call after initialize', async () => {
    const upstream = createServer(async (request, response) => {
      const mcp = new McpServer({ name: 'test-title-upstream', version: '1.0.0' });
      mcp.server.registerCapabilities({ tools: {} });
      mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{
          name: 'change_title',
          description: 'Change the title',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        }],
      }));
      mcp.server.setRequestHandler(CallToolRequestSchema, async (call) => ({
        content: [{ type: 'text', text: String(call.params.arguments?.title) }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.once('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    });
    const port = await new Promise<number>((resolve) => {
      upstream.listen(0, '127.0.0.1', () => resolve((upstream.address() as AddressInfo).port));
    });
    const config = await resolveNodeBackedMcpServerCommand({
      distEntrypointSegments: ['mcp', 'bridges', 'happierMcpStdioBridge.mjs'],
      sourceEntrypointSegments: ['mcp', 'bridges', 'happierMcpStdioBridge.ts'],
      args: ['--url', `http://127.0.0.1:${port}/`],
      preferSourceEntrypoint: true,
    });
    const client = new Client({ name: 'happier-bridge-title-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(new StdioClientTransport(config));
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toContain('change_title');
      const result = await client.callTool({ name: 'change_title', arguments: { title: 'Claude MCP Title QA' } });
      expect(result).toMatchObject({ content: [{ type: 'text', text: 'Claude MCP Title QA' }] });
    } finally {
      await client.close().catch(() => undefined);
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 30_000);

  it('answers stdio initialize while the HTTP upstream is unready', async () => {
    // An unready upstream is a real transport boundary. Claude's MCP connection
    // must not wait for a separate loopback connect and tools/list round trip.
    const upstream = createServer(() => undefined);
    const port = await new Promise<number>((resolve) => {
      upstream.listen(0, '127.0.0.1', () => resolve((upstream.address() as AddressInfo).port));
    });
    const config = await resolveNodeBackedMcpServerCommand({
      distEntrypointSegments: ['mcp', 'bridges', 'happierMcpStdioBridge.mjs'],
      sourceEntrypointSegments: ['mcp', 'bridges', 'happierMcpStdioBridge.ts'],
      args: ['--url', `http://127.0.0.1:${port}/`],
      preferSourceEntrypoint: true,
    });
    const transport = new StdioClientTransport(config);
    const client = new Client({ name: 'happier-bridge-startup-test', version: '1.0.0' }, { capabilities: {} });
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('stdio initialize waited for upstream')), 20_000);
        }),
      ]);
      expect(client.getServerVersion()?.name).toBe('Happier MCP Bridge');
    } finally {
      if (timer) clearTimeout(timer);
      await client.close().catch(() => undefined);
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 30_000);
});
