import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { reloadConfiguration } from '@/configuration';
import { withTempDir } from '@/testkit/fs/tempDir';
import { createExternalMcpServer } from './createExternalMcpServer';

type ObservedRequest = Readonly<{
  method: string;
  path: string;
  authorization: string | null;
}>;

async function startActionServer(observed: ObservedRequest[]): Promise<Readonly<{
  endpoint: string;
  close: () => Promise<void>;
}>> {
  const server: Server = createServer((request, response) => {
    observed.push({
      method: request.method ?? '',
      path: request.url ?? '',
      authorization: readAuthorization(request),
    });
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url === '/v1/machines') {
      response.end(JSON.stringify([{
        id: 'machine-selected',
        active: true,
        revokedAt: null,
        replacedByMachineId: null,
      }]));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/actions/session.list') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const parsed = JSON.parse(body) as Readonly<{ requestId?: unknown }>;
        response.end(JSON.stringify({
          v: 1,
          actionId: 'session.list',
          ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
          execution: {
            ok: true,
            result: { sessions: [], nextCursor: null, hasNext: false },
          },
        }));
      });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test server');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function readAuthorization(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  return typeof value === 'string' ? value : null;
}

describe('createExternalMcpServer target pinning', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    reloadConfiguration();
  });

  it('keeps post-construction PAT actions on the selected Home after global configuration changes', async () => {
    await withTempDir('happier-mcp-target-pinning-', async (homeDir) => {
      const selectedRequests: ObservedRequest[] = [];
      const attackerRequests: ObservedRequest[] = [];
      const selected = await startActionServer(selectedRequests);
      const attacker = await startActionServer(attackerRequests);
      process.env = {
        ...originalEnv,
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_SERVER_URL: selected.endpoint,
        HAPPIER_WEBAPP_URL: selected.endpoint,
      };
      reloadConfiguration();

      const token = 'hap_v1_11111111-1111-4111-8111-111111111111_' + 'A'.repeat(43);
      const { mcp } = createExternalMcpServer({
        credentials: {
          token,
          encryption: null,
          credentialProvenance: 'api_token',
        },
        defaultSessionId: 'c123456789012345678901234',
      });

      process.env.HAPPIER_SERVER_URL = attacker.endpoint;
      process.env.HAPPIER_WEBAPP_URL = attacker.endpoint;
      reloadConfiguration();

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'target-pinning-test', version: '1.0.0' }, { capabilities: {} });
      await mcp.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const result = await client.callTool({ name: 'session_list', arguments: { limit: 1 } });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(selectedRequests).toEqual(expect.arrayContaining([
          expect.objectContaining({
            method: 'POST',
            path: '/v1/actions/session.list',
            authorization: `Bearer ${token}`,
          }),
        ]));
        expect(selectedRequests.every(({ authorization }) => authorization === `Bearer ${token}`)).toBe(true);
        expect(attackerRequests).toEqual([]);
        await expect(readFile(`${homeDir}/settings.json`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await client.close();
        await mcp.close();
        await selected.close();
        await attacker.close();
      }
    });
  });
});
