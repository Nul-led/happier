import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { DEFAULT_CURATED_MARKETPLACE_SOURCE_URL } from '@happier-dev/protocol/marketplace';
import {
  HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD,
  HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema,
} from '@happier-dev/protocol/marketplace/internal';

import { registerMachineMarketplaceSourcesRpcHandlers } from './rpcHandlers.marketplaceSources';
import type { PluginChangeDecision, PluginChangeDecisionResult } from '@/plugins/daemon/changeContract';

type Handler = (data: unknown) => Promise<any>;

function createRpcHandlerManager(): { handlers: Map<string, Handler>; registerHandler: (method: string, handler: Handler) => void } {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    registerHandler(method, handler) {
      handlers.set(method, handler);
    },
  };
}

describe('rpcHandlers (marketplace sources)', () => {
  it('passes UI-created present-user evidence through without minting or replacing it', async () => {
    const decideChange = vi.fn(async (decision: unknown) => ({
      kind: 'committed' as const,
      pluginId: 'acme.example',
      desiredGeneration: 'generation-1',
      appliedGeneration: 'generation-1',
      pendingSurfaces: [],
      decision,
    }));
    const mgr = createRpcHandlerManager();
    registerMachineMarketplaceSourcesRpcHandlers({
      rpcHandlerManager: mgr as any,
      deps: {
        decidePluginChange: decideChange,
      },
    });

    const decide = mgr.handlers.get(HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD);
    expect(decide).toBeTypeOf('function');
    await expect(decide?.({
      v: 1,
      pendingChangeId: 'pending-1',
      decision: 'installAndTrust',
      optionalSelections: [{ accessId: 'workspace', selected: false }],
    })).resolves.toMatchObject({ kind: 'committed', pluginId: 'acme.example' });
    expect(decideChange).toHaveBeenCalledWith({
      pendingChangeId: 'pending-1',
      decision: 'installAndTrust',
      optionalSelections: [{ accessId: 'workspace', selected: false }],
    });
  });

  it('forwards project trust through the one install-and-trust decision', async () => {
    const decideChange = vi.fn(async (_decision: PluginChangeDecision): Promise<Extract<
      PluginChangeDecisionResult,
      Readonly<{ kind: 'reviewRequired'; reviewKind: 'installation' }>
    >> => ({
      kind: 'reviewRequired', reviewKind: 'installation', reason: 'firstInstall', currentVersion: null, authorityExpansion: [],
      pendingChangeId: 'pending-source-1',
      review: {
        pluginId: 'acme.example',
        displayName: 'Acme Example',
        version: '1.0.0',
        source: { kind: 'path', locator: '/tmp/acme-example' },
        requiredHostAccess: [],
        optionalHostAccess: [],
        contributions: [],
        trustChange: 'newPlugin',
      } as unknown as Extract<PluginChangeDecisionResult, {
        kind: 'reviewRequired'; reviewKind: 'installation';
      }>['review'],
    }));
    const mgr = createRpcHandlerManager();
    registerMachineMarketplaceSourcesRpcHandlers({
      rpcHandlerManager: mgr as any,
      deps: {
        decidePluginChange: decideChange,
      },
    });

    const decide = mgr.handlers.get(HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD);
    expect(decide).toBeTypeOf('function');
    await expect(decide?.({
      v: 1,
      pendingChangeId: 'pending-source-1',
      decision: 'installAndTrust', optionalSelections: [],
    })).resolves.toMatchObject({ kind: 'reviewRequired', reviewKind: 'installation', reason: 'firstInstall', currentVersion: null, authorityExpansion: [], pendingChangeId: 'pending-source-1' });
    expect(decideChange).toHaveBeenCalledWith({
      pendingChangeId: 'pending-source-1',
      decision: 'installAndTrust', optionalSelections: [],
    });
  });

  it('requires the strict UI evidence shape and never treats a transport receipt as evidence', async () => {
    const decideChange = vi.fn();
    const mgr = createRpcHandlerManager();
    registerMachineMarketplaceSourcesRpcHandlers({
      rpcHandlerManager: mgr as any,
      deps: {
        decidePluginChange: decideChange,
      },
    });
    const decide = mgr.handlers.get(HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD);
    expect(decide).toBeTypeOf('function');

    await expect(decide?.({
      v: 1,
      pendingChangeId: 'pending-1',
      decision: 'installAndTrust',
      optionalSelections: [],
      receipt: 'peer.rpc.direct_call_succeeded',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'invalid_request',
      error: 'invalid_request',
    });
    expect(decideChange).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', { v: 1, pendingChangeId: 'pending-cancel', decision: 'cancel' }],
    ['expired', {
      v: 1,
      pendingChangeId: 'pending-expired',
      decision: 'installAndTrust',
      optionalSelections: [],
    }],
    ['conflict', {
      v: 1,
      pendingChangeId: 'pending-conflict',
      decision: 'installAndTrust',
      optionalSelections: [],
    }],
  ] as const)('passes through a %s daemon decision outcome', async (kind, request) => {
    const outcome: PluginChangeDecisionResult = kind === 'conflict'
      ? { kind, pluginId: 'acme.example' }
      : { kind };
    const decideChange = vi.fn(async (_decision: PluginChangeDecision): Promise<PluginChangeDecisionResult> => outcome);
    const mgr = createRpcHandlerManager();
    registerMachineMarketplaceSourcesRpcHandlers({
      rpcHandlerManager: mgr as any,
      deps: {
        decidePluginChange: decideChange,
      },
    });
    const decide = mgr.handlers.get(HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD);
    expect(decide).toBeTypeOf('function');
    await expect(decide?.(request)).resolves.toEqual(outcome);
    if (request.decision === 'cancel') {
      expect(decideChange).toHaveBeenCalledWith({
        pendingChangeId: request.pendingChangeId,
        decision: 'cancel',
      });
    }
  });

  it('reads and atomically mutates the shared marketplace source registry file', async () => {
    const happyHomeDir = mkdtempSync(join(tmpdir(), 'happier-marketplace-rpc-'));
    try {
      const mgr = createRpcHandlerManager();
      registerMachineMarketplaceSourcesRpcHandlers({
        rpcHandlerManager: mgr as any,
        deps: {
          happyHomeDir,
        },
      });

      const get = mgr.handlers.get(RPC_METHODS.DAEMON_MARKETPLACE_SOURCE_REGISTRY_GET);
      const mutate = mgr.handlers.get(RPC_METHODS.DAEMON_MARKETPLACE_SOURCE_REGISTRY_MUTATE);
      const query = mgr.handlers.get(RPC_METHODS.DAEMON_MARKETPLACE_INDEX_QUERY);
      if (!get || !mutate || !query) {
        throw new Error('expected marketplace source registry handlers');
      }

      const initial = await get({});
      expect(initial).toEqual(expect.objectContaining({
        t: 'happier_marketplace_source_registry_v1',
        schemaVersion: 1,
        sources: [
          expect.objectContaining({
            title: 'Happier curated marketplace',
            sourceUrl: DEFAULT_CURATED_MARKETPLACE_SOURCE_URL,
            enabled: true,
            origin: 'curated',
            description: 'Official curated source',
          }),
        ],
      }));

      const curatedSourceId = (initial as { sources: Array<{ id: string }> }).sources[0]!.id;
      await expect(mutate({
        kind: 'setRegistryProfile',
        sourceId: curatedSourceId,
        registryProfileId: 'registry_private',
      })).resolves.toMatchObject({
        sources: [expect.objectContaining({ id: curatedSourceId, registryProfileId: 'registry_private' })],
      });

      // Both callers observed the same prior registry. Because each request
      // describes only its own source change, the daemon applies both beneath
      // the store's existing update lock rather than accepting two stale
      // whole-document replacements.
      await Promise.all([
        mutate({ kind: 'upsert', input: { sourceUrl: 'https://alpha.example.test/index.json', title: 'Alpha', origin: 'user' } }),
        mutate({ kind: 'upsert', input: { sourceUrl: 'https://beta.example.test/index.json', title: 'Beta', origin: 'user' } }),
      ]);
      const persisted = JSON.parse(readFileSync(join(happyHomeDir, 'plugins', 'plugins', 'state', 'marketplace-source-registry.v1.json'), 'utf8'));
      expect(persisted.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Alpha' }),
        expect.objectContaining({ title: 'Beta' }),
      ]));
      await expect(get({})).resolves.toEqual(persisted);
      const alphaSourceId = persisted.sources.find((source: { title: string }) => source.title === 'Alpha').id;
      const betaSourceId = persisted.sources.find((source: { title: string }) => source.title === 'Beta').id;
      await expect(mutate({ kind: 'setEnabled', sourceId: alphaSourceId, enabled: false })).resolves.toMatchObject({
        sources: expect.arrayContaining([expect.objectContaining({ id: alphaSourceId, enabled: false })]),
      });
      await expect(mutate({
        kind: 'setRegistryProfile', sourceId: alphaSourceId, registryProfileId: 'registry_alpha',
      })).resolves.toMatchObject({
        sources: expect.arrayContaining([expect.objectContaining({ id: alphaSourceId, registryProfileId: 'registry_alpha' })]),
      });
      await expect(mutate({ kind: 'remove', sourceId: betaSourceId })).resolves.not.toMatchObject({
        sources: expect.arrayContaining([expect.objectContaining({ id: betaSourceId })]),
      });
      const invalidMutationResponse = await mutate({
        kind: 'upsert',
        input: {
          sourceUrl: 'https://evil.example.test/catalog.json',
          title: 'Attacker curated source',
          origin: 'curated',
        },
      });
      expect(HostPrivateMarketplaceSourceRegistryMutationResponseV1Schema.parse(invalidMutationResponse)).toEqual({
        ok: false,
        errorCode: 'invalid_request',
        error: 'invalid_request',
      });
      await expect(query({ limit: 101 })).resolves.toEqual({
        ok: false,
        errorCode: 'invalid_request',
        error: 'invalid_request',
      });
    } finally {
      rmSync(happyHomeDir, { recursive: true, force: true });
    }
  });
});
