import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { reloadConfiguration } from '@/configuration';
import { readDaemonPluginCatalog } from '@/daemon/controlClient';
import { resolveLiveDaemonControlTargetForServer } from '@/daemon/multiDaemon';
import { createExternalMcpServer } from '@/mcp/createExternalMcpServer';
import { disableMcpStdioConsolePatch } from '@/mcp/server/mcpStdioConsolePatch';
import { addServerProfile } from '@/server/serverProfiles';
import { applyEphemeralServerSelectionFromPrefixArgs } from '@/server/serverSelection';
import { withTempDir } from '@/testkit/fs/tempDir';
import type { McpCommandDeps } from './deps';
import { runMcpServeCommand } from './serve';

type ObservedDaemonRequest = Readonly<{ path: string; authorization: string | null }>;

const pluginTool = {
  toolId: 'acme.review.plugin/review-tool',
  actionId: 'acme.review.plugin/review-start',
  name: 'acme_review_start',
  title: 'Acme Review Start',
  description: 'Start a review',
  inputSchema: {
    type: 'object' as const,
    properties: { scope: { type: 'string' as const } },
    required: ['scope'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: { daemon: { type: 'string' as const } },
    required: ['daemon'],
    additionalProperties: false,
  },
  surfaces: ['mcp' as const],
};

async function startDaemonControlServer(
  daemonName: string,
  observed: ObservedDaemonRequest[],
): Promise<Readonly<{ port: number; close: () => Promise<void> }>> {
  const server: Server = createServer((request, response) => {
    observed.push({
      path: request.url ?? '',
      authorization: typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : null,
    });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/plugins/catalog/read') {
      response.end(JSON.stringify({ kind: 'available', plugins: [], tools: [pluginTool] }));
      return;
    }
    if (request.url === '/plugins/actions/execute') {
      response.end(JSON.stringify({
        matched: true,
        result: { ok: true, result: { daemon: daemonName } },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP daemon test server');
  return {
    port: address.port,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('happier mcp serve daemon target pinning', () => {
  const originalEnv = process.env;

  afterEach(() => {
    disableMcpStdioConsolePatch();
    process.env = originalEnv;
    reloadConfiguration();
  });

  it('ignores a conflicting ambient lifecycle scope for explicit-Home plugin catalog and execution', async () => {
    await withTempDir('happier-mcp-daemon-pinning-', async (homeDir) => {
      const selectedRequests: ObservedDaemonRequest[] = [];
      const attackerRequests: ObservedDaemonRequest[] = [];
      const selectedDaemon = await startDaemonControlServer('selected', selectedRequests);
      const attackerDaemon = await startDaemonControlServer('attacker', attackerRequests);
      process.env = {
        ...originalEnv,
        HAPPIER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_LIFECYCLE_SCOPE_ID: undefined,
      };
      delete process.env.HAPPIER_DAEMON_LIFECYCLE_SCOPE_ID;
      reloadConfiguration();

      const selectedProfile = await addServerProfile({
        name: 'selected-home',
        serverUrl: 'https://selected-home.example.test',
        webappUrl: 'https://app.selected-home.example.test',
        use: false,
      });
      const attackerProfile = await addServerProfile({
        name: 'attacker-home',
        serverUrl: 'https://attacker-home.example.test',
        webappUrl: 'https://app.attacker-home.example.test',
        use: false,
      });
      const resolution = await applyEphemeralServerSelectionFromPrefixArgs([
        '--server',
        selectedProfile.id,
        'mcp',
        'serve',
      ]);
      if (!resolution.selection) throw new Error('Expected an explicit saved Home selection');

      const daemonState = (port: number, controlToken: string) => ({
        pid: process.pid,
        httpPort: port,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-test',
        controlToken,
      });
      await Promise.all([
        mkdir(join(homeDir, 'servers', selectedProfile.id), { recursive: true }),
        mkdir(join(homeDir, 'servers', attackerProfile.id), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          join(homeDir, 'servers', selectedProfile.id, 'daemon.state.json'),
          JSON.stringify(daemonState(selectedDaemon.port, 'selected-control-token')),
          'utf8',
        ),
        writeFile(
          join(homeDir, 'servers', attackerProfile.id, 'daemon.state.json'),
          JSON.stringify(daemonState(attackerDaemon.port, 'attacker-control-token')),
          'utf8',
        ),
      ]);
      const persistedBefore = await readFile(join(homeDir, 'settings.json'), 'utf8');

      process.env.HAPPIER_DAEMON_LIFECYCLE_SCOPE_ID = attackerProfile.id;
      reloadConfiguration();

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'daemon-target-pinning-test', version: '1.0.0' }, { capabilities: {} });
      const credentials = {
        token: 'selected-home-token',
        encryption: { type: 'legacy' as const, secret: new Uint8Array([1, 2, 3, 4]) },
      };
      const deps: McpCommandDeps = {
        readStoredCredentials: async () => credentials,
        ensureMachineIdForCredentials: async () => ({ machineId: 'machine-selected' }),
        bootstrapAccountSettingsContext: async () => ({ settings: { actionsSettingsV1: null } }) as never,
        updateAccountSettingsV2WithRetry: async () => ({}) as never,
        detectProviderMcpServers: async () => ({}) as never,
        probeMcpStdioServerTools: async () => [],
        randomUUID: () => 'uuid',
        nowMs: () => 0,
        createExternalMcpServer,
        readDaemonPluginCatalog,
        resolveLiveDaemonControlTargetForServer,
        connectMcpStdio: async (mcp) => await mcp.connect(serverTransport),
      };

      try {
        await runMcpServeCommand(['serve'], deps, resolution.selection);
        await client.connect(clientTransport);
        const result = await client.callTool({
          name: 'acme_review_start',
          arguments: { scope: 'diff' },
        });
        expect(result.structuredContent).toEqual({ daemon: 'selected' });
        expect(selectedRequests.map(({ path }) => path)).toEqual([
          '/plugins/catalog/read',
          '/plugins/actions/execute',
        ]);
        expect(attackerRequests).toEqual([]);
        expect(await readFile(join(homeDir, 'settings.json'), 'utf8')).toBe(persistedBefore);

        await client.close();
        await unlink(join(homeDir, 'servers', selectedProfile.id, 'daemon.state.json'));
        selectedRequests.length = 0;
        attackerRequests.length = 0;

        const [failClosedClientTransport, failClosedServerTransport] = InMemoryTransport.createLinkedPair();
        const failClosedClient = new Client(
          { name: 'daemon-target-fail-closed-test', version: '1.0.0' },
          { capabilities: {} },
        );
        try {
          await runMcpServeCommand(['serve'], {
            ...deps,
            connectMcpStdio: async (mcp) => await mcp.connect(failClosedServerTransport),
          }, resolution.selection);
          await failClosedClient.connect(failClosedClientTransport);
          const listed = await failClosedClient.listTools();
          expect(listed.tools.some(({ name }) => name === pluginTool.name)).toBe(false);
          expect(selectedRequests).toEqual([]);
          expect(attackerRequests).toEqual([]);
          expect(await readFile(join(homeDir, 'settings.json'), 'utf8')).toBe(persistedBefore);
        } finally {
          await failClosedClient.close();
        }
      } finally {
        await client.close();
        await selectedDaemon.close();
        await attackerDaemon.close();
      }
    });
  });
});
