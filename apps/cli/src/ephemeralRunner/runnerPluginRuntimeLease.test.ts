import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeActionsSettingsV1 } from '@happier-dev/protocol';

const persistenceBoundary = vi.hoisted(() => ({
  readStoredCredentials: vi.fn(async () => null),
}));

vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: persistenceBoundary.readStoredCredentials,
}));

import {
  SAMPLE_PLUGIN_ID,
  SAMPLE_PLUGIN_PROVIDER_ID,
  materializeSamplePluginFixture,
} from '@/plugins/testkit/samplePackage';
import { seedCurrentLocalPathPluginFixture } from '@/plugins/store/registry/currentState.testkit';
import { bindPluginRuntimeSourceAuthority } from '@/plugins/runtime/sourceAuthority';
import { createScopedRuntimeActionSettingsProvider } from '@/settings/scopedRuntimeActionSettingsProvider';

import {
  RunnerReviewedPluginRuntimeUnavailableError,
  acquireReviewedRunnerPluginRuntimeLease,
} from './runnerPluginRuntimeLease';

const temporaryRoots: string[] = [];

const resolveRunnerFixtureDevelopmentSourceAuthority = ({ rootPath }: Readonly<{
  pluginId: string;
  rootPath: string;
}>) => {
  const authority = bindPluginRuntimeSourceAuthority({
    custody: {
      kind: 'development',
      registeredRootId: 'runner-reviewed-bundled-source',
    },
    resolvedRoot: rootPath,
    observedRevision: 1,
  });
  return authority.kind === 'development' ? authority : null;
};

beforeEach(() => {
  persistenceBoundary.readStoredCredentials.mockClear();
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('Runner reviewed plugin runtime lease', () => {
  it('does not consult ambient Account credentials for a pre-materialization scoped registry', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-runner-scoped-home-'));
    temporaryRoots.push(happyHomeDir);
    const handle = await acquireReviewedRunnerPluginRuntimeLease({
      happyHomeDir,
      target: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
      },
      resolveDevelopmentSourceAuthority: resolveRunnerFixtureDevelopmentSourceAuthority,
      scopedActionRuntime: {
        credentials: null,
        actionsSettingsProvider: createScopedRuntimeActionSettingsProvider(
          normalizeActionsSettingsV1({ v: 1, actions: {} }),
        ),
      },
    });
    try {
      expect(persistenceBoundary.readStoredCredentials).not.toHaveBeenCalled();
    } finally {
      await handle.release();
    }
  });

  it('activates a built-in Agent through the same reviewed identity and activate(api) runtime', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-runner-builtin-home-'));
    temporaryRoots.push(happyHomeDir);

    const handle = await acquireReviewedRunnerPluginRuntimeLease({
      happyHomeDir,
      target: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
      },
      resolveDevelopmentSourceAuthority: resolveRunnerFixtureDevelopmentSourceAuthority,
    });
    try {
      expect(handle.selected).toMatchObject({
        pluginId: 'happier.agent.codex',
        agentId: 'codex',
        backendId: 'codex',
        immutableGenerationId: null,
      });
      expect(handle.lease.registry.activatedPluginIds).toContain('happier.agent.codex');
      expect(handle.lease.registry.agentRuntimesByAgentId.has('codex')).toBe(true);
    } finally {
      await handle.release();
    }
  });

  it('loads and activates an externally installed immutable generation from the Runner-local home', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-runner-plugin-home-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'happier-runner-plugin-source-'));
    temporaryRoots.push(happyHomeDir, pluginRoot);
    await materializeSamplePluginFixture(pluginRoot);
    await seedCurrentLocalPathPluginFixture({
      happyHomeDir,
      pluginRoot,
      pluginId: SAMPLE_PLUGIN_ID,
      manifestVersion: '1.0.0',
    });

    const handle = await acquireReviewedRunnerPluginRuntimeLease({
      happyHomeDir,
      target: {
        kind: 'agent',
        identity: { pluginId: SAMPLE_PLUGIN_ID, localId: SAMPLE_PLUGIN_PROVIDER_ID },
      },
    });
    try {
      expect(handle.selected).toMatchObject({
        agentId: `${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_PROVIDER_ID}`,
        pluginId: SAMPLE_PLUGIN_ID,
        backendId: `${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_PROVIDER_ID}`,
        immutableGenerationId: expect.any(String),
      });
      expect(handle.lease.registry.activatedPluginIds).toContain(SAMPLE_PLUGIN_ID);
      expect(handle.lease.registry.agentRuntimesByAgentId.has(
        `${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_PROVIDER_ID}`,
      )).toBe(true);
      const registration = handle.lease.registry.agentRuntimesByAgentId.get(
        `${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_PROVIDER_ID}`,
      );
      if (!registration || !registration.hasPrimaryRuntime) {
        throw new Error('Expected the installed external Agent to expose its public Session runtime');
      }
      const runtime = await registration.createRuntime({ signal: new AbortController().signal });
      if (!runtime.sessions) throw new Error('Expected installed external Agent Session operations');
      const session = await runtime.sessions.open({
        kind: 'create',
        sessionId: 'runner-external-plugin-turn',
        cwd: pluginRoot,
      }, {} as never);
      const events: unknown[] = [];
      const subscription = session.watch((event) => { events.push(event); });
      try {
        await session.send({
          inputIds: ['runner-external-input-1'],
          input: { text: 'hello from the Runner' },
          delivery: { kind: 'newTurn', turnId: 'runner-external-turn-1' },
        });
        expect(events).toContainEqual({
          kind: 'input-accepted',
          turnId: 'runner-external-turn-1',
        });
      } finally {
        subscription.dispose();
        await session.dispose();
      }
    } finally {
      await handle.release();
    }
  });

  it('fails closed before Agent preparation when the reviewed external generation was not acquired', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-runner-empty-plugin-home-'));
    temporaryRoots.push(happyHomeDir);

    await expect(acquireReviewedRunnerPluginRuntimeLease({
      happyHomeDir,
      target: {
        kind: 'agent',
        identity: { pluginId: 'acme.missing', localId: 'agent' },
      },
    })).rejects.toMatchObject({
      name: RunnerReviewedPluginRuntimeUnavailableError.name,
      code: 'runner_reviewed_plugin_runtime_unavailable',
      pluginId: 'acme.missing',
      localId: 'agent',
    });
  });
});
