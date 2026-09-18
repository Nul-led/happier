import { describe, expect, it, vi } from 'vitest';
import { accountSettingsParse, sealSavedSecretResourceStoredContentV1 } from '@happier-dev/protocol';

const { createHappierMcpBridgeMock } = vi.hoisted(() => ({
  createHappierMcpBridgeMock: vi.fn(async () => ({
    happierMcpServer: { url: 'http://127.0.0.1:4000', stop: () => undefined },
    mcpServers: {
      happier: {
        command: 'node',
        args: ['built-in'],
      },
    },
  })),
}));

vi.mock('@/agent/runtime/createHappierMcpBridge', () => ({
  createHappierMcpBridge: createHappierMcpBridgeMock,
}));

import { resolveRunnerMcpServers } from './resolveRunnerMcpServers';
import type { HappyMcpSessionClient } from '../startHappyServer';

function createSessionStub(): HappyMcpSessionClient {
  return {
    sessionId: 'session-1',
    getServerBinding: () => ({
      serverId: 'test-home',
      serverUrl: 'https://test-home.example.test',
    }),
    rpcHandlerManager: {
      registerHandler: () => undefined,
      invokeLocal: async () => ({}),
    },
    updateMetadata: () => undefined,
  };
}

describe('resolveRunnerMcpServers', () => {
  it('does not silently drop a selected non-strict MCP server whose Saved Secret is forbidden', async () => {
    const promise = resolveRunnerMcpServers({
      session: createSessionStub(),
      credentials: { token: 'plain-token', encryption: null },
      accountSettings: accountSettingsParse({
        mcpServersSettingsV1: {
          v: 1,
          strictMode: false,
          servers: [{
            id: 'shared-server',
            name: 'shared-server',
            transport: 'stdio',
            stdio: { command: 'node', args: ['server.js'] },
            env: { API_KEY: { t: 'savedSecret', secretId: 'happier:shared-secret:v1:resource_1' } },
            createdAt: 1,
            updatedAt: 1,
          }],
          bindings: [{
            id: 'shared-binding',
            serverId: 'shared-server',
            enabled: true,
            target: { t: 'allMachines' },
            createdAt: 1,
            updatedAt: 1,
          }],
        },
      }),
      savedSecretResources: [{
        resourceId: 'resource_1',
        ownerAccountId: 'owner-account',
        displayName: 'Shared MCP token',
        kind: 'token',
        encryptionMode: 'plain',
        revision: 3,
        materialStatus: 'access_removed',
        storedContent: sealSavedSecretResourceStoredContentV1({
          resourceId: 'resource_1',
          mode: 'plain',
          content: { v: 1, name: 'Shared MCP token', kind: 'token', value: 'unused' },
        }),
      }],
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    await expect(promise).rejects.toMatchObject({ status: 'forbidden', consumer: 'mcp' });
  });

  it('materializes plain Settings secrets for a token-only runner without fabricating a write key', async () => {
    const result = await resolveRunnerMcpServers({
      session: createSessionStub(),
      credentials: {
        token: 'plain-token',
        encryption: null,
      },
      accountSettings: accountSettingsParse({
        secrets: [
          {
            id: 'plain-secret',
            name: 'Plain secret',
            encryptedValue: {
              _isSecretValue: true,
              value: 'plain-secret-value',
            },
          },
        ],
        mcpServersSettingsV1: {
          v: 1,
          strictMode: true,
          servers: [
            {
              id: 'plain-server',
              name: 'plain-server',
              transport: 'stdio',
              stdio: { command: 'node', args: ['server.js'] },
              env: {
                API_KEY: { t: 'savedSecret', secretId: 'plain-secret' },
              },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          bindings: [
            {
              id: 'plain-binding',
              serverId: 'plain-server',
              enabled: true,
              target: { t: 'allMachines' },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      }),
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(result.mcpServers['plain-server']).toMatchObject({
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'plain-secret-value' },
    });
  });

  it('keeps retained encrypted Settings secrets unavailable to a token-only runner', async () => {
    await expect(resolveRunnerMcpServers({
      session: createSessionStub(),
      credentials: {
        token: 'plain-token',
        encryption: null,
      },
      accountSettings: accountSettingsParse({
        secrets: [
          {
            id: 'retained-encrypted-secret',
            name: 'Retained encrypted secret',
            encryptedValue: {
              _isSecretValue: true,
              encryptedValue: {
                t: 'enc-v1',
                c: 'AAAA',
              },
            },
          },
        ],
        mcpServersSettingsV1: {
          v: 1,
          strictMode: true,
          servers: [
            {
              id: 'retained-server',
              name: 'retained-server',
              transport: 'stdio',
              stdio: { command: 'node', args: ['server.js'] },
              env: {
                API_KEY: { t: 'savedSecret', secretId: 'retained-encrypted-secret' },
              },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          bindings: [
            {
              id: 'retained-binding',
              serverId: 'retained-server',
              enabled: true,
              target: { t: 'allMachines' },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      }),
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    })).rejects.toMatchObject({
      code: 'saved_secret_resolution_failed',
      status: 'temporarily_unavailable',
      consumer: 'mcp',
      field: 'env:API_KEY',
    });
  });

  it('materializes a shared Saved Secret for a Session-owned MCP server', async () => {
    const resourceId = 'shared-mcp-resource';
    const secretId = `happier:shared-secret:v1:${resourceId}`;
    const result = await resolveRunnerMcpServers({
      session: createSessionStub(),
      credentials: { token: 'plain-token', encryption: null },
      accountSettings: accountSettingsParse({
        mcpServersSettingsV1: {
          v: 1,
          strictMode: true,
          servers: [{
            id: 'shared-server',
            name: 'shared-server',
            transport: 'stdio',
            stdio: { command: 'node', args: ['server.js'] },
            env: { API_KEY: { t: 'savedSecret', secretId } },
            createdAt: 1,
            updatedAt: 1,
          }],
          bindings: [{
            id: 'shared-binding',
            serverId: 'shared-server',
            enabled: true,
            target: { t: 'allMachines' },
            createdAt: 1,
            updatedAt: 1,
          }],
        },
      }),
      savedSecretResources: [{
        resourceId,
        ownerAccountId: 'owner-account',
        displayName: 'Shared MCP token',
        kind: 'token',
        encryptionMode: 'plain',
        revision: 3,
        materialStatus: 'ready',
        storedContent: sealSavedSecretResourceStoredContentV1({
          resourceId,
          mode: 'plain',
          content: { v: 1, name: 'Shared MCP token', kind: 'token', value: 'shared-mcp-token' },
        }),
      }],
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(result.mcpServers['shared-server']).toMatchObject({
      env: { API_KEY: 'shared-mcp-token' },
    });
  });

  it('passes runner credentials and account settings into the built-in Happier MCP bridge', async () => {
    const session = {} as any;
    const credentials = {
      token: 'token_1',
      encryption: {
        type: 'legacy',
        secret: new Uint8Array(32).fill(7),
      },
    } as any;
    const accountSettings = {
      actionsSettingsV1: {
        v: 1,
        actions: {
          'session.list': { disabledSurfaces: [] },
        },
      },
    } as any;

    await resolveRunnerMcpServers({
      session,
      credentials,
      accountSettings,
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(createHappierMcpBridgeMock).toHaveBeenCalledWith(session, expect.objectContaining({
      credentials,
      accountSettings,
    }));
  });

  it('separates restricted Session transport authentication from Account Action authority', async () => {
    const session = createSessionStub();
    const credentials = { token: 'restricted-token', encryption: null } as const;
    const sessionList = vi.fn();

    await resolveRunnerMcpServers({
      session,
      credentials,
      accountCredentials: null,
      sessionList,
      accountSettings: accountSettingsParse({}),
      machineId: 'runner-machine',
      directory: '/tmp/restricted-run',
      env: {},
      tmpDir: null,
    });

    expect(createHappierMcpBridgeMock).toHaveBeenCalledWith(session, expect.objectContaining({
      sessionCredentials: credentials,
      credentials: null,
      authorityScope: 'session',
      sessionList,
      accountSettings: null,
    }));
  });

  it('applies session metadata mcpSelection to managed MCP materialization', async () => {
    const result = await resolveRunnerMcpServers({
      session: {} as any,
      credentials: {
        encryption: {
          type: 'legacy',
          secret: new Uint8Array(32).fill(7),
        },
      } as any,
      accountSettings: {
        mcpServersSettingsV1: {
          v: 1,
          strictMode: false,
          servers: [
            {
              id: 'portable-playwright',
              name: 'playwright',
              transport: 'stdio',
              stdio: { command: 'node', args: ['playwright.js'] },
              env: {},
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'workspace-db',
              name: 'db',
              transport: 'stdio',
              stdio: { command: 'node', args: ['db.js'] },
              env: {},
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          bindings: [
            {
              id: 'binding-portable',
              serverId: 'portable-playwright',
              enabled: true,
              target: { t: 'allMachines' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'binding-workspace',
              serverId: 'workspace-db',
              enabled: true,
              target: { t: 'workspace', machineId: 'machine-1', workspaceRoot: '/tmp/repo' },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      } as any,
      sessionMetadata: {
        mcpSelectionV1: {
          v: 1,
          managedServersEnabled: false,
          forceIncludeServerIds: ['portable-playwright'],
          forceExcludeServerIds: [],
        },
      },
      machineId: 'machine-1',
      directory: '/tmp/repo',
      env: {},
      tmpDir: null,
    });

    expect(Object.keys(result.mcpServers).sort()).toEqual(['happier', 'playwright']);
    expect(result.mcpServers.playwright).toMatchObject({
      command: 'node',
      args: ['playwright.js'],
    });
    expect(result.mcpServers.db).toBeUndefined();
  });
});
