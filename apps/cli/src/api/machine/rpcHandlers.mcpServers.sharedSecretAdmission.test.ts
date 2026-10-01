import axios from 'axios';
import {
  AccountSettingsSchema,
  formatSavedSecretCatalogReferenceV1,
  sealSavedSecretResourceStoredContentV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetActiveAccountSettingsSnapshotForTests,
  setActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKeyForToken } from '@/settings/accountSettings/accountSettingsScopeKey';
import type { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';

import { registerMachineMcpServersRpcHandlers } from './rpcHandlers.mcpServers';

// Only true boundaries are simulated: the Home HTTP transport, the stored
// credential file and the Home features read. The catalog refresh, its
// admission decision and the MCP materializer all run for real.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
const persistence = vi.hoisted(() => ({ readStoredCredentials: vi.fn() }));
vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: persistence.readStoredCredentials,
}));
vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: vi.fn(async () => ({
    status: 'ready' as const,
    features: {
      features: { teams: { enabled: true, credentialResources: { enabled: true } } },
      capabilities: {},
    },
  })),
}));

type BootstrapResult = Awaited<ReturnType<typeof bootstrapAccountSettingsContext>>;

describe('rpcHandlers.mcpServers (shared Saved Secret admission)', () => {
  beforeEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
    vi.mocked(axios.get).mockReset();
  });
  afterEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
  });

  it('refuses a Machine MCP Test whose shared secret the Home revoked after a missed change hint', async () => {
    const token = 'account-token';
    const resourceId = 'resource-revoked';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const staleResource = {
      resourceId,
      ownerAccountId: 'owner-account',
      displayName: 'Revoked key',
      kind: 'apiKey' as const,
      encryptionMode: 'plain' as const,
      revision: 4,
      storedContent: sealSavedSecretResourceStoredContentV1({
        resourceId,
        mode: 'plain',
        content: { v: 1, name: 'Revoked key', kind: 'apiKey', value: 'stale-value' },
      }),
      materialStatus: 'ready' as const,
    };
    const settings = AccountSettingsSchema.parse({});
    // The daemon's hydrated snapshot still holds the row: the revocation's
    // AccountChange never arrived.
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings,
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
      savedSecretCatalogState: 'ready',
      savedSecretResources: [staleResource],
    });
    persistence.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    // The Home's current authorized answer no longer contains the resource.
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { resources: [] } });
    const probeMcpStdioServerTools = vi.fn(async () => [{ name: 'echo' }]);
    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();

    registerMachineMcpServersRpcHandlers({
      rpcHandlerManager: {
        registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
          handlers.set(method, handler);
        },
      } as never,
      deps: {
        readCredentials: async () => ({ token, encryption: null }) as never,
        bootstrapAccountSettingsContext: async () => ({
          source: 'remote',
          settings,
          settingsVersion: 1,
          loadedAtMs: 0,
          whenRefreshed: null,
          savedSecretResources: [staleResource],
          savedSecretCatalogState: 'ready',
        }) as unknown as BootstrapResult,
        probeMcpStdioServerTools,
      },
    });

    const out = await handlers.get(RPC_METHODS.DAEMON_MCP_SERVERS_TEST)!({
      t: 'draft',
      machineId: 'm1',
      directory: '/',
      server: {
        id: 'srv_remote',
        name: 'remote_fixture',
        transport: 'http',
        remote: {
          url: 'https://mcp.example.com',
          headers: { Authorization: { t: 'savedSecret', secretId: ref } },
        },
        env: {},
        createdAt: 1,
        updatedAt: 1,
      },
      binding: null,
    });

    expect(out).toMatchObject({ ok: false, errorCode: 'materialization_failed' });
    // The revoked value never reached the MCP server.
    expect(probeMcpStdioServerTools).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
