import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { configuration } from '@/configuration';
import { createExternalMcpServer } from './createExternalMcpServer';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
// Daemon control RPC is the substituted boundary; SDK and in-memory transport are real.
vi.mock('@/daemon/controlClient', () => ({ requestDaemonPluginActionExecution: request }));

it('external MCP wait enters the admitted plugin Action through its captured Home', async () => {
  request.mockImplementation(async (value: unknown) => {
    expect(value).toMatchObject({ actionId: 'action.invoke', surface: 'mcp', input: {
      action: { pluginId: 'acme.checks', localId: 'observe/checks' },
      input: { sourceId: 'checkpoint', condition: 'checks_passed' },
    } });
    return { matched: true, result: { ok: true, result: { disposition: 'matched', snapshot: { passed: true } } } };
  });
  const { mcp, toolNames } = createExternalMcpServer({ credentials: { token: 'token', encryption: null, credentialProvenance: 'stored_session' } });
  const client = new Client({ name: 'external-watch-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
    expect(toolNames).toContain('watch');
    const response = CallToolResultSchema.parse(await client.callTool({ name: 'wait', arguments: {
      target: { kind: 'plugin_source', serverId: configuration.activeServerId, pluginId: 'acme.checks', sourceId: 'checkpoint' },
      condition: { kind: 'plugin', actionLocalId: 'observe/checks', condition: 'checks_passed' },
    } }));
    const text = response.content.find((entry) => entry.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Missing text result');
    expect(JSON.parse(text.text)).toMatchObject({ disposition: 'matched', snapshot: { passed: true } });
  } finally { await client.close(); await mcp.close(); }
});
